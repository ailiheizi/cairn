package processor

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"path"
	"strings"
	"unicode/utf8"
)

const (
	docxMaxInputBytes       = 16 << 20
	docxMaxEntries          = 2048
	docxMaxExpandedBytes    = 32 << 20
	docxMaxDocumentXMLBytes = 16 << 20
	docxMaxOutputBytes      = 1 << 20
	docxMaxXMLDepth         = 128
	docxContentTypesPath    = "[Content_Types].xml"
	docxDocumentPath        = "word/document.xml"
	docxWordNamespace       = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
	docxContentTypesNS      = "http://schemas.openxmlformats.org/package/2006/content-types"
	docxMainContentType     = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
	docxMathNamespace       = "http://schemas.openxmlformats.org/officeDocument/2006/math"
	docxMarkupCompatNS      = "http://schemas.openxmlformats.org/markup-compatibility/2006"
)

const docxMaxUint64 = ^uint64(0)

// extractDOCXBody reads only normal WordprocessingML text from the main body.
// It never extracts archive members to disk or follows package relationships.
func extractDOCXBody(ctx context.Context, body []byte, maxOutput int) (string, error) {
	if ctx == nil {
		return "", errors.New("DOCX extraction requires a context")
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if len(body) == 0 || len(body) > docxMaxInputBytes {
		return "", fmt.Errorf("DOCX input size must be between 1 and %d bytes", docxMaxInputBytes)
	}
	if maxOutput <= 0 {
		return "", errors.New("DOCX output limit must be positive")
	}
	outputLimit := maxOutput
	if outputLimit > docxMaxOutputBytes {
		outputLimit = docxMaxOutputBytes
	}

	zr, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		return "", fmt.Errorf("invalid DOCX ZIP package: %w", err)
	}
	if len(zr.File) == 0 || len(zr.File) > docxMaxEntries {
		return "", fmt.Errorf("DOCX package must contain 1 to %d entries", docxMaxEntries)
	}

	files := make(map[string]*zip.File, len(zr.File))
	seenNames := make(map[string]struct{}, len(zr.File))
	var declared uint64
	for _, f := range zr.File {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		name, isDir, err := validateDOCXMemberName(f.Name)
		if err != nil {
			return "", err
		}
		if f.Flags&1 != 0 {
			return "", fmt.Errorf("encrypted DOCX member %q is not supported", name)
		}
		key := strings.TrimSuffix(name, "/")
		if _, exists := seenNames[key]; exists {
			return "", fmt.Errorf("duplicate DOCX member %q", name)
		}
		seenNames[key] = struct{}{}
		if isDir && f.UncompressedSize64 != 0 {
			return "", fmt.Errorf("DOCX directory member %q contains data", name)
		}
		if !isDir {
			files[name] = f
		}
		if docxMaxUint64-declared < f.UncompressedSize64 {
			return "", errors.New("DOCX declared expansion size overflow")
		}
		declared += f.UncompressedSize64
		if declared > docxMaxExpandedBytes {
			return "", fmt.Errorf("DOCX declared expansion exceeds %d bytes", docxMaxExpandedBytes)
		}
	}

	_, ok := files[docxContentTypesPath]
	if !ok {
		return "", errors.New("DOCX package is missing content types")
	}
	documentFile, ok := files[docxDocumentPath]
	if !ok {
		return "", errors.New("DOCX package is missing word/document.xml")
	}
	if documentFile.UncompressedSize64 > docxMaxDocumentXMLBytes {
		return "", fmt.Errorf("DOCX main XML exceeds %d bytes", docxMaxDocumentXMLBytes)
	}

	var actual uint64
	var contentTypes, document []byte
	for _, f := range zr.File {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		name, isDir, _ := validateDOCXMemberName(f.Name)
		readLimit := docxMaxExpandedBytes - actual
		var keep bool
		var memberLimit uint64
		switch name {
		case docxContentTypesPath:
			keep, memberLimit = true, 1<<20
		case docxDocumentPath:
			keep, memberLimit = true, docxMaxDocumentXMLBytes
		default:
			memberLimit = readLimit
		}
		if isDir {
			continue
		}
		if keep && f.UncompressedSize64 > memberLimit {
			return "", fmt.Errorf("DOCX member %q exceeds its limit", name)
		}
		data, size, err := readDOCXMember(ctx, f, memberLimit, readLimit, keep)
		if err != nil {
			return "", fmt.Errorf("read DOCX member %q: %w", name, err)
		}
		if docxMaxUint64-actual < size {
			return "", errors.New("DOCX actual expansion size overflow")
		}
		actual += size
		if actual > docxMaxExpandedBytes {
			return "", fmt.Errorf("DOCX actual expansion exceeds %d bytes", docxMaxExpandedBytes)
		}
		if size != f.UncompressedSize64 {
			return "", fmt.Errorf("DOCX member %q size differs from its ZIP directory entry", name)
		}
		if keep {
			switch name {
			case docxContentTypesPath:
				contentTypes = data
			case docxDocumentPath:
				document = data
			}
		}
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if err := validateDOCXContentTypes(ctx, contentTypes); err != nil {
		return "", err
	}
	text, err := parseDOCXDocument(ctx, document, outputLimit)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(text) == "" {
		return "", errors.New("DOCX main body contains no searchable text")
	}
	return text, nil
}

func validateDOCXMemberName(name string) (string, bool, error) {
	if name == "" || !utf8.ValidString(name) || strings.ContainsRune(name, '\\') || strings.ContainsRune(name, ':') || strings.ContainsRune(name, 0) || strings.HasPrefix(name, "/") {
		return "", false, fmt.Errorf("unsafe DOCX member name %q", name)
	}
	isDir := strings.HasSuffix(name, "/")
	trimmed := strings.TrimSuffix(name, "/")
	if trimmed == "" || path.IsAbs(trimmed) || path.Clean(trimmed) != trimmed {
		return "", false, fmt.Errorf("unsafe DOCX member name %q", name)
	}
	for _, part := range strings.Split(trimmed, "/") {
		if part == "" || part == "." || part == ".." {
			return "", false, fmt.Errorf("unsafe DOCX member name %q", name)
		}
	}
	if isDir {
		return trimmed + "/", true, nil
	}
	return trimmed, false, nil
}

func readDOCXMember(ctx context.Context, f *zip.File, memberLimit, remaining uint64, retain bool) ([]byte, uint64, error) {
	r, err := f.Open()
	if err != nil {
		return nil, 0, err
	}
	defer r.Close()
	var out []byte
	if retain {
		out = make([]byte, 0, int(f.UncompressedSize64))
	}
	buf := make([]byte, 32*1024)
	var total uint64
	for {
		if err := ctx.Err(); err != nil {
			return nil, total, err
		}
		n, readErr := r.Read(buf)
		if n > 0 {
			if total > memberLimit || total > remaining || uint64(n) > memberLimit-total || uint64(n) > remaining-total {
				return nil, total, errors.New("DOCX member expansion limit exceeded")
			}
			total += uint64(n)
			if retain {
				out = append(out, buf[:n]...)
			}
		}
		if readErr != nil {
			if readErr == io.EOF {
				break
			}
			return nil, total, readErr
		}
		if n == 0 {
			return nil, total, io.ErrNoProgress
		}
	}
	if err := ctx.Err(); err != nil {
		return nil, total, err
	}
	return out, total, nil
}

func validateDOCXContentTypes(ctx context.Context, data []byte) error {
	if len(data) == 0 {
		return errors.New("DOCX content types are empty")
	}
	d := xml.NewDecoder(bytes.NewReader(data))
	d.Strict = true
	depth := 0
	rootSeen := false
	mainSeen := false
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		tok, err := d.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("malformed DOCX content types: %w", err)
		}
		switch t := tok.(type) {
		case xml.Directive:
			return errors.New("DOCX content types may not contain directives")
		case xml.StartElement:
			depth++
			if depth > docxMaxXMLDepth {
				return errors.New("DOCX content types nesting is excessive")
			}
			if !rootSeen {
				if t.Name.Space != docxContentTypesNS || t.Name.Local != "Types" {
					return errors.New("DOCX content types have an invalid root")
				}
				rootSeen = true
				continue
			}
			if t.Name.Space != docxContentTypesNS || t.Name.Local != "Override" {
				continue
			}
			var partName, contentType string
			for _, attr := range t.Attr {
				if attr.Name.Space != "" {
					continue
				}
				switch attr.Name.Local {
				case "PartName":
					partName = attr.Value
				case "ContentType":
					contentType = attr.Value
				}
			}
			if partName == "/word/document.xml" {
				if contentType != docxMainContentType {
					return errors.New("DOCX main document content type is not admitted")
				}
				if mainSeen {
					return errors.New("DOCX package has duplicate main document content types")
				}
				mainSeen = true
			}
		case xml.EndElement:
			depth--
			if depth < 0 {
				return errors.New("malformed DOCX content types nesting")
			}
		}
	}
	if !rootSeen || depth != 0 || !mainSeen {
		return errors.New("DOCX package does not declare an admitted main document")
	}
	return nil
}

func parseDOCXDocument(ctx context.Context, data []byte, maxOutput int) (string, error) {
	if len(data) == 0 || len(data) > docxMaxDocumentXMLBytes {
		return "", fmt.Errorf("DOCX main XML must be between 1 and %d bytes", docxMaxDocumentXMLBytes)
	}
	d := xml.NewDecoder(bytes.NewReader(data))
	d.Strict = true
	var out strings.Builder
	stack := make([]xml.Name, 0, 32)
	depth := 0
	rootSeen, bodySeen, bodyActive := false, false, false
	skipDepth := 0

	appendText := func(value string) error {
		if len(value) == 0 {
			return nil
		}
		if len(value) > maxOutput-out.Len() {
			return fmt.Errorf("DOCX extracted text exceeds %d bytes", maxOutput)
		}
		if !utf8.ValidString(value) {
			return errors.New("DOCX text is not valid UTF-8")
		}
		out.WriteString(value)
		return nil
	}
	for {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		tok, err := d.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", fmt.Errorf("malformed DOCX main XML: %w", err)
		}
		switch t := tok.(type) {
		case xml.Directive:
			return "", errors.New("DOCX main XML may not contain directives")
		case xml.StartElement:
			depth++
			if depth > docxMaxXMLDepth {
				return "", errors.New("DOCX main XML nesting is excessive")
			}
			stack = append(stack, t.Name)
			if depth == 1 {
				if t.Name.Space != docxWordNamespace || t.Name.Local != "document" {
					return "", errors.New("DOCX main XML has an invalid root")
				}
				rootSeen = true
				continue
			}
			if !rootSeen {
				return "", errors.New("DOCX main XML has no document root")
			}
			if depth == 2 && t.Name.Space == docxWordNamespace && t.Name.Local == "body" {
				if bodySeen {
					return "", errors.New("DOCX main XML has multiple body elements")
				}
				bodySeen, bodyActive = true, true
				continue
			}
			if !bodyActive {
				continue
			}
			if skipDepth > 0 {
				skipDepth++
				continue
			}
			if t.Name.Space == docxMarkupCompatNS && t.Name.Local == "AlternateContent" {
				return "", errors.New("DOCX body contains unsupported alternate content")
			}
			if t.Name.Space == docxMathNamespace {
				return "", errors.New("DOCX body contains unsupported Office Math content")
			}
			if t.Name.Space != docxWordNamespace {
				return "", fmt.Errorf("DOCX body contains unsupported namespaced content %q", t.Name.Local)
			}
			if t.Name.Space == docxWordNamespace {
				switch t.Name.Local {
				case "del", "moveFrom", "delText", "instrText":
					skipDepth = 1
				case "altChunk", "drawing", "pict", "object", "subDoc", "txbxContent", "sym", "footnoteReference", "endnoteReference":
					return "", fmt.Errorf("DOCX body contains unsupported content %q", t.Name.Local)
				case "t":
				case "tab":
					if err := appendText("\t"); err != nil {
						return "", err
					}
				case "br", "cr":
					if err := appendText("\n"); err != nil {
						return "", err
					}
				case "noBreakHyphen":
					if err := appendText("-"); err != nil {
						return "", err
					}
				case "softHyphen":
					// Word treats a soft hyphen as a discretionary break, not body text.
				}
			}
		case xml.EndElement:
			if depth <= 0 || len(stack) == 0 || stack[len(stack)-1] != t.Name {
				return "", errors.New("malformed DOCX main XML element nesting")
			}
			if bodyActive && skipDepth == 0 && t.Name.Space == docxWordNamespace {
				switch t.Name.Local {
				case "p":
					if err := appendText("\n"); err != nil {
						return "", err
					}
				case "tc":
					if err := appendText("\t"); err != nil {
						return "", err
					}
				case "tr":
					if err := appendText("\n"); err != nil {
						return "", err
					}
				case "body":
					bodyActive = false
				}
			}
			if skipDepth > 0 {
				skipDepth--
			}
			stack = stack[:len(stack)-1]
			depth--
		case xml.CharData:
			if bodyActive && skipDepth == 0 && len(stack) > 0 {
				current := stack[len(stack)-1]
				if current.Space == docxWordNamespace && current.Local == "t" {
					if err := appendText(string(t)); err != nil {
						return "", err
					}
				}
			}
		}
	}
	if !rootSeen || !bodySeen || bodyActive || depth != 0 || skipDepth != 0 {
		return "", errors.New("DOCX main body is incomplete")
	}
	return out.String(), nil
}
