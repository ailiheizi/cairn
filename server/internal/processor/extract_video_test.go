package processor

import (
	"encoding/binary"
	"encoding/json"
	"math"
	"testing"
)

// The video reader parses container headers, so these tests build the smallest
// structurally valid MP4, Matroska/WebM, and RIFF-AVI files by hand and assert
// both what the parser reports and what it refuses to invent.

func TestVideoMetaReadsISOBaseMedia(t *testing.T) {
	body := buildMP4(t, mp4Fixture{
		timescale: 1000, duration: 5000,
		width: 1280, height: 720,
		videoCodec: "avc1", audioCodec: "mp4a",
	})
	artifact, reason := parseVideoMeta(body)
	if reason != "" {
		t.Fatalf("parse reason = %q", reason)
	}
	if artifact.Schema != SchemaVideoMetaV1 || artifact.Container != "iso-bmff" {
		t.Fatalf("artifact = %+v", artifact)
	}
	if artifact.DurationMS != 5000 || artifact.Width != 1280 || artifact.Height != 720 {
		t.Fatalf("artifact = %+v", artifact)
	}
	if artifact.VideoCodec != "avc1" || artifact.AudioCodec != "mp4a" {
		t.Fatalf("codecs = %q / %q", artifact.VideoCodec, artifact.AudioCodec)
	}
	facts := VideoMeta{}.DurableFacts(mustJSON(t, artifact))
	keys := factKeys(facts)
	for _, want := range []string{
		FactVideoContainer, FactVideoDuration, FactVideoWidth, FactVideoHeight, FactVideoCodec, FactVideoAudioCodec,
	} {
		if !containsString(keys, want) {
			t.Fatalf("missing fact %q in %v", want, keys)
		}
	}
}

func TestVideoMetaUnknownISODurationStaysAbsent(t *testing.T) {
	body := buildMP4(t, mp4Fixture{
		timescale: 1000, duration: 0xffffffff,
		width: 640, height: 360, videoCodec: "hvc1",
	})
	artifact, reason := parseVideoMeta(body)
	if reason != "" {
		t.Fatalf("parse reason = %q", reason)
	}
	if artifact.DurationMS != 0 {
		t.Fatalf("the all-ones duration sentinel became a fact: %+v", artifact)
	}
	if counts := len(VideoMeta{}.DurableFacts(mustJSON(t, artifact))); counts != 4 {
		t.Fatalf("facts = %+v", VideoMeta{}.DurableFacts(mustJSON(t, artifact)))
	}
}

func TestVideoMetaReadsMatroskaAndWebM(t *testing.T) {
	for _, docType := range []string{"matroska", "webm"} {
		body := buildMatroska(t, docType, 6000, 1920, 1080, "V_VP9", "A_OPUS")
		artifact, reason := parseVideoMeta(body)
		if reason != "" {
			t.Fatalf("%s parse reason = %q", docType, reason)
		}
		if artifact.Container != docType {
			t.Fatalf("container = %q, want %q", artifact.Container, docType)
		}
		if artifact.DurationMS != 6000 || artifact.Width != 1920 || artifact.Height != 1080 {
			t.Fatalf("%s artifact = %+v", docType, artifact)
		}
		if artifact.VideoCodec != "V_VP9" || artifact.AudioCodec != "A_OPUS" {
			t.Fatalf("%s codecs = %q / %q", docType, artifact.VideoCodec, artifact.AudioCodec)
		}
	}
}

func TestVideoMetaReadsRIFFAVI(t *testing.T) {
	body := buildAVI(t, aviFixture{
		microSecondsPerFrame: 40000, totalFrames: 100,
		width: 320, height: 240, handler: "XVID",
	})
	artifact, reason := parseVideoMeta(body)
	if reason != "" {
		t.Fatalf("parse reason = %q", reason)
	}
	if artifact.Container != "avi" || artifact.DurationMS != 4000 {
		t.Fatalf("artifact = %+v", artifact)
	}
	if artifact.Width != 320 || artifact.Height != 240 || artifact.VideoCodec != "XVID" {
		t.Fatalf("artifact = %+v", artifact)
	}
}

func TestVideoMetaRejectsMalformedContainers(t *testing.T) {
	valid := buildMP4(t, mp4Fixture{timescale: 1000, duration: 1000, width: 640, height: 480, videoCodec: "avc1"})
	tests := []struct {
		name string
		body []byte
		want string
	}{
		{name: "truncated ftyp", body: valid[:10], want: VideoReasonMalformedContainer},
		{name: "truncated moov", body: valid[:len(valid)-12], want: VideoReasonMalformedContainer},
		{name: "absurd box size", body: append(append([]byte{}, valid[:4]...), append([]byte("ftyp"), 0xff, 0xff, 0xff, 0xff)...), want: VideoReasonMalformedContainer},
		{name: "absurd declared width", body: buildMP4(t, mp4Fixture{timescale: 1000, duration: 1000, width: 0x7fff, height: 480, videoCodec: "avc1"}), want: VideoReasonMalformedContainer},
		{name: "matroska without segment", body: buildEBMLHeader("webm"), want: VideoReasonMalformedContainer},
		{name: "unsupported container", body: []byte("not a media container at all"), want: VideoReasonUnsupportedContainer},
		{name: "ebml non-video doctype", body: buildMatroska(t, "subtitles", 1000, 100, 100, "V_VP9", ""), want: VideoReasonUnsupportedContainer},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, reason := parseVideoMeta(test.body); reason != test.want {
				t.Fatalf("reason = %q, want %q", reason, test.want)
			}
		})
	}
}

func TestVideoMetaContainerWithNoTracksDeclaresOnlyTheContainer(t *testing.T) {
	// A movie header without any track is not an error and not a video: the
	// container and its declared duration are durable, everything else is
	// absent.
	body := buildMP4(t, mp4Fixture{timescale: 1000, duration: 2500, noTracks: true})
	artifact, reason := parseVideoMeta(body)
	if reason != "" {
		t.Fatalf("parse reason = %q", reason)
	}
	if artifact.Container != "iso-bmff" || artifact.DurationMS != 2500 {
		t.Fatalf("artifact = %+v", artifact)
	}
	if artifact.Width != 0 || artifact.Height != 0 || artifact.VideoCodec != "" || artifact.AudioCodec != "" {
		t.Fatalf("a trackless container invented facts: %+v", artifact)
	}
	facts := VideoMeta{}.DurableFacts(mustJSON(t, artifact))
	if len(facts) != 2 || facts[0].Key != FactVideoContainer || facts[1].Key != FactVideoDuration {
		t.Fatalf("facts = %+v", facts)
	}
}

func TestVideoMetaRunStageIsInapplicableForMalformedInput(t *testing.T) {
	result, err := runStageForTest(t, VideoMeta{}, []byte("this is not a media container"))
	if err != nil {
		t.Fatalf("run stage: %v", err)
	}
	if result.Status != StatusInapplicable || result.Reason != VideoReasonUnsupportedContainer {
		t.Fatalf("stage result = %+v", result)
	}
	result, err = runStageForTest(t, VideoMeta{}, buildMP4(t, mp4Fixture{timescale: 1000, duration: 1000, width: 320, height: 240, videoCodec: "avc1"}))
	if err != nil {
		t.Fatalf("run stage: %v", err)
	}
	if result.Status != StatusSucceeded || result.SchemaRef != SchemaRefVideoMeta() || result.MediaType != MediaTypeVideoJSON || !result.Sealed {
		t.Fatalf("stage result = %+v", result)
	}
}

type mp4Fixture struct {
	timescale  uint32
	duration   uint32
	width      int
	height     int
	videoCodec string
	audioCodec string
	noTracks   bool
}

// buildMP4 writes ftyp, moov(mvhd[, trak(tkhd, mdia(hdlr, minf(stbl(stsd))))]).
func buildMP4(t *testing.T, fixture mp4Fixture) []byte {
	t.Helper()
	ftyp := isoBoxBytes("ftyp", append([]byte("isom"), append([]byte{0, 0, 2, 0}, []byte("isomiso2avc1mp41")...)...))
	var moov []byte
	mvhd := make([]byte, 100)
	binary.BigEndian.PutUint32(mvhd[12:16], fixture.timescale)
	binary.BigEndian.PutUint32(mvhd[16:20], fixture.duration)
	moov = append(moov, isoBoxBytes("mvhd", mvhd)...)
	if !fixture.noTracks {
		if fixture.videoCodec != "" {
			moov = append(moov, buildMP4Track(0x00, fixture.videoCodec, fixture.width, fixture.height)...)
		}
		if fixture.audioCodec != "" {
			moov = append(moov, buildMP4Track(0x01, fixture.audioCodec, 0, 0)...)
		}
	}
	return append(ftyp, isoBoxBytes("moov", moov)...)
}

func buildMP4Track(handler byte, codec string, width, height int) []byte {
	if len(codec) != 4 {
		codec = "xxxx"
	}
	handlerName := "vide"
	if handler == 0x01 {
		handlerName = "soun"
	}
	hdlr := make([]byte, 24)
	copy(hdlr[8:12], handlerName)
	// An AudioSampleEntry declares channels and a 16.16 sample rate after 16
	// reserved bytes; a video entry needs only its fourcc for this reader.
	sampleEntry := make([]byte, 32)
	if handler == 0x01 {
		sampleEntry = make([]byte, 36)
		binary.BigEndian.PutUint16(sampleEntry[24:26], 2)
		binary.BigEndian.PutUint32(sampleEntry[32:36], 44100<<16)
	}
	binary.BigEndian.PutUint32(sampleEntry[0:4], uint32(len(sampleEntry)))
	copy(sampleEntry[4:8], codec)
	stsd := append([]byte{0, 0, 0, 0}, 0, 0, 0, 1)
	stsd = append(stsd, sampleEntry...)
	stbl := isoBoxBytes("stbl", isoBoxBytes("stsd", stsd))
	minf := isoBoxBytes("minf", stbl)
	mdia := isoBoxBytes("mdia", append(isoBoxBytes("hdlr", hdlr), minf...))
	tkhd := make([]byte, 84)
	if width > 0 && height > 0 {
		binary.BigEndian.PutUint32(tkhd[76:80], uint32(width)<<16)
		binary.BigEndian.PutUint32(tkhd[80:84], uint32(height)<<16)
	}
	return isoBoxBytes("trak", append(isoBoxBytes("tkhd", tkhd), mdia...))
}

func isoBoxBytes(kind string, payload []byte) []byte {
	body := make([]byte, 8)
	binary.BigEndian.PutUint32(body[0:4], uint32(8+len(payload)))
	copy(body[4:8], kind)
	return append(body, payload...)
}

func buildEBMLHeader(docType string) []byte {
	docTypeElement := ebmlBytes([]byte{0x42, 0x82}, []byte(docType))
	version := ebmlBytes([]byte{0x42, 0x87}, []byte{1})
	return ebmlBytes([]byte{0x1a, 0x45, 0xdf, 0xa3}, append(docTypeElement, version...))
}

func buildMatroska(t *testing.T, docType string, durationMS int64, width, height int, videoCodec, audioCodec string) []byte {
	t.Helper()
	timecode := ebmlBytes([]byte{0x2a, 0xd7, 0xb1}, ebmlUintBytes(uint64(defaultTimecodeNS), 4))
	durationFloat := make([]byte, 8)
	binary.BigEndian.PutUint64(durationFloat, math.Float64bits(float64(durationMS)))
	duration := ebmlBytes([]byte{0x44, 0x89}, durationFloat)
	info := ebmlBytes([]byte{0x15, 0x49, 0xa9, 0x66}, append(timecode, duration...))

	var tracks []byte
	if videoCodec != "" {
		track := ebmlBytes([]byte{0x83}, []byte{1})
		track = append(track, ebmlBytes([]byte{0x86}, []byte(videoCodec))...)
		track = append(track, ebmlBytes([]byte{0xb0}, ebmlUintBytes(uint64(width), 2))...)
		track = append(track, ebmlBytes([]byte{0xba}, ebmlUintBytes(uint64(height), 2))...)
		tracks = append(tracks, ebmlBytes([]byte{0xae}, track)...)
	}
	if audioCodec != "" {
		track := ebmlBytes([]byte{0x83}, []byte{2})
		track = append(track, ebmlBytes([]byte{0x86}, []byte(audioCodec))...)
		tracks = append(tracks, ebmlBytes([]byte{0xae}, track)...)
	}
	tracksElement := ebmlBytes([]byte{0x16, 0x54, 0xae, 0x6b}, tracks)
	segment := ebmlBytes([]byte{0x18, 0x53, 0x80, 0x67}, append(info, tracksElement...))
	return append(buildEBMLHeader(docType), segment...)
}

func ebmlBytes(id []byte, payload []byte) []byte {
	body := append([]byte{}, id...)
	body = append(body, ebmlSizeBytes(len(payload))...)
	return append(body, payload...)
}

func ebmlSizeBytes(size int) []byte {
	if size < 0x7f {
		return []byte{byte(0x80 | size)}
	}
	return []byte{byte(0x40 | (size >> 8)), byte(size)}
}

func ebmlUintBytes(value uint64, width int) []byte {
	body := make([]byte, width)
	for index := width - 1; index >= 0; index-- {
		body[index] = byte(value)
		value >>= 8
	}
	return body
}

type aviFixture struct {
	microSecondsPerFrame uint32
	totalFrames          uint32
	width                int
	height               int
	handler              string
}

func buildAVI(t *testing.T, fixture aviFixture) []byte {
	t.Helper()
	avih := make([]byte, 56)
	binary.LittleEndian.PutUint32(avih[0:4], fixture.microSecondsPerFrame)
	binary.LittleEndian.PutUint32(avih[16:20], fixture.totalFrames)
	binary.LittleEndian.PutUint32(avih[32:36], uint32(fixture.width))
	binary.LittleEndian.PutUint32(avih[36:40], uint32(fixture.height))
	hdrl := riffList("hdrl", riffChunkBytes("avih", avih))

	strh := make([]byte, 56)
	copy(strh[0:4], "vids")
	handler := fixture.handler
	if len(handler) != 4 {
		handler = "XVID"
	}
	copy(strh[4:8], handler)
	binary.LittleEndian.PutUint32(strh[20:24], 1)                   // scale
	binary.LittleEndian.PutUint32(strh[24:28], 25)                  // rate
	binary.LittleEndian.PutUint32(strh[32:36], fixture.totalFrames) // length
	strf := make([]byte, 40)
	binary.LittleEndian.PutUint32(strf[4:8], uint32(fixture.width))
	binary.LittleEndian.PutUint32(strf[8:12], uint32(fixture.height))
	strl := riffList("strl", append(riffChunkBytes("strh", strh), riffChunkBytes("strf", strf)...))

	audioStrh := make([]byte, 56)
	copy(audioStrh[0:4], "auds")
	audioStrf := make([]byte, 16)
	binary.LittleEndian.PutUint16(audioStrf[0:2], 0x0055)
	audioStrl := riffList("strl", append(riffChunkBytes("strh", audioStrh), riffChunkBytes("strf", audioStrf)...))

	body := append([]byte("AVI "), hdrl...)
	body = append(body, strl...)
	body = append(body, audioStrl...)
	chunk := riffChunkBytes("RIFF", body)
	binary.LittleEndian.PutUint32(chunk[4:8], uint32(len(chunk)-8))
	return chunk
}

func riffChunkBytes(kind string, payload []byte) []byte {
	body := append([]byte(kind), byte(len(payload)), byte(len(payload)>>8), byte(len(payload)>>16), byte(len(payload)>>24))
	body = append(body, payload...)
	if len(payload)%2 == 1 {
		body = append(body, 0)
	}
	return body
}

func riffList(listType string, payload []byte) []byte {
	return riffChunkBytes("LIST", append([]byte(listType), payload...))
}

func mustJSON(t *testing.T, value any) []byte {
	t.Helper()
	body, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return body
}

func factKeys(facts []DurableFact) []string {
	keys := make([]string, 0, len(facts))
	for _, fact := range facts {
		keys = append(keys, fact.Key)
	}
	return keys
}
