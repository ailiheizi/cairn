package processor

import (
	"bytes"
	"encoding/binary"
	"testing"
)

// The audio reader reports what a container declares. These tests build one
// minimal file per container by hand so both the declared facts and the
// honest absences can be asserted exactly.

func TestAudioTagsMP3XingHeaderDeclaresDuration(t *testing.T) {
	body := buildMP3(t, mp3Fixture{frames: 100, frameCount: 100, trailingBytes: 0})
	track, ok := parseAudioTags(body)
	if !ok {
		t.Fatal("mp3 with a Xing frame count did not parse")
	}
	// 100 frames of 1152 samples at 44100 Hz.
	want := int64(100) * 1152 * 1000 / 44100
	if track.DurationMS != want || track.DurationEstimated {
		t.Fatalf("duration = %d estimated=%v, want %d declared", track.DurationMS, track.DurationEstimated, want)
	}
	if track.SampleRate != 44100 || track.Channels != 2 || track.Codec != "mp3" {
		t.Fatalf("technical facts = %+v", track)
	}
	facts := AudioTags{}.DurableFacts(mustJSON(t, track))
	if containsString(factKeys(facts), FactAudioDurationEstimated) {
		t.Fatalf("a declared duration was labelled an estimate: %+v", facts)
	}
	if !containsString(factKeys(facts), FactAudioDuration) {
		t.Fatalf("missing duration fact: %+v", facts)
	}
}

func TestAudioTagsMP3BitrateEstimateIsLabelled(t *testing.T) {
	body := buildMP3(t, mp3Fixture{frames: 100, trailingBytes: 128})
	track, ok := parseAudioTags(body)
	if !ok {
		t.Fatal("mp3 without a Xing header did not parse")
	}
	if !track.DurationEstimated || track.DurationMS <= 0 {
		t.Fatalf("bitrate-derived duration = %+v", track)
	}
	if track.SampleRate != 44100 || track.Channels != 2 || track.Codec != "mp3" {
		t.Fatalf("technical facts = %+v", track)
	}
	// The estimate is exactly the declared bitrate applied to the audio bytes
	// that follow the tag.
	audioBytes := int64(len(body) - id3TagLength(body))
	want := audioBytes * 8 * 1000 / 128000
	if track.DurationMS != want {
		t.Fatalf("estimated duration = %d, want %d", track.DurationMS, want)
	}
	facts := AudioTags{}.DurableFacts(mustJSON(t, track))
	if !containsString(factKeys(facts), FactAudioDurationEstimated) {
		t.Fatalf("an estimate was not labelled: %+v", facts)
	}
	if !containsString(factKeys(facts), FactAudioDuration) {
		t.Fatalf("missing duration fact: %+v", facts)
	}
}

func TestAudioTagsWithoutDeclaredDurationHasNoDurationFact(t *testing.T) {
	// An ID3 tag with no readable MPEG frame declares tags but no duration,
	// rate, channels, or codec. Nothing is invented for the missing fields.
	tagged := buildID3v23(map[string]string{"TIT2": "Nightfall", "TPE1": "Example Artist"})
	body := append(append([]byte{}, tagged...), []byte{0x00, 0x01, 0x02, 0x03}...)
	track, ok := parseAudioTags(body)
	if !ok || track.Title != "Nightfall" {
		t.Fatalf("tags = %+v ok=%v", track, ok)
	}
	if track.DurationMS != 0 || track.SampleRate != 0 || track.Channels != 0 || track.Codec != "" {
		t.Fatalf("undeclared audio facts were invented: %+v", track)
	}
	facts := AudioTags{}.DurableFacts(mustJSON(t, track))
	if len(facts) != 0 {
		t.Fatalf("facts = %+v, want none", facts)
	}
}

func TestAudioTagsM4ADeclaresMovieDurationAndSampleEntry(t *testing.T) {
	body := buildMP4(t, mp4Fixture{timescale: 1000, duration: 3000, audioCodec: "mp4a"})
	track, ok := parseAudioTags(body)
	if !ok {
		t.Fatal("m4a did not parse")
	}
	if track.Container != "iso-bmff" || track.DurationMS != 3000 {
		t.Fatalf("track = %+v", track)
	}
	if track.Codec != "mp4a" || track.SampleRate != 44100 || track.Channels != 2 {
		t.Fatalf("sample entry facts = %+v", track)
	}
	facts := AudioTags{}.DurableFacts(mustJSON(t, track))
	if containsString(factKeys(facts), FactAudioDurationEstimated) {
		t.Fatalf("a declared duration was labelled an estimate: %+v", facts)
	}
	for _, key := range []string{FactAudioDuration, FactAudioSampleRate, FactAudioChannels, FactAudioCodec} {
		if !containsString(factKeys(facts), key) {
			t.Fatalf("missing fact %q in %+v", key, facts)
		}
	}
}

func TestAudioTagsWAVEDeclaresFormatAndDataLength(t *testing.T) {
	body := buildWAVE(t, 2, 44100, 88200)
	track, ok := parseAudioTags(body)
	if !ok {
		t.Fatal("wave did not parse")
	}
	if track.Container != "wave" || track.Codec != "pcm" || track.Channels != 2 || track.SampleRate != 44100 {
		t.Fatalf("track = %+v", track)
	}
	if track.DurationMS != 500 || track.DurationEstimated {
		t.Fatalf("duration = %d estimated=%v, want the declared 500 ms", track.DurationMS, track.DurationEstimated)
	}
	// A truncated data chunk declares no length for the bytes we hold, so no
	// duration is reported.
	truncated := buildWAVE(t, 2, 44100, 88200)
	truncated = truncated[:len(truncated)-4096]
	partial, ok := parseAudioTags(truncated)
	if !ok {
		t.Fatal("truncated wave should still declare its format")
	}
	if partial.DurationMS != 0 {
		t.Fatalf("a truncated data chunk produced a duration: %+v", partial)
	}
}

func TestAudioTagsOGGDeclaresGranuleDuration(t *testing.T) {
	body := buildOGGOggStream(t, 44100, 2, 44100)
	track, ok := parseAudioTags(body)
	if !ok {
		t.Fatal("ogg did not parse")
	}
	if track.Container != "ogg" || track.Codec != "vorbis" || track.SampleRate != 44100 || track.Channels != 2 {
		t.Fatalf("track = %+v", track)
	}
	if track.DurationMS != 1000 {
		t.Fatalf("duration = %d, want 1000 ms from the last granule", track.DurationMS)
	}
	// An OGG page without a granule clock declares no duration.
	noGranule := buildOGGOggStream(t, 44100, 2, 0)
	track, ok = parseAudioTags(noGranule)
	if !ok || track.DurationMS != 0 {
		t.Fatalf("zero granule produced a duration: %+v ok=%v", track, ok)
	}
	if track.Codec != "vorbis" || track.SampleRate != 44100 {
		t.Fatalf("zero-granule facts = %+v", track)
	}
}

func TestAudioTagsFLACKeepsItsTagsAndDeclaresStreamInfo(t *testing.T) {
	body := buildFLAC("Harbor", "Other Artist", "Live", 3, 44100, 22050)
	track, ok := parseAudioTags(body)
	if !ok {
		t.Fatal("flac did not parse")
	}
	if track.Title != "Harbor" || track.Album != "Live" || track.Track != 3 {
		t.Fatalf("flac tags = %+v", track)
	}
	if track.DurationMS != 500 || track.DurationEstimated {
		t.Fatalf("flac duration = %d estimated=%v", track.DurationMS, track.DurationEstimated)
	}
	if track.SampleRate != 44100 || track.Channels != 1 || track.Codec != "flac" {
		t.Fatalf("flac stream info = %+v", track)
	}
}

type mp3Fixture struct {
	// frames is the number of MPEG frames written.
	frames int
	// frameCount, when non-zero, writes a Xing header declaring that count.
	frameCount int
	// trailingBytes are appended after the last frame, which the bitrate
	// estimate counts and a declared frame count ignores.
	trailingBytes int
}

// buildMP3 writes an ID3v2.3 tag followed by 128 kbps 44.1 kHz stereo MPEG-1
// Layer III frames, optionally with a Xing header in the first frame.
func buildMP3(t *testing.T, fixture mp3Fixture) []byte {
	t.Helper()
	body := buildID3v23(map[string]string{"TIT2": "Nightfall", "TPE1": "Example Artist"})
	frameLength := 144*128000/44100 + 1
	for index := 0; index < fixture.frames; index++ {
		frame := make([]byte, frameLength)
		copy(frame, []byte{0xff, 0xfb, 0x90, 0x00})
		if index == 0 && fixture.frameCount > 0 {
			offset := 4 + 32 // MPEG-1 stereo side information
			copy(frame[offset:offset+4], "Xing")
			binary.BigEndian.PutUint32(frame[offset+4:offset+8], 0x0001)
			binary.BigEndian.PutUint32(frame[offset+8:offset+12], uint32(fixture.frameCount))
		}
		body = append(body, frame...)
	}
	return append(body, bytes.Repeat([]byte{0x11}, fixture.trailingBytes)...)
}

func buildWAVE(t *testing.T, channels, sampleRate, dataBytes int) []byte {
	t.Helper()
	format := make([]byte, 16)
	binary.LittleEndian.PutUint16(format[0:2], 0x0001)
	binary.LittleEndian.PutUint16(format[2:4], uint16(channels))
	binary.LittleEndian.PutUint32(format[4:8], uint32(sampleRate))
	binary.LittleEndian.PutUint32(format[8:12], uint32(sampleRate*channels*2))
	binary.LittleEndian.PutUint16(format[12:14], uint16(channels*2))
	binary.LittleEndian.PutUint16(format[14:16], 16)
	body := append([]byte("WAVE"), riffChunkBytes("fmt ", format)...)
	body = append(body, riffChunkBytes("data", make([]byte, dataBytes))...)
	chunk := riffChunkBytes("RIFF", body)
	binary.LittleEndian.PutUint32(chunk[4:8], uint32(len(chunk)-8))
	return chunk
}

// buildOGG writes a Vorbis identification page, a comment page, and a final
// page whose granule position declares the stream length.
func buildOGGOggStream(t *testing.T, sampleRate, channels int, granule uint64) []byte {
	t.Helper()
	identification := []byte{0x01}
	identification = append(identification, []byte("vorbis")...)
	identification = binary.LittleEndian.AppendUint32(identification, 0)
	identification = append(identification, byte(channels))
	identification = binary.LittleEndian.AppendUint32(identification, uint32(sampleRate))
	comment := []byte{0x03}
	comment = append(comment, []byte("vorbis")...)
	comment = binary.LittleEndian.AppendUint32(comment, 4)
	comment = append(comment, []byte("test")...)
	comment = binary.LittleEndian.AppendUint32(comment, 0)
	setup := []byte{0x05}
	setup = append(setup, []byte("vorbis")...)
	body := buildOggPage(0x02, 0, 0, identification)
	body = append(body, buildOggPage(0x00, 0, 1, comment)...)
	return append(body, buildOggPage(0x04, granule, 2, setup)...)
}

func buildOggPage(headerType byte, granule uint64, sequence uint32, packets ...[]byte) []byte {
	body := append([]byte("OggS"), 0, headerType)
	body = binary.LittleEndian.AppendUint64(body, granule)
	body = binary.LittleEndian.AppendUint32(body, 1)
	body = binary.LittleEndian.AppendUint32(body, sequence)
	body = binary.LittleEndian.AppendUint32(body, 0)
	segments := make([]byte, 0, len(packets))
	payload := make([]byte, 0, 64)
	for _, packet := range packets {
		segments = append(segments, byte(len(packet)))
		payload = append(payload, packet...)
	}
	body = append(body, byte(len(segments)))
	body = append(body, segments...)
	return append(body, payload...)
}
