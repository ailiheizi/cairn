package processor

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	documentTextSourceBytes = 16 << 20
	documentTextOutputBytes = 1 << 20
	documentTextStageTime   = 10 * time.Second
	documentTextProfile     = "cs-document-text-v1"
)

// PDFTextExtract is the host-routed, complete-source PDF body extractor.
type PDFTextExtract struct{}

func (PDFTextExtract) CapabilityID() string { return CapabilityPDFTextExtract }
func (PDFTextExtract) Stage() Stage         { return StageExtract }
func (PDFTextExtract) ProcessingBudget() CapabilityBudget {
	return CapabilityBudget{MaxSourceBytes: documentTextSourceBytes, MaxOutputBytes: documentTextOutputBytes, StageTimeout: documentTextStageTime}
}
func (PDFTextExtract) RunStage(ctx context.Context, inv Invocation) (StageResult, error) {
	return runDocumentTextStage(ctx, inv, extractPDFBody)
}

// DOCXTextExtract reads the admitted main WordprocessingML body without
// unpacking package members to host paths or following relationships.
type DOCXTextExtract struct{}

func (DOCXTextExtract) CapabilityID() string { return CapabilityDOCXTextExtract }
func (DOCXTextExtract) Stage() Stage         { return StageExtract }
func (DOCXTextExtract) ProcessingBudget() CapabilityBudget {
	return CapabilityBudget{MaxSourceBytes: documentTextSourceBytes, MaxOutputBytes: documentTextOutputBytes, StageTimeout: documentTextStageTime}
}
func (DOCXTextExtract) RunStage(ctx context.Context, inv Invocation) (StageResult, error) {
	return runDocumentTextStage(ctx, inv, extractDOCXBody)
}

type documentTextExtractor func(context.Context, []byte, int) (string, error)

func runDocumentTextStage(parent context.Context, inv Invocation, extract documentTextExtractor) (StageResult, error) {
	if parent == nil {
		return failedDocumentText("document extraction requires a context"), nil
	}
	ctx, cancel := context.WithTimeout(parent, documentTextStageTime)
	defer cancel()
	if err := ctx.Err(); err != nil {
		return cancelledDocumentText(err), nil
	}
	if inv.Source == nil || inv.Staging == nil {
		return failedDocumentText("source and staging handles are required"), nil
	}
	if inv.Source.Truncated() {
		return failedDocumentText("document source was truncated by the host budget"), nil
	}
	body, err := inv.Source.ReadAll(ctx)
	if err != nil {
		if ctx.Err() != nil {
			return cancelledDocumentText(ctx.Err()), nil
		}
		return failedDocumentText(err.Error()), nil
	}
	if len(body) == 0 || len(body) > documentTextSourceBytes {
		return failedDocumentText(fmt.Sprintf("document source must be between 1 and %d bytes", documentTextSourceBytes)), nil
	}
	sum := sha256.Sum256(body)
	if inv.Source.ContentID() != "sha256:"+hex.EncodeToString(sum[:]) {
		return failedDocumentText("document source does not match its pinned content identity"), nil
	}
	outputLimit := int64(documentTextOutputBytes)
	if inv.MaxOutputBytes <= 0 {
		return failedDocumentText("document output budget is unavailable"), nil
	}
	if inv.MaxOutputBytes < outputLimit {
		outputLimit = inv.MaxOutputBytes
	}
	text, err := extract(ctx, body, int(outputLimit))
	if err != nil {
		if ctx.Err() != nil || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			if ctx.Err() != nil {
				err = ctx.Err()
			}
			return cancelledDocumentText(err), nil
		}
		return failedDocumentText(err.Error()), nil
	}
	if !utf8.ValidString(text) || strings.TrimSpace(text) == "" || int64(len(text)) > outputLimit {
		return failedDocumentText("document extraction output is empty, invalid UTF-8, or exceeds its output budget"), nil
	}
	if ctx.Err() != nil {
		return cancelledDocumentText(ctx.Err()), nil
	}
	if _, err := inv.Staging.Write([]byte(text)); err != nil {
		return failedDocumentText(err.Error()), nil
	}
	if err := inv.Staging.Seal(); err != nil {
		return failedDocumentText(err.Error()), nil
	}
	return StageResult{
		Status:           StatusSucceeded,
		DeterminismClass: DeterminismByteExact,
		SchemaRef:        SchemaRefExtractedText(),
		MediaType:        MediaTypeUTF8Text,
		Sealed:           true,
	}, nil
}

func failedDocumentText(reason string) StageResult {
	return StageResult{Status: StatusFailed, Reason: reason}
}

func cancelledDocumentText(err error) StageResult {
	if err == nil {
		err = context.Canceled
	}
	return StageResult{Status: StatusCancelled, Reason: err.Error()}
}
