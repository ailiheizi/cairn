package processor

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// The image model's text tower is a Chinese WordPiece encoder
// (RoBERTa-wwm-ext architecture trained by Chinese-CLIP). This loader admits
// exactly one bounded HuggingFace fast-tokenizer profile and rejects everything
// else with a reason; it never guesses at an unsupported tokenizer family.
//
// The encoder implementation is shared with the admitted BGE tokenizer
// (bertTokenizer) because both are the same bounded WordPiece profile. Only the
// admission facts differ: the image profile pins its own vocabulary size and
// special-token layout as declared constants.

var errInvalidClipTextTokenizer = errors.New("invalid admitted image text tokenizer")

// loadClipTextTokenizer admits a tokenizer.json for the image text tower.
func loadClipTextTokenizer(data []byte, maxTokens int) (*bertTokenizer, error) {
	if len(data) == 0 {
		return nil, fmt.Errorf("%w: empty tokenizer data", errInvalidClipTextTokenizer)
	}
	if maxTokens < 3 || maxTokens > imageTextTokenizerMaxTokensPerInput {
		return nil, fmt.Errorf("%w: token budget %d is outside the admitted range", errInvalidClipTextTokenizer, maxTokens)
	}
	var raw bertTokenizerJSON
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("%w: decode JSON: %v", errInvalidClipTextTokenizer, err)
	}
	if raw.Version != "1.0" || string(raw.Truncation) != "null" || string(raw.Padding) != "null" {
		return nil, fmt.Errorf("%w: unsupported tokenizer envelope", errInvalidClipTextTokenizer)
	}
	if raw.Normalizer.Type != "BertNormalizer" || !raw.Normalizer.CleanText || !raw.Normalizer.HandleChineseChars ||
		string(raw.Normalizer.StripAccents) != "null" || raw.Normalizer.Lowercase {
		return nil, fmt.Errorf("%w: unsupported normalizer for the %s profile", errInvalidClipTextTokenizer, ImageTextTokenizerProfileID)
	}
	if raw.PreTokenizer.Type != "BertPreTokenizer" || raw.PostProcessor.Type != "TemplateProcessing" ||
		raw.Decoder.Type != "WordPiece" || raw.Decoder.Prefix != imageTextTokenizerContinuingPrefix || !raw.Decoder.Cleanup ||
		raw.Model.Type != "WordPiece" {
		return nil, fmt.Errorf("%w: unsupported tokenizer components", errInvalidClipTextTokenizer)
	}
	if raw.Model.UnkToken != "[UNK]" || raw.Model.ContinuingSubwordPrefix != imageTextTokenizerContinuingPrefix ||
		raw.Model.MaxInputCharsPerWord != imageTextTokenizerMaxCharsPerWord || len(raw.Model.Vocab) != imageTextTokenizerVocabSize {
		return nil, fmt.Errorf("%w: unsupported WordPiece profile", errInvalidClipTextTokenizer)
	}
	wantIDs := map[string]int{"[UNK]": 100, "[CLS]": 101, "[SEP]": 102}
	seenIDs := make(map[int]struct{}, len(raw.Model.Vocab))
	for token, id := range raw.Model.Vocab {
		if id < 0 || id >= len(raw.Model.Vocab) {
			return nil, fmt.Errorf("%w: token %q has out-of-range id", errInvalidClipTextTokenizer, token)
		}
		if _, exists := seenIDs[id]; exists {
			return nil, fmt.Errorf("%w: duplicate vocabulary id %d", errInvalidClipTextTokenizer, id)
		}
		seenIDs[id] = struct{}{}
	}
	for token, wantID := range wantIDs {
		id, ok := raw.Model.Vocab[token]
		if !ok || id != wantID {
			return nil, fmt.Errorf("%w: required token %q has unexpected id", errInvalidClipTextTokenizer, token)
		}
	}
	wantAdded := map[string]int{"[PAD]": 0, "[UNK]": 100, "[CLS]": 101, "[SEP]": 102, "[MASK]": 103}
	if len(raw.AddedTokens) != len(wantAdded) {
		return nil, fmt.Errorf("%w: unexpected added-token set", errInvalidClipTextTokenizer)
	}
	for _, token := range raw.AddedTokens {
		wantID, ok := wantAdded[token.Content]
		if !ok || token.ID != wantID || token.SingleWord || token.LStrip || token.RStrip || token.Normalized || !token.Special ||
			raw.Model.Vocab[token.Content] != wantID {
			return nil, fmt.Errorf("%w: added token %q is inconsistent", errInvalidClipTextTokenizer, token.Content)
		}
	}
	if len(raw.PostProcessor.Single) != 3 || raw.PostProcessor.Single[0].SpecialToken == nil || raw.PostProcessor.Single[1].Sequence == nil ||
		raw.PostProcessor.Single[2].SpecialToken == nil ||
		raw.PostProcessor.Single[0].SpecialToken.ID != "[CLS]" || raw.PostProcessor.Single[0].SpecialToken.TypeID != 0 ||
		raw.PostProcessor.Single[1].Sequence.ID != "A" || raw.PostProcessor.Single[1].Sequence.TypeID != 0 ||
		raw.PostProcessor.Single[2].SpecialToken.ID != "[SEP]" || raw.PostProcessor.Single[2].SpecialToken.TypeID != 0 {
		return nil, fmt.Errorf("%w: unsupported single-sequence post processor", errInvalidClipTextTokenizer)
	}
	if len(raw.PostProcessor.SpecialTokens) != 2 {
		return nil, fmt.Errorf("%w: unexpected post-processor tokens", errInvalidClipTextTokenizer)
	}
	for token, wantID := range map[string]int{"[CLS]": 101, "[SEP]": 102} {
		special, ok := raw.PostProcessor.SpecialTokens[token]
		if !ok || special.ID != token || len(special.IDs) != 1 || special.IDs[0] != wantID ||
			len(special.Tokens) != 1 || special.Tokens[0] != token {
			return nil, fmt.Errorf("%w: post-processor token %q is inconsistent", errInvalidClipTextTokenizer, token)
		}
	}
	// Longest-first added-token scanning, matching the shared encoder.
	added := append([]bertAddedToken(nil), raw.AddedTokens...)
	for i := 0; i < len(added); i++ {
		for j := i + 1; j < len(added); j++ {
			if len(added[j].Content) > len(added[i].Content) {
				added[i], added[j] = added[j], added[i]
			}
		}
	}
	return &bertTokenizer{
		vocab: raw.Model.Vocab, unknownID: 100, clsID: 101, sepID: 102,
		continuingPrefix: raw.Model.ContinuingSubwordPrefix, maxInputCharsPerWord: raw.Model.MaxInputCharsPerWord,
		maxTokens: maxTokens, addedTokens: added,
	}, nil
}

// ClipTextTokenizerProfileFacts is the declared profile identity used by the
// image bundle descriptor's tokenizer_version field.
func ClipTextTokenizerProfileFacts() string {
	return strings.TrimSpace(ImageTextTokenizerProfileID)
}
