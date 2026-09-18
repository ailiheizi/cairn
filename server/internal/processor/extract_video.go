package processor

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"math"
	"strings"
)

// VideoMeta is the extract.video.meta.v1 EXTRACT processor: the container,
// declared duration, declared pixel dimensions, and the declared video/audio
// codec identifiers of an ISO base media, Matroska/WebM, or RIFF-AVI file.
//
// It is a structural parser, not a demuxer or a decoder: it walks container
// headers under hard bounds and reports exactly what the file declares. A
// field the container does not declare is absent from the artifact and never
// becomes a zero or a guess (an MP4 whose mvhd duration is the all-ones
// "unknown" sentinel yields no duration fact; a Matroska file without a
// Duration element yields none either; a container with no video track yields
// no dimensions or video codec). A file whose container cannot be parsed at
// all is INAPPLICABLE with a typed reason, so a malformed video degrades
// visibly and never blocks exact preservation.
//
// Artifact body (schema restoreweave.domain.video.meta/v1, application/json):
// container, duration_ms, width, height, video_codec, audio_codec, bytes.
type VideoMeta struct{}

func (VideoMeta) CapabilityID() string { return CapabilityVideoMeta }
func (VideoMeta) Stage() Stage         { return StageExtract }

// ProcessingBudget: video headers live inside a real media file, so the
// processor asks for the media budget rather than the text default.
func (VideoMeta) ProcessingBudget() CapabilityBudget {
	return CapabilityBudget{MaxSourceBytes: mediaMaxSourceBytes, StageTimeout: mediaStageTimeout}
}

// Stable reason markers for the operator-visible outcome vocabulary.
const (
	VideoReasonUnsupportedContainer = "VIDEO_META_UNSUPPORTED_CONTAINER"
	VideoReasonMalformedContainer   = "VIDEO_META_MALFORMED_CONTAINER"
	VideoReasonEmptySource          = "VIDEO_META_EMPTY_SOURCE"
)

// Bounds for declared values. A value outside these limits is a malformed
// header, not a fact.
const (
	// maxVideoDimension is 16K, above any real video stream.
	maxVideoDimension = 1 << 14
	// maxVideoDurationMS bounds a declaration at one hundred years; a longer
	// declaration is treated as corrupt rather than durable.
	maxVideoDurationMS = int64(100 * 365 * 24 * 60 * 60 * 1000)
	maxVideoBoxDepth   = 8
	defaultTimecodeNS  = 1000000
)

// errMalformedContainer is the internal parse failure sentinel. It never
// escapes the package as an error value; callers convert it into the typed
// inapplicable reason.
var errMalformedContainer = errors.New("malformed media container")

type videoMetaArtifact struct {
	Schema     string `json:"schema"`
	Container  string `json:"container,omitempty"`
	DurationMS int64  `json:"duration_ms,omitempty"`
	Width      int    `json:"width,omitempty"`
	Height     int    `json:"height,omitempty"`
	VideoCodec string `json:"video_codec,omitempty"`
	AudioCodec string `json:"audio_codec,omitempty"`
	Bytes      int64  `json:"bytes"`
}

func (VideoMeta) RunStage(ctx context.Context, inv Invocation) (StageResult, error) {
	if err := ctx.Err(); err != nil {
		return StageResult{Status: StatusCancelled, Reason: err.Error()}, err
	}
	if inv.Source == nil || inv.Staging == nil {
		return StageResult{Status: StatusFailed, Reason: "source and staging handles are required"}, nil
	}
	body, err := inv.Source.ReadAll(ctx)
	if err != nil {
		return StageResult{Status: StatusFailed, Reason: err.Error()}, nil
	}
	if len(body) == 0 {
		return StageResult{Status: StatusInapplicable, Reason: VideoReasonEmptySource}, nil
	}
	artifact, reason := parseVideoMeta(body)
	if reason != "" {
		return StageResult{Status: StatusInapplicable, Reason: reason}, nil
	}
	payload, err := json.Marshal(artifact)
	if err != nil {
		return StageResult{Status: StatusFailed, Reason: err.Error()}, nil
	}
	if _, err := inv.Staging.Write(payload); err != nil {
		return StageResult{Status: StatusFailed, Reason: err.Error()}, nil
	}
	if err := inv.Staging.Seal(); err != nil {
		return StageResult{Status: StatusFailed, Reason: err.Error()}, nil
	}
	return StageResult{
		Status:           StatusSucceeded,
		DeterminismClass: DeterminismByteExact,
		SchemaRef:        SchemaRefVideoMeta(),
		MediaType:        MediaTypeVideoJSON,
		Sealed:           true,
	}, nil
}

// DurableFacts projects the admitted body into typed facts.
func (VideoMeta) DurableFacts(body []byte) []DurableFact {
	var artifact videoMetaArtifact
	if err := json.Unmarshal(body, &artifact); err != nil {
		return nil
	}
	facts := make([]DurableFact, 0, 6)
	if artifact.Container != "" {
		facts = append(facts, DurableFact{Namespace: FactNamespaceVideo, Key: FactVideoContainer, Value: artifact.Container, ValueType: FactValueString})
	}
	if artifact.DurationMS > 0 {
		facts = append(facts, DurableFact{Namespace: FactNamespaceVideo, Key: FactVideoDuration, Value: artifact.DurationMS, ValueType: FactValueInteger})
	}
	if artifact.Width > 0 && artifact.Height > 0 {
		facts = append(facts, DurableFact{Namespace: FactNamespaceVideo, Key: FactVideoWidth, Value: artifact.Width, ValueType: FactValueInteger})
		facts = append(facts, DurableFact{Namespace: FactNamespaceVideo, Key: FactVideoHeight, Value: artifact.Height, ValueType: FactValueInteger})
	}
	if artifact.VideoCodec != "" {
		facts = append(facts, DurableFact{Namespace: FactNamespaceVideo, Key: FactVideoCodec, Value: artifact.VideoCodec, ValueType: FactValueString})
	}
	if artifact.AudioCodec != "" {
		facts = append(facts, DurableFact{Namespace: FactNamespaceVideo, Key: FactVideoAudioCodec, Value: artifact.AudioCodec, ValueType: FactValueString})
	}
	return facts
}

// parseVideoMeta returns the declared facts of a supported video container, or
// a typed reason explaining why it could not be read.
func parseVideoMeta(body []byte) (videoMetaArtifact, string) {
	container := videoContainerOf(body)
	var parsed parsedVideo
	var ok bool
	switch container {
	case "iso-bmff":
		parsed, ok = parseISOBMFF(body)
	case "matroska", "webm":
		parsed, ok = parseEBML(body)
	case "avi":
		parsed, ok = parseAVI(body)
	default:
		return videoMetaArtifact{}, VideoReasonUnsupportedContainer
	}
	if !ok {
		return videoMetaArtifact{}, VideoReasonMalformedContainer
	}
	artifact := videoMetaArtifact{
		Schema: SchemaVideoMetaV1, Container: container, Bytes: int64(len(body)),
		DurationMS: parsed.durationMS, Width: parsed.width, Height: parsed.height,
		VideoCodec: parsed.videoCodec, AudioCodec: parsed.audioCodec,
	}
	if artifact.DurationMS < 0 || artifact.DurationMS > maxVideoDurationMS {
		return videoMetaArtifact{}, VideoReasonMalformedContainer
	}
	if (artifact.Width == 0) != (artifact.Height == 0) || artifact.Width < 0 || artifact.Height < 0 ||
		artifact.Width > maxVideoDimension || artifact.Height > maxVideoDimension {
		return videoMetaArtifact{}, VideoReasonMalformedContainer
	}
	return artifact, ""
}

// videoContainerOf names the container family a byte prefix declares. The
// vocabulary is closed: ISO base media (mp4/mov), Matroska, WebM, and RIFF-AVI.
// An EBML document that declares another DocType is not a video container this
// processor claims.
func videoContainerOf(body []byte) string {
	if len(body) >= 8 && string(body[4:8]) == "ftyp" {
		return "iso-bmff"
	}
	if len(body) >= 4 && body[0] == 0x1a && body[1] == 0x45 && body[2] == 0xdf && body[3] == 0xa3 {
		if docType, ok := ebmlDocType(body); ok {
			switch docType {
			case "matroska":
				return "matroska"
			case "webm":
				return "webm"
			}
		}
		return ""
	}
	if len(body) >= 12 && string(body[:4]) == "RIFF" && string(body[8:12]) == "AVI " {
		return "avi"
	}
	return ""
}

type parsedVideo struct {
	durationMS int64
	width      int
	height     int
	videoCodec string
	audioCodec string
}

// --- ISO base media file format (mp4, mov, 3gp) ---

type isoBox struct {
	kind    string
	payload []byte
}

func parseISOBMFF(body []byte) (parsedVideo, bool) {
	var out parsedVideo
	boxes, ok := isoBoxes(body, 0)
	if !ok {
		return out, false
	}
	sawBox := false
	for _, box := range boxes {
		sawBox = true
		if box.kind != "moov" {
			continue
		}
		children, ok := isoBoxes(box.payload, 1)
		if !ok {
			return out, false
		}
		for _, child := range children {
			switch child.kind {
			case "mvhd":
				if duration, ok := isoMovieDurationMS(child.payload); ok {
					out.durationMS = duration
				}
			case "trak":
				if err := parseISOTrack(child.payload, &out); err != nil {
					return out, false
				}
			}
		}
	}
	return out, sawBox
}

// isoBoxes splits one box sequence. A box with a zero or oversized length
// stops the walk and reports malformed rather than trusting the declared size.
func isoBoxes(body []byte, depth int) ([]isoBox, bool) {
	if depth > maxVideoBoxDepth {
		return nil, false
	}
	boxes := make([]isoBox, 0, 4)
	offset := 0
	for offset+8 <= len(body) {
		size := int64(binary.BigEndian.Uint32(body[offset : offset+4]))
		kind := string(body[offset+4 : offset+8])
		headerLength := int64(8)
		switch size {
		case 1:
			if offset+16 > len(body) {
				return nil, false
			}
			large := binary.BigEndian.Uint64(body[offset+8 : offset+16])
			if large > uint64(len(body)) {
				return nil, false
			}
			size = int64(large)
			headerLength = 16
		case 0:
			size = int64(len(body) - offset)
		default:
			if size < 8 {
				return nil, false
			}
		}
		if size < headerLength || int64(offset)+size > int64(len(body)) {
			return nil, false
		}
		payload := body[offset+int(headerLength) : offset+int(size)]
		boxes = append(boxes, isoBox{kind: kind, payload: payload})
		offset += int(size)
	}
	if offset != len(body) {
		return nil, false
	}
	return boxes, true
}

// isoMovieDurationMS reads the movie header timescale and duration. The
// all-ones duration is the standard "unknown" sentinel and yields no fact.
func isoMovieDurationMS(payload []byte) (int64, bool) {
	if len(payload) < 20 {
		return 0, false
	}
	var timescale uint32
	var duration uint64
	if payload[0] == 1 {
		if len(payload) < 32 {
			return 0, false
		}
		timescale = binary.BigEndian.Uint32(payload[20:24])
		duration = binary.BigEndian.Uint64(payload[24:32])
		if duration == 0xffffffffffffffff {
			return 0, false
		}
	} else {
		timescale = binary.BigEndian.Uint32(payload[12:16])
		raw := binary.BigEndian.Uint32(payload[16:20])
		if raw == 0xffffffff {
			return 0, false
		}
		duration = uint64(raw)
	}
	if timescale == 0 || duration == 0 {
		return 0, false
	}
	milliseconds := duration * 1000 / uint64(timescale)
	if milliseconds == 0 || milliseconds > uint64(maxVideoDurationMS) {
		return 0, false
	}
	return int64(milliseconds), true
}

// parseISOTrack reads one trak box: the declared display dimensions and, from
// the sample description, the declared track codec.
func parseISOTrack(payload []byte, out *parsedVideo) error {
	children, ok := isoBoxes(payload, 0)
	if !ok {
		return errMalformedContainer
	}
	trackKind := ""
	for _, child := range children {
		switch child.kind {
		case "tkhd":
			width, height, err := isoTrackDimensions(child.payload)
			if err != nil {
				return err
			}
			if out.width == 0 && width > 0 {
				out.width = width
				out.height = height
			}
		case "mdia":
			mdiaChildren, ok := isoBoxes(child.payload, 0)
			if !ok {
				return errMalformedContainer
			}
			for _, mdiaChild := range mdiaChildren {
				switch mdiaChild.kind {
				case "hdlr":
					if handler, ok := isoHandlerKind(mdiaChild.payload); ok && trackKind == "" {
						trackKind = handler
					}
				case "minf":
					minfChildren, ok := isoBoxes(mdiaChild.payload, 0)
					if !ok {
						return errMalformedContainer
					}
					for _, minfChild := range minfChildren {
						if minfChild.kind != "stbl" {
							continue
						}
						stblChildren, ok := isoBoxes(minfChild.payload, 0)
						if !ok {
							return errMalformedContainer
						}
						for _, stblChild := range stblChildren {
							if stblChild.kind != "stsd" {
								continue
							}
							codec, ok := isoSampleEntryCodec(stblChild.payload)
							if !ok {
								continue
							}
							switch trackKind {
							case "soun":
								if out.audioCodec == "" {
									out.audioCodec = codec
								}
							default:
								if out.videoCodec == "" {
									out.videoCodec = codec
								}
							}
						}
					}
				}
			}
		}
	}
	return nil
}

func isoHandlerKind(payload []byte) (string, bool) {
	if len(payload) < 12 {
		return "", false
	}
	handler := string(payload[8:12])
	if handler == "vide" || handler == "soun" {
		return handler, true
	}
	return "", false
}

// isoTrackDimensions reads the 16.16 fixed-point display dimensions. An absent
// or zero declaration yields no dimensions; a declaration beyond the accepted
// bound is a malformed header, so corruption stays visible instead of becoming
// a silently dropped field.
func isoTrackDimensions(payload []byte) (int, int, error) {
	if len(payload) == 0 {
		return 0, 0, nil
	}
	widthOffset := 76
	if payload[0] == 1 {
		widthOffset = 88
	}
	if len(payload) < widthOffset+8 {
		return 0, 0, nil
	}
	width := int(binary.BigEndian.Uint32(payload[widthOffset:widthOffset+4]) >> 16)
	height := int(binary.BigEndian.Uint32(payload[widthOffset+4:widthOffset+8]) >> 16)
	if width == 0 || height == 0 {
		return 0, 0, nil
	}
	if width > maxVideoDimension || height > maxVideoDimension {
		return 0, 0, errMalformedContainer
	}
	return width, height, nil
}

// isoSampleEntryCodec returns the first sample entry's four-character code.
func isoSampleEntryCodec(payload []byte) (string, bool) {
	if len(payload) < 16 {
		return "", false
	}
	if binary.BigEndian.Uint32(payload[4:8]) < 1 {
		return "", false
	}
	entrySize := int(binary.BigEndian.Uint32(payload[8:12]))
	if entrySize < 16 || 8+entrySize > len(payload) {
		return "", false
	}
	codec := string(payload[12:16])
	if !printableFourCC(codec) {
		return "", false
	}
	return codec, true
}

// --- Matroska / WebM (EBML) ---

type ebmlElement struct {
	id          uint32
	payload     []byte
	unknownSize bool
}

// parseEBML walks the top-level EBML elements and reads the Segment's Info and
// Tracks declarations. Clusters are never descended into: the declared facts
// live in the header elements.
func parseEBML(body []byte) (parsedVideo, bool) {
	var out parsedVideo
	sawHeader := false
	sawSegment := false
	offset := 0
	for offset < len(body) {
		element, size, ok := ebmlReadElement(body, offset)
		if !ok || size <= 0 {
			return out, false
		}
		switch element.id {
		case 0x1a45dfa3:
			sawHeader = true
		case 0x18538067:
			sawSegment = true
			children, ok := ebmlChildren(element.payload)
			if !ok {
				return out, false
			}
			for _, child := range children {
				switch child.id {
				case 0x1549a966:
					if err := parseEBMLInfo(child.payload, &out); err != nil {
						return out, false
					}
				case 0x1654ae6b:
					if err := parseEBMLTracks(child.payload, &out); err != nil {
						return out, false
					}
				case 0x1f43b675: // Cluster: everything after it is payload data
					offset = len(body)
				}
			}
		}
		offset += size
	}
	return out, sawHeader && sawSegment
}

// ebmlDocType reads the DocType string from the EBML header.
func ebmlDocType(body []byte) (string, bool) {
	header, size, ok := ebmlReadElement(body, 0)
	if !ok || size <= 0 || header.id != 0x1a45dfa3 {
		return "", false
	}
	children, ok := ebmlChildren(header.payload)
	if !ok {
		return "", false
	}
	for _, child := range children {
		if child.id != 0x4282 {
			continue
		}
		docType := strings.TrimRight(string(child.payload), "\x00")
		if !printableASCIIText(docType) {
			return "", false
		}
		return docType, true
	}
	return "", false
}

// ebmlReadElement parses one element at offset and returns it with its total
// encoded size. An element with an unknown size extends to the end of its
// parent, which here is the end of the buffer.
func ebmlReadElement(body []byte, offset int) (ebmlElement, int, bool) {
	id, idLength, ok := ebmlID(body, offset)
	if !ok {
		return ebmlElement{}, 0, false
	}
	size, sizeLength, unknownSize, ok := ebmlSize(body, offset+idLength)
	if !ok {
		return ebmlElement{}, 0, false
	}
	payloadStart := offset + idLength + sizeLength
	payloadEnd := len(body)
	if !unknownSize {
		if size > uint64(len(body)-payloadStart) {
			return ebmlElement{}, 0, false
		}
		payloadEnd = payloadStart + int(size)
	}
	return ebmlElement{id: id, payload: body[payloadStart:payloadEnd], unknownSize: unknownSize}, payloadEnd - offset, true
}

// ebmlSize decodes a data-size vint. All data bits set means "unknown size".
func ebmlSize(body []byte, offset int) (uint64, int, bool, bool) {
	value, length, ok := ebmlVint(body, offset)
	if !ok {
		return 0, 0, false, false
	}
	unknown := length <= 8 && value == (uint64(1)<<(7*length))-1
	return value, length, unknown, true
}

// ebmlVint decodes a variable-length integer, stripping the length marker.
func ebmlVint(body []byte, offset int) (uint64, int, bool) {
	if offset >= len(body) {
		return 0, 0, false
	}
	first := body[offset]
	if first == 0 {
		return 0, 0, false
	}
	length := 1
	mask := byte(0x80)
	for mask != 0 && first&mask == 0 {
		mask >>= 1
		length++
	}
	if length > 8 || offset+length > len(body) {
		return 0, 0, false
	}
	value := uint64(first & (mask - 1))
	for index := 1; index < length; index++ {
		value = value<<8 | uint64(body[offset+index])
	}
	return value, length, true
}

// ebmlID decodes an element ID, whose marker bit is part of the identity.
func ebmlID(body []byte, offset int) (uint32, int, bool) {
	if offset >= len(body) {
		return 0, 0, false
	}
	first := body[offset]
	if first == 0 {
		return 0, 0, false
	}
	length := 1
	mask := byte(0x80)
	for mask != 0 && first&mask == 0 {
		mask >>= 1
		length++
	}
	if length > 4 || offset+length > len(body) {
		return 0, 0, false
	}
	value := uint32(first)
	for index := 1; index < length; index++ {
		value = value<<8 | uint32(body[offset+index])
	}
	return value, length, true
}

// ebmlChildren parses one element sequence.
func ebmlChildren(payload []byte) ([]ebmlElement, bool) {
	children := make([]ebmlElement, 0, 8)
	offset := 0
	for offset < len(payload) {
		element, size, ok := ebmlReadElement(payload, offset)
		if !ok || size <= 0 {
			return nil, false
		}
		children = append(children, element)
		offset += size
	}
	return children, true
}

// parseEBMLInfo reads the segment timecode scale and declared duration.
func parseEBMLInfo(payload []byte, out *parsedVideo) error {
	children, ok := ebmlChildren(payload)
	if !ok {
		return errMalformedContainer
	}
	timecodeNS := uint64(defaultTimecodeNS)
	duration := math.NaN()
	for _, child := range children {
		switch child.id {
		case 0x2ad7b1: // TimecodeScale, in nanoseconds per tick
			value, ok := ebmlUint(child.payload)
			if !ok {
				return errMalformedContainer
			}
			timecodeNS = value
		case 0x4489: // Duration, a float in timecode-scale ticks
			value, ok := ebmlFloat(child.payload)
			if !ok {
				return errMalformedContainer
			}
			duration = value
		}
	}
	if timecodeNS == 0 {
		return errMalformedContainer
	}
	if !math.IsNaN(duration) && duration > 0 {
		milliseconds := int64(duration * float64(timecodeNS) / 1e6)
		if milliseconds > 0 && milliseconds <= maxVideoDurationMS {
			out.durationMS = milliseconds
		}
	}
	return nil
}

// parseEBMLTracks reads the declared video and audio track properties.
func parseEBMLTracks(payload []byte, out *parsedVideo) error {
	children, ok := ebmlChildren(payload)
	if !ok {
		return errMalformedContainer
	}
	for _, child := range children {
		if child.id != 0xae { // TrackEntry
			continue
		}
		entry, ok := ebmlChildren(child.payload)
		if !ok {
			return errMalformedContainer
		}
		trackType := uint64(0)
		codec := ""
		width, height := 0, 0
		for _, field := range entry {
			switch field.id {
			case 0x83: // TrackType: 1 video, 2 audio
				value, ok := ebmlUint(field.payload)
				if !ok {
					return errMalformedContainer
				}
				trackType = value
			case 0x86: // CodecID
				if printableASCIIText(string(field.payload)) {
					codec = string(field.payload)
				}
			case 0xb0: // PixelWidth
				value, ok := ebmlUint(field.payload)
				if !ok {
					return errMalformedContainer
				}
				width = int(value)
			case 0xba: // PixelHeight
				value, ok := ebmlUint(field.payload)
				if !ok {
					return errMalformedContainer
				}
				height = int(value)
			}
		}
		switch trackType {
		case 1:
			if out.videoCodec == "" && codec != "" {
				out.videoCodec = codec
			}
			if width > 0 && height > 0 {
				if width > maxVideoDimension || height > maxVideoDimension {
					return errMalformedContainer
				}
				if out.width == 0 {
					out.width = width
					out.height = height
				}
			}
		case 2:
			if out.audioCodec == "" && codec != "" {
				out.audioCodec = codec
			}
		}
	}
	return nil
}

func ebmlUint(payload []byte) (uint64, bool) {
	if len(payload) == 0 || len(payload) > 8 {
		return 0, false
	}
	var value uint64
	for _, b := range payload {
		value = value<<8 | uint64(b)
	}
	return value, true
}

func ebmlFloat(payload []byte) (float64, bool) {
	switch len(payload) {
	case 4:
		return float64(math.Float32frombits(binary.BigEndian.Uint32(payload))), true
	case 8:
		return math.Float64frombits(binary.BigEndian.Uint64(payload)), true
	default:
		return 0, false
	}
}

// --- RIFF-AVI ---

func parseAVI(body []byte) (parsedVideo, bool) {
	if len(body) < 12 || string(body[:4]) != "RIFF" || string(body[8:12]) != "AVI " {
		return parsedVideo{}, false
	}
	var out parsedVideo
	sawHeader := false
	for _, chunk := range riffChunks(body, 12) {
		switch {
		case chunk.kind == "LIST" && chunk.listType == "hdrl":
			sawHeader = true
			if err := parseAVIHeaderList(chunk.payload, &out); err != nil {
				return parsedVideo{}, false
			}
		case chunk.kind == "LIST" && chunk.listType == "strl":
			if err := parseAVIStreamList(chunk.payload, &out); err != nil {
				return parsedVideo{}, false
			}
		}
	}
	return out, sawHeader
}

type riffChunk struct {
	kind     string
	listType string
	payload  []byte
}

// riffChunks splits one RIFF chunk sequence. RIFF pads every chunk to an even
// boundary; a chunk whose declared size exceeds the buffer stops the walk.
func riffChunks(body []byte, start int) []riffChunk {
	chunks := make([]riffChunk, 0, 8)
	offset := start
	for offset+8 <= len(body) {
		kind := string(body[offset : offset+4])
		size := int(binary.LittleEndian.Uint32(body[offset+4 : offset+8]))
		if size < 0 || offset+8+size > len(body) {
			break
		}
		payload := body[offset+8 : offset+8+size]
		chunk := riffChunk{kind: kind, payload: payload}
		if kind == "LIST" && len(payload) >= 4 {
			chunk.listType = string(payload[:4])
			chunk.payload = payload[4:]
		}
		chunks = append(chunks, chunk)
		offset += 8 + size
		if size%2 == 1 {
			offset++
		}
	}
	return chunks
}

// parseAVIHeaderList reads the fixed avih layout this reader consumes.
func parseAVIHeaderList(payload []byte, out *parsedVideo) error {
	for _, chunk := range riffChunks(payload, 0) {
		if chunk.kind != "avih" {
			continue
		}
		if len(chunk.payload) < 40 {
			return errMalformedContainer
		}
		microSecondsPerFrame := binary.LittleEndian.Uint32(chunk.payload[0:4])
		totalFrames := binary.LittleEndian.Uint32(chunk.payload[16:20])
		width := int(binary.LittleEndian.Uint32(chunk.payload[32:36]))
		height := int(binary.LittleEndian.Uint32(chunk.payload[36:40]))
		if width > 0 && height > 0 {
			if width > maxVideoDimension || height > maxVideoDimension {
				return errMalformedContainer
			}
			out.width = width
			out.height = height
		}
		if microSecondsPerFrame > 0 && totalFrames > 0 {
			milliseconds := int64(totalFrames) * int64(microSecondsPerFrame) / 1000
			if milliseconds > 0 && milliseconds <= maxVideoDurationMS {
				out.durationMS = milliseconds
			}
		}
	}
	return nil
}

// parseAVIStreamList reads one strl: the stream type, handler fourcc, and
// declared rate/scale/length.
func parseAVIStreamList(payload []byte, out *parsedVideo) error {
	streamType := ""
	handler := ""
	durationMS := int64(0)
	for _, chunk := range riffChunks(payload, 0) {
		switch chunk.kind {
		case "strh":
			if len(chunk.payload) < 48 {
				return errMalformedContainer
			}
			streamType = string(chunk.payload[0:4])
			handler = string(chunk.payload[4:8])
			scale := int64(binary.LittleEndian.Uint32(chunk.payload[20:24]))
			rate := int64(binary.LittleEndian.Uint32(chunk.payload[24:28]))
			length := int64(binary.LittleEndian.Uint32(chunk.payload[32:36]))
			if rate > 0 && scale > 0 && length > 0 {
				// AVI declares stream length in scale/rate units.
				milliseconds := length * scale * 1000 / rate
				if milliseconds > 0 && milliseconds <= maxVideoDurationMS {
					durationMS = milliseconds
				}
			}
		case "strf":
			if streamType == "auds" && !printableFourCC(handler) && len(chunk.payload) >= 2 {
				if name, ok := waveFormatName(binary.LittleEndian.Uint16(chunk.payload[0:2])); ok {
					handler = name
				}
			}
		}
	}
	if !printableFourCC(handler) {
		handler = ""
	}
	switch streamType {
	case "vids":
		if out.videoCodec == "" && handler != "" {
			out.videoCodec = handler
		}
	case "auds":
		if out.audioCodec == "" && handler != "" {
			out.audioCodec = handler
		}
	}
	if durationMS > 0 && out.durationMS == 0 && streamType == "vids" {
		out.durationMS = durationMS
	}
	return nil
}

func printableFourCC(value string) bool {
	if len(value) == 0 {
		return false
	}
	for _, r := range value {
		if r < 0x20 || r > 0x7e {
			return false
		}
	}
	return true
}

func printableASCIIText(value string) bool {
	if value == "" {
		return false
	}
	for _, r := range value {
		if r < 0x20 || r > 0x7e {
			return false
		}
	}
	return true
}
