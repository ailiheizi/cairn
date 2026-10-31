package search

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"strings"
	"unicode/utf8"
)

const (
	semanticOCRTextProjectionProfile = "cairn.semantic-ocr-text-projection.v1"
	semanticOCRArtifactSchema        = "cairn.artifact.ocr-text.v1"
	semanticOCRTextLimit             = 256 * 1024
	semanticOCRArtifactBodyLimit     = 1 << 20
)

const semanticOCRTextProjectionSpec = semanticOCRTextProjectionProfile + "|schema=cairn.artifact.ocr-text.v1|strict-json-top-level-schema-state-text|states=TEXT,PARTIAL,EMPTY|utf8-no-repair|text-limit=262144-bytes|segment-target=384-existing-semantic-text-cutter|" + semanticTextSourceSegmentationProfileSpec + "|small-text-one-input|canonical-json-fields=schema,state,text|segment-id=sha256(subject,artifact,revision,body-digest,profile,ordinal,input-digest)|no-source-span"

var semanticOCRTextProjectionProfileDigest = sha256Text(semanticOCRTextProjectionSpec)

type semanticOCRTextEnvelope struct {
	Schema string `json:"schema"`
	State  string `json:"state"`
	Text   string `json:"text"`
}

type semanticOCRTextIdentity struct {
	SubjectID     string `json:"subject_id"`
	SourceRef     string `json:"source_ref"`
	Revision      string `json:"revision"`
	BodyDigest    string `json:"body_digest"`
	ProfileDigest string `json:"profile_digest"`
	Ordinal       int64  `json:"ordinal"`
	InputDigest   string `json:"input_digest"`
}

func semanticOCRTextSegmentID(subject, sourceRef, revision, bodyDigest string, ordinal int64, inputDigest string) string {
	identity := semanticOCRTextIdentity{subject, sourceRef, revision, bodyDigest, semanticOCRTextProjectionProfileDigest, ordinal, inputDigest}
	encoded, _ := json.Marshal(identity)
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:])
}

// semanticOCRTopLevelSchema recognizes only a top-level OCR schema field. A
// malformed object after that field is still treated as known and fails closed.
func semanticOCRTopLevelSchema(body []byte) bool {
	decoder := json.NewDecoder(io.LimitReader(bytes.NewReader(body), semanticOCRArtifactBodyLimit))
	token, err := decoder.Token()
	if err != nil || token != json.Delim('{') {
		return false
	}
	for decoder.More() {
		keyToken, err := decoder.Token()
		if err != nil {
			return false
		}
		key, ok := keyToken.(string)
		if !ok {
			return false
		}
		var value json.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return false
		}
		if key == "schema" {
			var schema string
			if json.Unmarshal(value, &schema) == nil && schema == semanticOCRArtifactSchema {
				return true
			}
		}
	}
	return false
}

func semanticOCRKnownArtifact(body string) bool {
	return semanticOCRTopLevelSchema([]byte(body))
}

func semanticOCRRawStringHasInvalidSurrogate(raw json.RawMessage) bool {
	if len(raw) < 2 || raw[0] != '"' || raw[len(raw)-1] != '"' {
		return true
	}
	for i := 1; i < len(raw)-1; i++ {
		if raw[i] != '\\' {
			continue
		}
		i++
		if i >= len(raw)-1 {
			return true
		}
		if raw[i] != 'u' {
			continue
		}
		if i+4 >= len(raw) {
			return true
		}
		var unit uint16
		for j := 1; j <= 4; j++ {
			c := raw[i+j]
			unit <<= 4
			switch {
			case c >= '0' && c <= '9':
				unit |= uint16(c - '0')
			case c >= 'a' && c <= 'f':
				unit |= uint16(c - 'a' + 10)
			case c >= 'A' && c <= 'F':
				unit |= uint16(c - 'A' + 10)
			default:
				return true
			}
		}
		i += 4
		if unit >= 0xD800 && unit <= 0xDBFF {
			if i+6 >= len(raw) || raw[i+1] != '\\' || raw[i+2] != 'u' {
				return true
			}
			var low uint16
			for j := 3; j <= 6; j++ {
				c := raw[i+j]
				low <<= 4
				switch {
				case c >= '0' && c <= '9':
					low |= uint16(c - '0')
				case c >= 'a' && c <= 'f':
					low |= uint16(c - 'a' + 10)
				case c >= 'A' && c <= 'F':
					low |= uint16(c - 'A' + 10)
				default:
					return true
				}
			}
			if low < 0xDC00 || low > 0xDFFF {
				return true
			}
			i += 6
		} else if unit >= 0xDC00 && unit <= 0xDFFF {
			return true
		}
	}
	return false
}

// projectSemanticOCRArtifact returns recognized semantic inputs. known is true
// for this closed artifact schema; valid distinguishes malformed payloads.
func projectSemanticOCRArtifact(subject, sourceRef, revision, bodyDigest, producer, body string) (segments []SegmentRef, state string, known, valid bool) {
	known = semanticOCRKnownArtifact(body)
	if !known {
		return nil, "", false, false
	}
	if len(body) > semanticOCRArtifactBodyLimit || !validSHA256Text(bodyDigest) || sha256Text(body) != bodyDigest || !utf8.ValidString(body) {
		return nil, "", true, false
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal([]byte(body), &fields); err != nil {
		return nil, "", true, false
	}
	var envelope semanticOCRTextEnvelope
	if err := json.Unmarshal([]byte(body), &envelope); err != nil || envelope.Schema != semanticOCRArtifactSchema {
		return nil, "", true, false
	}
	if semanticOCRRawStringHasInvalidSurrogate(fields["text"]) || !utf8.ValidString(envelope.Text) || len(envelope.Text) > semanticOCRTextLimit {
		return nil, envelope.State, true, false
	}
	switch envelope.State {
	case "TEXT", "PARTIAL", "EMPTY":
	default:
		return nil, envelope.State, true, false
	}
	if envelope.State == "EMPTY" && envelope.Text != "" {
		return nil, envelope.State, true, false
	}
	if strings.TrimSpace(envelope.Text) == "" {
		return nil, envelope.State, true, true
	}
	spans := []semanticTextSpan{{Start: 0, End: len(envelope.Text)}}
	if len(envelope.Text) > semanticTextSourceSegmentTargetBytes {
		var err error
		spans, err = deriveSemanticTextSpans(envelope.Text)
		if err != nil {
			return nil, envelope.State, true, false
		}
	}
	segments = make([]SegmentRef, 0, len(spans))
	for ordinal, span := range spans {
		piece := envelope.Text[span.Start:span.End]
		canonical, err := json.Marshal(semanticOCRTextEnvelope{Schema: semanticOCRArtifactSchema, State: envelope.State, Text: piece})
		if err != nil {
			return nil, envelope.State, true, false
		}
		input := string(canonical)
		inputDigest := sha256Text(input)
		segments = append(segments, SegmentRef{SourceType: "ARTIFACT", SourceID: sourceRef,
			SegmentID: semanticOCRTextSegmentID(subject, sourceRef, revision, bodyDigest, int64(ordinal), inputDigest),
			Ordinal:   int64(ordinal), MatchedText: input, Kind: "EXTRACT", Producer: producer,
			Accepted: true, Language: "und"})
	}
	return segments, envelope.State, true, true
}

func semanticOCRInputSetMatches(row semanticSourceInventoryRow, segments []SegmentRef) bool {
	if row.SourceKind != "EXTRACT" || row.SegmentationProfileDigest != semanticOCRTextProjectionProfileDigest || len(segments) != len(row.Inputs) || len(segments) == 0 {
		return false
	}
	for i, segment := range segments {
		proof := row.Inputs[i]
		digest := sha256Text(segment.MatchedText)
		if proof.Ordinal != int64(i) || proof.SegmentID != segment.SegmentID || proof.InputDigest != digest || proof.SegmentDigest != digest || proof.HasSourceSpan || proof.SourceSpanStart != 0 || proof.SourceSpanEnd != 0 || proof.Disposition != SemanticSourceIndexed || segment.TextSourceProvenance != nil || segment.SegmentID != semanticOCRTextSegmentID(row.SubjectID, row.SourceRef, row.Revision, row.BodyDigest, int64(i), digest) {
			return false
		}
	}
	return true
}
