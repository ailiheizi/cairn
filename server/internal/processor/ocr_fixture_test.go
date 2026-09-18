package processor

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"sort"
	"strings"
)

// This file is a test-only harness. It never ships in any binary: the file
// name ends in _test.go, so the fixture font and the fixture engine cannot be
// reached from configuration, a daemon, or a default capability list. It
// exists so the OCR artifact pipeline, the bounds, the honest states, and the
// search feed can be exercised end to end without an operator-installed ONNX
// bundle. It is explicitly not OCR: its "engine id" is fixture-ocr-v1 and its
// language coverage is a 5x7 uppercase/digit font.

// ocrFixtureFont is a 5x7 bitmap font. Every glyph must have a dark pixel in
// its first and last column and no fully empty column, so column-gap
// segmentation recovers exactly one cell per glyph, and every glyph must be
// vertically contiguous so one glyph is one text line. A horizontal rule or a
// dotted glyph would violate the line rule and is deliberately absent.
// TestOCRFIXTUREFontRoundTripsEveryGlyph enforces the properties and the
// render/recognize round trip.
var ocrFixtureFont = map[rune][]string{
	'A': {"..#..", ".#.#.", "#...#", "#####", "#...#", "#...#", "#...#"},
	'B': {"####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."},
	'C': {".####", "#....", "#....", "#....", "#....", "#....", ".####"},
	'D': {"####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."},
	'E': {"#####", "#....", "#....", "####.", "#....", "#....", "#####"},
	'F': {"#####", "#....", "#....", "####.", "#....", "#....", "#...."},
	'G': {".####", "#....", "#....", "#.###", "#...#", "#...#", ".####"},
	'H': {"#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"},
	'I': {"#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"},
	'J': {"..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."},
	'K': {"#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"},
	'L': {"#....", "#....", "#....", "#....", "#....", "#....", "#####"},
	'M': {"#...#", "##.##", "#.#.#", "#...#", "#...#", "#...#", "#...#"},
	'N': {"#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"},
	'O': {".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."},
	'P': {"####.", "#...#", "#...#", "####.", "#....", "#....", "#...."},
	'Q': {".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"},
	'R': {"####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"},
	'S': {".####", "#....", "#....", ".###.", "....#", "....#", "####."},
	'T': {"#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."},
	'U': {"#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."},
	'V': {"#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."},
	'W': {"#...#", "#...#", "#...#", "#...#", "#.#.#", "##.##", "#...#"},
	'X': {"#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"},
	'Y': {"#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."},
	'Z': {"#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"},
	'0': {".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."},
	'1': {".##..", ".##..", ".##..", "..##.", "..##.", "..##.", "#####"},
	'2': {".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"},
	'3': {"####.", "....#", "....#", ".###.", "....#", "....#", "####."},
	'4': {"...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."},
	'5': {"#####", "#....", "####.", "....#", "....#", "#...#", ".###."},
	'6': {".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."},
	'7': {"#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."},
	'8': {".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."},
	'9': {".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."},
	' ': {".....", ".....", ".....", ".....", ".....", ".....", "....."},
}

const (
	ocrFixtureGlyphWidth  = 5
	ocrFixtureGlyphHeight = 7
	// ocrFixtureThreshold marks a region as low confidence when the font match
	// is imperfect. A clean glyph matches exactly and scores 1.0.
	ocrFixtureThreshold = 0.95
)

// ocrFixtureRegistryDigest pins the fixture engine so its artifacts carry a
// stable profile identity instead of an invented one.
func ocrFixtureRegistryDigest() string {
	glyphs := make([]string, 0, len(ocrFixtureFont))
	for name, rows := range ocrFixtureFont {
		glyphs = append(glyphs, string(name)+"="+strings.Join(rows, "/"))
	}
	sort.Strings(glyphs)
	sum := sha256.Sum256([]byte("restoreweave.ocr-fixture-font.v1:" + strings.Join(glyphs, "|")))
	return "sha256:" + hex.EncodeToString(sum[:])
}

// ocrFixtureStep is the glyph pitch: one 5x7 block plus one row/column of
// spacing, so column-gap and row-gap segmentation can separate glyphs and
// lines exactly as they separate the same glyphs in a real text image.
const ocrFixtureStep = 1

// renderOCRFixtureImage draws one or more lines of fixture text. Each glyph
// occupies a scale-multiplied 5x7 block plus one glyph of spacing. paper is the
// background color; ink is the text color.
func renderOCRFixtureImage(lines []string, scale int, paper, ink color.Color) *image.RGBA {
	if scale < 1 {
		scale = 1
	}
	width := 0
	for _, line := range lines {
		lineWidth := len([]rune(line)) * (ocrFixtureGlyphWidth + ocrFixtureStep) * scale
		if lineWidth > width {
			width = lineWidth
		}
	}
	if width == 0 {
		width = (ocrFixtureGlyphWidth + ocrFixtureStep) * scale
	}
	height := len(lines) * (ocrFixtureGlyphHeight + ocrFixtureStep) * scale
	if height == 0 {
		height = (ocrFixtureGlyphHeight + ocrFixtureStep) * scale
	}
	canvas := image.NewRGBA(image.Rect(0, 0, width, height))
	draw.Draw(canvas, canvas.Bounds(), &image.Uniform{C: paper}, image.Point{}, draw.Src)
	y := 0
	for _, line := range lines {
		x := 0
		for _, glyph := range line {
			rows, ok := ocrFixtureFont[glyph]
			if !ok {
				x += (ocrFixtureGlyphWidth + ocrFixtureStep) * scale
				continue
			}
			for gy, row := range rows {
				for gx, cell := range row {
					if cell != '#' {
						continue
					}
					for py := 0; py < scale; py++ {
						for px := 0; px < scale; px++ {
							canvas.Set(x+gx*scale+px, y+gy*scale+py, ink)
						}
					}
				}
			}
			x += (ocrFixtureGlyphWidth + ocrFixtureStep) * scale
		}
		y += (ocrFixtureGlyphHeight + ocrFixtureStep) * scale
	}
	return canvas
}

// ocrFixtureBlanker erases one 5x7 font cell inside a glyph so a test can
// produce a deterministic partially readable region.
func ocrFixtureBlanker(canvas *image.RGBA, lineIndex, glyphIndex, cellX, cellY, scale int) {
	x := glyphIndex * (ocrFixtureGlyphWidth + ocrFixtureStep) * scale
	y := lineIndex * (ocrFixtureGlyphHeight + ocrFixtureStep) * scale
	for py := 0; py < scale; py++ {
		for px := 0; px < scale; px++ {
			canvas.Set(x+cellX*scale+px, y+cellY*scale+py, color.RGBA{R: 255, G: 255, B: 255, A: 255})
		}
	}
}

// fixtureOCREngine is the test harness engine. It performs real pixel analysis
// (binarize, line/column segmentation, 5x7 font matching) but it is not a
// learned OCR model and it declares itself as a fixture in every artifact.
type fixtureOCREngine struct{}

func (fixtureOCREngine) Facts() OCRRunFacts {
	return OCRRunFacts{
		EngineID:               "fixture-ocr-v1",
		EngineVersion:          "1",
		EngineBuild:            "test-only",
		EngineSource:           "in-package test harness bitmap font; not a shipped OCR engine",
		EngineLicense:          "n/a (test harness)",
		Runtime:                "fixture-in-process",
		RuntimeVersion:         "1",
		ProfileDigest:          ocrFixtureRegistryDigest(),
		PreprocessingDigest:    ocrFixtureRegistryDigest(),
		ModelID:                "fixture-font-5x7",
		ModelRevision:          "1",
		ModelLicenseID:         "n/a (test harness)",
		Languages:              []string{"en"},
		LanguageNotes:          "5x7 uppercase latin and digit font; no Chinese coverage is claimed",
		DictionaryFormat:       "fixture-5x7",
		AngleClassification:    "NOT_CONFIGURED",
		Stages:                 []string{"DET", "REC"},
		LowConfidenceThreshold: ocrFixtureThreshold,
		DeterminismClass:       DeterminismByteExact,
	}
}

// Recognize binarizes the bitmap, splits it into text lines and glyph cells,
// and matches each cell against the fixture font.
func (fixtureOCREngine) Recognize(ctx context.Context, bitmap OCRBitmap, bounds OCRRunBounds) (OCRRunResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return OCRRunResult{}, err
	}
	dark := make([]bool, bitmap.Width*bitmap.Height)
	for y := 0; y < bitmap.Height; y++ {
		for x := 0; x < bitmap.Width; x++ {
			pixel := bitmap.at(x, y)
			luma := (299*int(pixel.R) + 587*int(pixel.G) + 114*int(pixel.B)) / 1000
			dark[y*bitmap.Width+x] = luma < 128
		}
	}
	result := OCRRunResult{Regions: make([]OCRRegion, 0, 8)}
	textBytes := 0
	for _, line := range ocrFixtureLines(dark, bitmap.Width, bitmap.Height) {
		// Adjacent glyphs of one word become one region, mirroring a real OCR
		// line box; a wider gap (a space character) starts a new region.
		mergeGap := (line.bottom - line.top) / 3
		if mergeGap < 1 {
			mergeGap = 1
		}
		for _, group := range ocrFixtureGroupCells(ocrFixtureCells(dark, bitmap.Width, line.top, line.bottom), mergeGap) {
			if err := ctx.Err(); err != nil {
				return OCRRunResult{}, err
			}
			region := ocrFixtureRecognizeGroup(dark, bitmap.Width, group)
			if bounds.MaxTextBytes > 0 && textBytes+len(region.Text) > bounds.MaxTextBytes {
				result.Truncated = true
				result.Reasons = appendUnique(result.Reasons, OCRReasonTextLimit)
				break
			}
			textBytes += len(region.Text)
			result.Regions = append(result.Regions, region)
		}
	}
	if len(result.Regions) > 0 && bounds.MaxRegions > 0 && len(result.Regions) > bounds.MaxRegions {
		result.Regions = result.Regions[:bounds.MaxRegions]
		result.Truncated = true
		result.Reasons = appendUnique(result.Reasons, OCRReasonRegionLimit)
	}
	return result, nil
}

// ocrFixtureGroupCells merges horizontally adjacent glyph cells into word
// groups. A gap wider than mergeGap pixels starts a new group.
func ocrFixtureGroupCells(cells []ocrFixtureCell, mergeGap int) [][]ocrFixtureCell {
	groups := make([][]ocrFixtureCell, 0, len(cells))
	for _, cell := range cells {
		if len(groups) > 0 {
			current := groups[len(groups)-1]
			last := current[len(current)-1]
			if cell.left-last.right <= mergeGap {
				groups[len(groups)-1] = append(current, cell)
				continue
			}
		}
		groups = append(groups, []ocrFixtureCell{cell})
	}
	return groups
}

// ocrFixtureRecognizeGroup recognizes every glyph cell of one group and
// reports the group text with the mean glyph confidence and the union box.
func ocrFixtureRecognizeGroup(dark []bool, width int, group []ocrFixtureCell) OCRRegion {
	builder := make([]rune, 0, len(group))
	confidenceTotal := 0.0
	densityTotal := 0.0
	box := OCRBox{X0: group[0].left, Y0: group[0].top, X1: group[0].right, Y1: group[0].bottom}
	for _, cell := range group {
		text, confidence := ocrFixtureMatchCell(dark, width, cell)
		builder = append(builder, []rune(text)...)
		confidenceTotal += confidence
		densityTotal += ocrFixtureDarkDensity(dark, width, cell)
		if cell.left < box.X0 {
			box.X0 = cell.left
		}
		if cell.right > box.X1 {
			box.X1 = cell.right
		}
	}
	return OCRRegion{
		Text: string(builder), Confidence: confidenceTotal / float64(len(group)),
		BoxConfidence: densityTotal / float64(len(group)), Box: box,
	}
}

type ocrFixtureBand struct {
	top    int
	bottom int
}

func ocrFixtureLines(dark []bool, width, height int) []ocrFixtureBand {
	bands := make([]ocrFixtureBand, 0, 4)
	start := -1
	for y := 0; y < height; y++ {
		hasInk := false
		for x := 0; x < width; x++ {
			if dark[y*width+x] {
				hasInk = true
				break
			}
		}
		switch {
		case hasInk && start < 0:
			start = y
		case !hasInk && start >= 0:
			bands = append(bands, ocrFixtureBand{top: start, bottom: y})
			start = -1
		}
	}
	if start >= 0 {
		bands = append(bands, ocrFixtureBand{top: start, bottom: height})
	}
	return bands
}

type ocrFixtureCell struct {
	left   int
	right  int
	top    int
	bottom int
}

func ocrFixtureCells(dark []bool, width, top, bottom int) []ocrFixtureCell {
	cells := make([]ocrFixtureCell, 0, 16)
	start := -1
	for x := 0; x < width; x++ {
		hasInk := false
		for y := top; y < bottom; y++ {
			if dark[y*width+x] {
				hasInk = true
				break
			}
		}
		switch {
		case hasInk && start < 0:
			start = x
		case !hasInk && start >= 0:
			cells = append(cells, ocrFixtureCell{left: start, right: x, top: top, bottom: bottom})
			start = -1
		}
	}
	if start >= 0 {
		cells = append(cells, ocrFixtureCell{left: start, right: width, top: top, bottom: bottom})
	}
	return cells
}

// ocrFixtureMatchCell resamples one cell into the 5x7 grid and returns the
// best matching glyph. Confidence is the fraction of matching grid cells, so a
// damaged glyph stays visible as a low-confidence region instead of being
// silently dropped or silently accepted.
func ocrFixtureMatchCell(dark []bool, width int, cell ocrFixtureCell) (string, float64) {
	pattern := ocrFixtureSampleCell(dark, width, cell)
	best := rune(0)
	bestScore := -1
	for glyph, rows := range ocrFixtureFont {
		if rows[0] == "....." {
			continue
		}
		score := ocrFixturePatternScore(pattern, rows)
		if score > bestScore || (score == bestScore && glyph < best) {
			bestScore = score
			best = glyph
		}
	}
	if best == 0 {
		return "", 0
	}
	total := ocrFixtureGlyphWidth * ocrFixtureGlyphHeight
	confidence := float64(bestScore) / float64(total)
	if bestScore*2 < total {
		return "", confidence
	}
	return string(best), confidence
}

func ocrFixtureSampleCell(dark []bool, width int, cell ocrFixtureCell) []string {
	rows := make([]string, ocrFixtureGlyphHeight)
	cellWidth := cell.right - cell.left
	cellHeight := cell.bottom - cell.top
	for gy := 0; gy < ocrFixtureGlyphHeight; gy++ {
		runes := make([]rune, ocrFixtureGlyphWidth)
		for gx := 0; gx < ocrFixtureGlyphWidth; gx++ {
			darkCells := 0
			totalCells := 0
			for py := gy * cellHeight / ocrFixtureGlyphHeight; py < (gy+1)*cellHeight/ocrFixtureGlyphHeight; py++ {
				for px := gx * cellWidth / ocrFixtureGlyphWidth; px < (gx+1)*cellWidth/ocrFixtureGlyphWidth; px++ {
					totalCells++
					if cell.top+py < 0 || cell.left+px < 0 {
						continue
					}
					index := (cell.top+py)*width + cell.left + px
					if index >= 0 && index < len(dark) && dark[index] {
						darkCells++
					}
				}
			}
			if totalCells > 0 && darkCells*3 >= totalCells {
				runes[gx] = '#'
			} else {
				runes[gx] = '.'
			}
		}
		rows[gy] = string(runes)
	}
	return rows
}

func ocrFixturePatternScore(pattern, rows []string) int {
	score := 0
	for y := 0; y < ocrFixtureGlyphHeight; y++ {
		for x := 0; x < ocrFixtureGlyphWidth; x++ {
			if pattern[y][x] == rows[y][x] {
				score++
			}
		}
	}
	return score
}

func ocrFixtureDarkDensity(dark []bool, width int, cell ocrFixtureCell) float64 {
	darkCells := 0
	total := 0
	for y := cell.top; y < cell.bottom; y++ {
		for x := cell.left; x < cell.right; x++ {
			total++
			index := y*width + x
			if index >= 0 && index < len(dark) && dark[index] {
				darkCells++
			}
		}
	}
	if total == 0 {
		return 0
	}
	return float64(darkCells) / float64(total)
}

func (fixtureOCREngine) String() string {
	return fmt.Sprintf("fixtureOCREngine(%s)", ocrFixtureRegistryDigest())
}
