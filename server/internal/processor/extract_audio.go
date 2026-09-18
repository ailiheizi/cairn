package processor

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"strconv"
	"strings"
	"unicode/utf8"
)

// AudioTags is a BYTE_DETERMINISTIC EXTRACT processor for ID3v2, FLAC
// Vorbis comments, OGG Vorbis comments, MP4/M4A audio, WAVE, and MPEG audio.
// It never opens paths and does not rewrite source bytes.
//
// The artifact body (schema restoreweave.domain.audio.track/v1,
// application/json) carries the tag facts and, additively, the technical facts
// the container declares: duration, sample rate, channel count, and codec. A
// codec field is reported only when the container declares one. A duration
// that had to be derived from a declared bitrate is marked with
// `duration_estimated: true`; a declared duration never carries that flag, and
// a file that declares no duration yields no duration field at all.
type AudioTags struct{}

func (AudioTags) CapabilityID() string { return CapabilityAudioTags }
func (AudioTags) Stage() Stage         { return StageExtract }

// ProcessingBudget: an audio file is a media file; the tag and header walk
// asks for the media budget so it is not truncated before MPEG frames or an
// OGG tail page can be read.
func (AudioTags) ProcessingBudget() CapabilityBudget {
	return CapabilityBudget{MaxSourceBytes: mediaMaxSourceBytes, StageTimeout: mediaStageTimeout}
}

type audioTrack struct {
	Title             string `json:"title,omitempty"`
	Artist            string `json:"artist,omitempty"`
	Album             string `json:"album,omitempty"`
	Track             int    `json:"track,omitempty"`
	Year              string `json:"year,omitempty"`
	DurationMS        int64  `json:"duration_ms,omitempty"`
	DurationEstimated bool   `json:"duration_estimated,omitempty"`
	SampleRate        int    `json:"sample_rate,omitempty"`
	Channels          int    `json:"channels,omitempty"`
	Codec             string `json:"codec,omitempty"`
	Container         string `json:"container,omitempty"`
}

// hasFacts reports whether the parse produced any durable statement at all.
func (track audioTrack) hasFacts() bool {
	return track.Title != "" || track.Artist != "" || track.Album != "" ||
		track.DurationMS > 0 || track.SampleRate > 0 || track.Channels > 0 || track.Codec != ""
}

// DurableFacts projects the admitted body into typed facts. The estimate flag
// is emitted only for an estimated duration; a declared duration leaves it
// absent.
func (AudioTags) DurableFacts(body []byte) []DurableFact {
	var track audioTrack
	if err := json.Unmarshal(body, &track); err != nil {
		return nil
	}
	facts := make([]DurableFact, 0, 5)
	if track.DurationMS > 0 {
		facts = append(facts, DurableFact{Namespace: FactNamespaceAudio, Key: FactAudioDuration, Value: track.DurationMS, ValueType: FactValueInteger})
		if track.DurationEstimated {
			facts = append(facts, DurableFact{Namespace: FactNamespaceAudio, Key: FactAudioDurationEstimated, Value: true, ValueType: FactValueBoolean})
		}
	}
	if track.SampleRate > 0 {
		facts = append(facts, DurableFact{Namespace: FactNamespaceAudio, Key: FactAudioSampleRate, Value: track.SampleRate, ValueType: FactValueInteger})
	}
	if track.Channels > 0 {
		facts = append(facts, DurableFact{Namespace: FactNamespaceAudio, Key: FactAudioChannels, Value: track.Channels, ValueType: FactValueInteger})
	}
	if track.Codec != "" {
		facts = append(facts, DurableFact{Namespace: FactNamespaceAudio, Key: FactAudioCodec, Value: track.Codec, ValueType: FactValueString})
	}
	return facts
}

func (AudioTags) RunStage(ctx context.Context, inv Invocation) (StageResult, error) {
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
	track, ok := parseAudioTags(body)
	if !ok {
		return StageResult{Status: StatusInapplicable, Reason: "no parseable audio tags"}, nil
	}
	payload, err := json.Marshal(track)
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
		SchemaRef:        SchemaRefAudioTrack(),
		MediaType:        MediaTypeAudioJSON,
		Sealed:           true,
	}, nil
}

func parseAudioTags(body []byte) (audioTrack, bool) {
	if len(body) >= 12 && string(body[:4]) == "RIFF" && string(body[8:12]) == "WAVE" {
		if track, ok := parseWAVE(body); ok {
			return track, true
		}
		return audioTrack{}, false
	}
	if len(body) >= 4 && string(body[:4]) == "fLaC" {
		if track, ok := parseFLAC(body); ok {
			track.Container = "flac"
			return track, true
		}
		return audioTrack{}, false
	}
	if len(body) >= 4 && string(body[:4]) == "OggS" {
		if track, ok := parseOGG(body); ok {
			track.Container = "ogg"
			return track, true
		}
		return audioTrack{}, false
	}
	if len(body) >= 8 && string(body[4:8]) == "ftyp" {
		if track, ok := parseISOAudio(body); ok {
			return track, true
		}
		return audioTrack{}, false
	}
	track := audioTrack{}
	hasTags := false
	if len(body) >= 3 && string(body[:3]) == "ID3" {
		if tagged, ok := parseID3(body); ok {
			track = tagged
			hasTags = true
		}
	}
	if technical, ok := parseMPEGAudio(body); ok {
		track.DurationMS = technical.DurationMS
		track.DurationEstimated = technical.DurationEstimated
		track.SampleRate = technical.SampleRate
		track.Channels = technical.Channels
		track.Codec = technical.Codec
	}
	if hasTags {
		track.Container = "id3"
	} else if track.Codec != "" {
		track.Container = "mpeg"
	}
	return track, track.hasFacts()
}

func parseOGG(body []byte) (audioTrack, bool) {
	track := audioTrack{}
	// Identification and comment headers live at the head of the stream; the
	// granule clock lives in the last page. Both scans are bounded so a large
	// file never becomes a large allocation here.
	head := body
	if len(head) > maxOGGHeaderScan {
		head = head[:maxOGGHeaderScan]
	}
	for _, packet := range oggPackets(head) {
		if len(packet) >= 7 && packet[0] == 3 && string(packet[1:7]) == "vorbis" {
			parseVorbisComment(packet[7:], &track)
			continue
		}
		if len(packet) >= 16 && packet[0] == 1 && string(packet[1:7]) == "vorbis" {
			track.Codec = "vorbis"
			track.Channels = int(packet[11])
			track.SampleRate = int(binary.LittleEndian.Uint32(packet[12:16]))
			continue
		}
		if len(packet) >= 19 && string(packet[:8]) == "OpusHead" {
			track.Codec = "opus"
			track.Channels = int(packet[9])
			// Opus always decodes at 48 kHz and its granule clock is fixed at
			// 48 kHz; OpusHead's declared input rate is informational.
			track.SampleRate = opusGranuleRate
			continue
		}
		if len(packet) >= 51 && packet[0] == 0x7f && string(packet[1:5]) == "FLAC" && packet[5] == 1 {
			// FLAC-in-Ogg: the STREAMINFO block follows the mapping header.
			streamInfo := packet[13:]
			if len(streamInfo) >= 18 {
				if rate := (uint32(streamInfo[10])<<12 | uint32(streamInfo[11])<<4 | uint32(streamInfo[12])>>4) & 0xfffff; rate > 0 {
					track.SampleRate = int(rate)
				}
				track.Channels = int((streamInfo[12]>>1)&0x07) + 1
				track.Codec = "flac"
			}
			continue
		}
	}
	if track.SampleRate > 0 {
		if granule, ok := oggLastGranule(body); ok {
			milliseconds := int64(granule) * 1000 / int64(track.SampleRate)
			if milliseconds > 0 && milliseconds <= maxAudioDurationMS {
				track.DurationMS = milliseconds
			}
		}
	}
	return track, track.hasFacts()
}

// opusGranuleRate is the fixed Opus granule clock.
const opusGranuleRate = 48000

// maxOGGHeaderScan bounds the identification-header scan.
const maxOGGHeaderScan = 64 << 10

// maxAudioDurationMS bounds a declared or derived duration at one hundred
// years; a longer value is treated as corrupt rather than durable.
const maxAudioDurationMS = int64(100 * 365 * 24 * 60 * 60 * 1000)

// oggLastGranule reads the granule position of the last page in a bounded tail
// window. A stream whose last page is outside that window reports no duration
// instead of an approximation.
func oggLastGranule(body []byte) (uint64, bool) {
	start := 0
	if len(body) > maxOGGHeaderScan {
		start = len(body) - maxOGGHeaderScan
	}
	index := bytes.LastIndex(body[start:], []byte("OggS"))
	if index < 0 {
		return 0, false
	}
	offset := start + index
	if offset+14 > len(body) {
		return 0, false
	}
	return binary.LittleEndian.Uint64(body[offset+6 : offset+14]), true
}

func oggPackets(body []byte) [][]byte {
	var packets [][]byte
	var current []byte
	offset := 0
	for offset+27 <= len(body) {
		if !bytes.Equal(body[offset:offset+4], []byte("OggS")) {
			offset++
			continue
		}
		nsegs := int(body[offset+26])
		table := offset + 27
		if nsegs < 0 || table+nsegs > len(body) {
			break
		}
		pos := table + nsegs
		if body[offset+5]&0x01 == 0 && len(current) > 0 {
			packets = append(packets, current)
			current = nil
		}
		for i := 0; i < nsegs; i++ {
			n := int(body[table+i])
			if pos+n > len(body) {
				return packets
			}
			current = append(current, body[pos:pos+n]...)
			pos += n
			if n < 255 {
				packets = append(packets, current)
				current = nil
			}
		}
		offset = pos
	}
	if len(current) > 0 {
		packets = append(packets, current)
	}
	return packets
}

func parseID3(body []byte) (audioTrack, bool) {
	if len(body) < 10 || !bytes.Equal(body[:3], []byte("ID3")) {
		return audioTrack{}, false
	}
	version := body[3]
	if version < 3 || version > 4 {
		return audioTrack{}, false
	}
	size := synchsafe(body[6:10])
	if size < 0 || 10+size > len(body) {
		size = len(body) - 10
	}
	payload := body[10 : 10+size]
	track := audioTrack{}
	for len(payload) >= 10 {
		id := string(payload[:4])
		var frameSize int
		if version == 4 {
			frameSize = synchsafe(payload[4:8])
		} else {
			frameSize = int(binary.BigEndian.Uint32(payload[4:8]))
		}
		if frameSize < 1 || 10+frameSize > len(payload) {
			break
		}
		data := payload[10 : 10+frameSize]
		payload = payload[10+frameSize:]
		if id[0] != 'T' {
			continue
		}
		text := decodeID3Text(data)
		if text == "" {
			continue
		}
		switch id {
		case "TIT2":
			track.Title = text
		case "TPE1":
			track.Artist = text
		case "TALB":
			track.Album = text
		case "TRCK":
			track.Track = parseTrackNumber(text)
		case "TYER", "TDRC":
			if len(text) >= 4 {
				track.Year = text[:4]
			} else {
				track.Year = text
			}
		}
	}
	return track, track.Title != "" || track.Artist != "" || track.Album != ""
}

func parseFLAC(body []byte) (audioTrack, bool) {
	if len(body) < 42 || !bytes.Equal(body[:4], []byte("fLaC")) {
		return audioTrack{}, false
	}
	offset := 4
	track := audioTrack{}
	for offset+4 <= len(body) {
		header := body[offset]
		length := int(body[offset+1])<<16 | int(body[offset+2])<<8 | int(body[offset+3])
		offset += 4
		if offset+length > len(body) {
			break
		}
		block := body[offset : offset+length]
		offset += length
		kind := header & 0x7f
		switch kind {
		case 0:
			if len(block) >= 18 {
				rate := (uint32(block[10])<<12 | uint32(block[11])<<4 | uint32(block[12])>>4) & 0xfffff
				channels := int((block[12]>>1)&0x07) + 1
				samples := uint64(block[13]&0x0f)<<32 | uint64(block[14])<<24 | uint64(block[15])<<16 | uint64(block[16])<<8 | uint64(block[17])
				if rate > 0 {
					track.SampleRate = int(rate)
					track.Channels = channels
					track.Codec = "flac"
					if samples > 0 {
						if milliseconds := int64(samples * 1000 / uint64(rate)); milliseconds > 0 && milliseconds <= maxAudioDurationMS {
							track.DurationMS = milliseconds
						}
					}
				}
			}
		case 4:
			parseVorbisComment(block, &track)
		}
		if header&0x80 != 0 {
			break
		}
	}
	return track, track.Title != "" || track.Artist != "" || track.Album != "" || track.DurationMS > 0
}

func parseVorbisComment(block []byte, track *audioTrack) {
	if len(block) < 4 {
		return
	}
	vendorLen := int(binary.LittleEndian.Uint32(block[:4]))
	offset := 4 + vendorLen
	if offset+4 > len(block) {
		return
	}
	count := int(binary.LittleEndian.Uint32(block[offset : offset+4]))
	offset += 4
	for i := 0; i < count && offset+4 <= len(block); i++ {
		n := int(binary.LittleEndian.Uint32(block[offset : offset+4]))
		offset += 4
		if n < 0 || offset+n > len(block) {
			return
		}
		entry := string(block[offset : offset+n])
		offset += n
		key, value, ok := strings.Cut(entry, "=")
		if !ok {
			continue
		}
		switch strings.ToUpper(key) {
		case "TITLE":
			track.Title = value
		case "ARTIST":
			track.Artist = value
		case "ALBUM":
			track.Album = value
		case "TRACKNUMBER":
			track.Track = parseTrackNumber(value)
		case "DATE":
			if len(value) >= 4 {
				track.Year = value[:4]
			} else {
				track.Year = value
			}
		}
	}
}

func decodeID3Text(data []byte) string {
	if len(data) == 0 {
		return ""
	}
	encoding, payload := data[0], data[1:]
	payload = bytes.TrimRight(payload, "\x00")
	switch encoding {
	case 0:
		return string(payload)
	case 3:
		if utf8.Valid(payload) {
			return string(payload)
		}
	case 1, 2:
		if len(payload) >= 2 && payload[0] == 0xff && payload[1] == 0xfe {
			payload = payload[2:]
			runes := make([]rune, 0, len(payload)/2)
			for i := 0; i+1 < len(payload); i += 2 {
				runes = append(runes, rune(binary.LittleEndian.Uint16(payload[i:i+2])))
			}
			return strings.TrimRight(string(runes), "\x00")
		}
	}
	if utf8.Valid(payload) {
		return string(payload)
	}
	return ""
}

func parseTrackNumber(value string) int {
	value, _, _ = strings.Cut(value, "/")
	n, _ := strconv.Atoi(strings.TrimSpace(value))
	if n < 0 {
		return 0
	}
	return n
}

func synchsafe(b []byte) int {
	if len(b) < 4 {
		return 0
	}
	return int(b[0]&0x7f)<<21 | int(b[1]&0x7f)<<14 | int(b[2]&0x7f)<<7 | int(b[3]&0x7f)
}

// --- RIFF-WAVE ---

// parseWAVE reads the declared format and the declared data length.
func parseWAVE(body []byte) (audioTrack, bool) {
	if len(body) < 12 || string(body[:4]) != "RIFF" || string(body[8:12]) != "WAVE" {
		return audioTrack{}, false
	}
	track := audioTrack{Container: "wave"}
	byteRate := 0
	dataBytes := -1
	for _, chunk := range riffChunks(body, 12) {
		switch chunk.kind {
		case "fmt ":
			if len(chunk.payload) < 16 {
				return audioTrack{}, false
			}
			tag := binary.LittleEndian.Uint16(chunk.payload[0:2])
			track.Channels = int(binary.LittleEndian.Uint16(chunk.payload[2:4]))
			track.SampleRate = int(binary.LittleEndian.Uint32(chunk.payload[4:8]))
			byteRate = int(binary.LittleEndian.Uint32(chunk.payload[8:12]))
			if name, ok := waveFormatName(tag); ok {
				track.Codec = name
			}
		case "data":
			dataBytes = len(chunk.payload)
		}
	}
	if dataBytes > 0 && byteRate > 0 {
		if milliseconds := int64(dataBytes) * 1000 / int64(byteRate); milliseconds > 0 && milliseconds <= maxAudioDurationMS {
			track.DurationMS = milliseconds
		}
	}
	return track, track.hasFacts()
}

// waveFormatName maps the declared WAVE format tag to a stable codec name. An
// unlisted tag stays unnamed instead of becoming a number that looks like a
// codec.
func waveFormatName(tag uint16) (string, bool) {
	switch tag {
	case 0x0001:
		return "pcm", true
	case 0x0002:
		return "adpcm-ms", true
	case 0x0003:
		return "pcm-float", true
	case 0x0006:
		return "alaw", true
	case 0x0007:
		return "mulaw", true
	case 0x0011:
		return "adpcm-ima", true
	case 0x0050:
		return "mp2", true
	case 0x0055:
		return "mp3", true
	case 0x2000:
		return "ac3", true
	case 0xfffe:
		return "wave-format-extensible", true
	default:
		return "", false
	}
}

// --- ISO base media audio (m4a) ---

type isoAudioFacts struct {
	Codec      string
	SampleRate int
	Channels   int
}

// parseISOAudio reads an ISO base media audio file: the movie header duration
// and the first audio sample entry's declared codec, rate, and channels.
func parseISOAudio(body []byte) (audioTrack, bool) {
	track := audioTrack{Container: "iso-bmff"}
	boxes, ok := isoBoxes(body, 0)
	if !ok {
		return audioTrack{}, false
	}
	sawMovie := false
	for _, box := range boxes {
		if box.kind != "moov" {
			continue
		}
		sawMovie = true
		children, ok := isoBoxes(box.payload, 1)
		if !ok {
			return audioTrack{}, false
		}
		for _, child := range children {
			switch child.kind {
			case "mvhd":
				if duration, ok := isoMovieDurationMS(child.payload); ok {
					track.DurationMS = duration
				}
			case "trak":
				facts, ok := parseISOAudioTrack(child.payload)
				if !ok {
					return audioTrack{}, false
				}
				if track.Codec == "" {
					track.Codec = facts.Codec
				}
				if track.SampleRate == 0 {
					track.SampleRate = facts.SampleRate
				}
				if track.Channels == 0 {
					track.Channels = facts.Channels
				}
			}
		}
	}
	if !sawMovie {
		return audioTrack{}, false
	}
	return track, track.hasFacts()
}

func parseISOAudioTrack(payload []byte) (isoAudioFacts, bool) {
	var facts isoAudioFacts
	children, ok := isoBoxes(payload, 0)
	if !ok {
		return facts, false
	}
	trackKind := ""
	for _, child := range children {
		if child.kind != "mdia" {
			continue
		}
		mdiaChildren, ok := isoBoxes(child.payload, 0)
		if !ok {
			return facts, false
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
					return facts, false
				}
				for _, minfChild := range minfChildren {
					if minfChild.kind != "stbl" {
						continue
					}
					stblChildren, ok := isoBoxes(minfChild.payload, 0)
					if !ok {
						return facts, false
					}
					for _, stblChild := range stblChildren {
						if stblChild.kind != "stsd" {
							continue
						}
						if codec, sampleRate, channels, ok := isoAudioSampleEntry(stblChild.payload); ok {
							if facts.Codec == "" {
								facts.Codec = codec
							}
							if facts.SampleRate == 0 {
								facts.SampleRate = sampleRate
							}
							if facts.Channels == 0 {
								facts.Channels = channels
							}
						}
					}
				}
			}
		}
	}
	if trackKind != "" && trackKind != "soun" {
		// A video track's sample entry is not an audio declaration.
		return isoAudioFacts{}, true
	}
	return facts, true
}

// isoAudioSampleEntry reads the declared fourcc, channel count, and sample
// rate from the first AudioSampleEntry. All three are optional: a value the
// entry does not declare stays zero and never becomes a fact.
func isoAudioSampleEntry(payload []byte) (string, int, int, bool) {
	if len(payload) < 16 || binary.BigEndian.Uint32(payload[4:8]) < 1 {
		return "", 0, 0, false
	}
	entrySize := int(binary.BigEndian.Uint32(payload[8:12]))
	if entrySize < 16 || 8+entrySize > len(payload) {
		return "", 0, 0, false
	}
	entry := payload[8 : 8+entrySize]
	codec := ""
	if printableFourCC(string(entry[4:8])) {
		codec = string(entry[4:8])
	}
	channels := 0
	sampleRate := 0
	// Box header is 8 bytes; the audio sample entry declares its fields after
	// 16 further reserved bytes: channels, sample size, and a 16.16 rate.
	// The mandatory AudioSampleEntry header is 36 bytes through the
	// 16.16 sample-rate field. Some real files append codec-specific bytes,
	// but their absence must not erase the standard channel/rate facts.
	if len(entry) >= 36 {
		channels = int(binary.BigEndian.Uint16(entry[24:26]))
		rate := binary.BigEndian.Uint32(entry[32:36]) >> 16
		if rate > 0 && rate <= 1<<20 {
			sampleRate = int(rate)
		}
	}
	return codec, sampleRate, channels, true
}

// --- MPEG audio (mp3, mp2) ---

type mpegAudioFacts struct {
	DurationMS        int64
	DurationEstimated bool
	SampleRate        int
	Channels          int
	Codec             string
}

// parseMPEGAudio reads the first MPEG audio frame header. A declared Xing,
// Info, or VBRI frame count yields an exact duration; otherwise the duration
// is derived from the declared bitrate and is marked as an estimate. A file
// with no readable frame header yields nothing.
func parseMPEGAudio(body []byte) (mpegAudioFacts, bool) {
	facts := mpegAudioFacts{}
	start := id3TagLength(body)
	if start >= len(body) {
		return facts, false
	}
	audio := body[start:]
	limit := len(audio)
	if limit > maxMPEGHeaderScan {
		limit = maxMPEGHeaderScan
	}
	for offset := 0; offset+4 <= limit; offset++ {
		if audio[offset] != 0xff || audio[offset+1]&0xe0 != 0xe0 {
			continue
		}
		header, ok := parseMPEGFrameHeader(audio[offset : offset+4])
		if !ok {
			continue
		}
		facts.SampleRate = header.sampleRate
		facts.Channels = header.channels
		facts.Codec = header.codec
		if frames, ok := mpegDeclaredFrameCount(audio[offset:], header); ok {
			milliseconds := int64(frames) * int64(header.samplesPerFrame) * 1000 / int64(header.sampleRate)
			if milliseconds > 0 && milliseconds <= maxAudioDurationMS {
				facts.DurationMS = milliseconds
			}
			return facts, true
		}
		if header.bitrate > 0 {
			if milliseconds := int64(len(audio)) * 8 * 1000 / int64(header.bitrate); milliseconds > 0 && milliseconds <= maxAudioDurationMS {
				facts.DurationMS = milliseconds
				facts.DurationEstimated = true
			}
		}
		return facts, true
	}
	return facts, false
}

// maxMPEGHeaderScan bounds the search for the first frame sync.
const maxMPEGHeaderScan = 64 << 10

// id3TagLength returns the total length of a leading ID3v2 tag, including an
// optional footer.
func id3TagLength(body []byte) int {
	if len(body) < 10 || string(body[:3]) != "ID3" {
		return 0
	}
	size := synchsafe(body[6:10])
	if size < 0 {
		return 0
	}
	total := 10 + size
	if body[5]&0x10 != 0 {
		total += 10
	}
	if total > len(body) {
		return len(body)
	}
	return total
}

type mpegFrameHeader struct {
	sampleRate      int
	bitrate         int
	channels        int
	samplesPerFrame int
	codec           string
	mpeg1           bool
	mono            bool
}

var mpegBitrateV1 = map[int][15]int{
	1: {0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448},
	2: {0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384},
	3: {0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320},
}

var mpegBitrateV2 = map[int][15]int{
	1: {0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256},
	2: {0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160},
	3: {0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160},
}

// parseMPEGFrameHeader validates and decodes the 4-byte frame header.
func parseMPEGFrameHeader(header []byte) (mpegFrameHeader, bool) {
	var parsed mpegFrameHeader
	if len(header) < 4 || header[0] != 0xff || header[1]&0xe0 != 0xe0 {
		return parsed, false
	}
	versionBits := (header[1] >> 3) & 0x03
	layerBits := (header[1] >> 1) & 0x03
	bitrateIndex := int(header[2] >> 4)
	sampleRateIndex := int((header[2] >> 2) & 0x03)
	if versionBits == 1 || layerBits == 0 || bitrateIndex == 0 || bitrateIndex == 15 || sampleRateIndex == 3 {
		return parsed, false
	}
	var sampleRates [3]int
	switch versionBits {
	case 3: // MPEG 1
		parsed.mpeg1 = true
		sampleRates = [3]int{44100, 48000, 32000}
	case 2: // MPEG 2
		sampleRates = [3]int{22050, 24000, 16000}
	default: // MPEG 2.5
		sampleRates = [3]int{11025, 12000, 8000}
	}
	layer := 4 - int(layerBits) // 1 = Layer I, 2 = Layer II, 3 = Layer III
	table := mpegBitrateV2[layer]
	if parsed.mpeg1 {
		table = mpegBitrateV1[layer]
	}
	bitrate := table[bitrateIndex] * 1000
	if bitrate <= 0 {
		return mpegFrameHeader{}, false
	}
	parsed.sampleRate = sampleRates[sampleRateIndex]
	parsed.bitrate = bitrate
	channelMode := header[3] >> 6
	parsed.mono = channelMode == 3
	parsed.channels = 2
	if parsed.mono {
		parsed.channels = 1
	}
	switch layer {
	case 1:
		parsed.samplesPerFrame = 384
		parsed.codec = "mp1"
	case 2:
		parsed.samplesPerFrame = 1152
		parsed.codec = "mp2"
	default:
		parsed.samplesPerFrame = 1152
		if !parsed.mpeg1 {
			parsed.samplesPerFrame = 576
		}
		parsed.codec = "mp3"
	}
	return parsed, true
}

// mpegDeclaredFrameCount reads a Xing/Info or VBRI frame count, which is a
// declaration inside the stream rather than an estimate.
func mpegDeclaredFrameCount(frame []byte, header mpegFrameHeader) (int, bool) {
	sideInfo := 17
	if header.mpeg1 {
		sideInfo = 32
	}
	if header.mono {
		sideInfo = 9
		if header.mpeg1 {
			sideInfo = 17
		}
	}
	if len(frame) >= 4+sideInfo+8 {
		tag := string(frame[4+sideInfo : 4+sideInfo+4])
		if tag == "Xing" || tag == "Info" {
			flags := binary.BigEndian.Uint32(frame[4+sideInfo+4 : 4+sideInfo+8])
			if flags&0x0001 != 0 && len(frame) >= 4+sideInfo+12 {
				frames := binary.BigEndian.Uint32(frame[4+sideInfo+8 : 4+sideInfo+12])
				if frames > 0 {
					return int(frames), true
				}
			}
			return 0, false
		}
	}
	// VBRI sits at a fixed 32 bytes after the frame header.
	if len(frame) >= 4+32+18 && string(frame[4+32:4+32+4]) == "VBRI" {
		frames := binary.BigEndian.Uint32(frame[4+32+14 : 4+32+18])
		if frames > 0 {
			return int(frames), true
		}
	}
	return 0, false
}
