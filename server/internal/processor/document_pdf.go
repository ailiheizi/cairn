package processor

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	pdf "github.com/giraffesyo/pdf"
)

const (
	maxPDFSourceBytes = 16 << 20
	maxPDFOutputBytes = 1 << 20
	maxPDFPages       = 256
)

// extractPDFBody returns complete body text from an admitted, complete PDF.
// Any parser warning, resource limit, unsupported structure, or empty result
// fails the whole extraction; callers must retain the original on failure.
func extractPDFBody(ctx context.Context, body []byte, maxOutput int) (string, error) {
	if ctx == nil {
		return "", errors.New("PDF extraction requires a context")
	}
	if err := ctx.Err(); err != nil {
		return "", fmt.Errorf("PDF extraction canceled: %w", err)
	}
	if len(body) < len("%PDF-") || !bytes.HasPrefix(body, []byte("%PDF-")) {
		return "", errors.New("input does not have a PDF header")
	}
	if len(body) > maxPDFSourceBytes {
		return "", fmt.Errorf("PDF source exceeds %d bytes", maxPDFSourceBytes)
	}
	if maxOutput <= 0 {
		return "", errors.New("PDF output limit must be positive")
	}
	if maxOutput > maxPDFOutputBytes {
		maxOutput = maxPDFOutputBytes
	}
	if err := rejectEncryptedPDF(ctx, body); err != nil {
		return "", err
	}

	var output strings.Builder
	pageCount := 0
	options := pdf.Options{
		Strict:      true,
		Concurrency: 1,
		Pages:       []pdf.PageRange{{First: 1, Last: maxPDFPages}},
		Limits: pdf.Limits{
			MaxStreamBytes:      8 << 20,
			MaxOperatorsPerPage: 250_000,
			MaxGlyphsPerPage:    50_000,
			MaxFormDepth:        16,
		},
	}
	summary, err := pdf.ExtractPages(ctx, bytes.NewReader(body), int64(len(body)), options, func(page pdf.Page) error {
		if err := ctx.Err(); err != nil {
			return fmt.Errorf("PDF extraction canceled: %w", err)
		}
		pageCount++
		if page.Number < 1 || page.Number > maxPDFPages {
			return fmt.Errorf("PDF page count exceeds %d", maxPDFPages)
		}
		if len(page.Warnings) != 0 {
			return fmt.Errorf("PDF page %d is incomplete: %w", page.Number, page.Warnings[0])
		}
		remaining := maxOutput - output.Len()
		if output.Len() > 0 {
			remaining -= len("\n\n")
		}
		glyphBytes := 0
		for _, glyph := range page.Glyphs {
			if len(glyph.Text) == 0 {
				continue
			}
			if len(glyph.Text) > remaining-glyphBytes {
				return fmt.Errorf("PDF extracted text exceeds %d bytes", maxOutput)
			}
			glyphBytes += len(glyph.Text)
		}
		text := page.Text()
		if !utf8.ValidString(text) {
			return fmt.Errorf("PDF page %d produced invalid UTF-8", page.Number)
		}
		if strings.TrimSpace(text) == "" {
			return nil
		}
		separator := ""
		if output.Len() > 0 {
			separator = "\n\n"
		}
		if output.Len()+len(separator)+len(text) > maxOutput {
			return fmt.Errorf("PDF extracted text exceeds %d bytes", maxOutput)
		}
		output.WriteString(separator)
		output.WriteString(text)
		return nil
	})
	if err != nil {
		return "", fmt.Errorf("PDF extraction failed: %w", err)
	}
	if err := ctx.Err(); err != nil {
		return "", fmt.Errorf("PDF extraction canceled: %w", err)
	}
	if summary == nil {
		return "", errors.New("PDF parser returned no document summary")
	}
	if len(summary.Warnings) != 0 {
		return "", fmt.Errorf("PDF extraction is incomplete: %w", summary.Warnings[0])
	}
	if summary.PageCount < 1 {
		return "", errors.New("PDF contains no pages")
	}
	if summary.PageCount > maxPDFPages || pageCount != summary.PageCount {
		return "", fmt.Errorf("PDF page count %d exceeds the complete extraction bound of %d", summary.PageCount, maxPDFPages)
	}
	result := strings.TrimSpace(output.String())
	if result == "" {
		return "", errors.New("PDF contains no extractable text")
	}
	if !utf8.ValidString(result) || len(result) > maxOutput {
		return "", errors.New("PDF extracted text is outside the valid UTF-8 output bound")
	}
	return result, nil
}

// rejectEncryptedPDF asks the parser to open the document with an unpredictable
// password while selecting no pages. Unencrypted files ignore Password;
// encrypted files fail authentication even when their user password is empty.
// The parser API does not expose trailer encryption state directly, so this
// bounded structural/authentication probe avoids scanning arbitrary stream
// bytes for a token such as /Encrypt.
func rejectEncryptedPDF(ctx context.Context, body []byte) error {
	var nonce [32]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return fmt.Errorf("cannot verify PDF encryption state: %w", err)
	}
	noPage := int(^uint(0) >> 1)
	_, err := pdf.ExtractPages(ctx, bytes.NewReader(body), int64(len(body)), pdf.Options{
		Password:    hex.EncodeToString(nonce[:]),
		Strict:      true,
		Concurrency: 1,
		Pages:       []pdf.PageRange{{First: noPage, Last: noPage}},
	}, func(pdf.Page) error { return nil })
	if err != nil {
		if errors.Is(err, pdf.ErrPasswordRequired) {
			return errors.New("encrypted PDFs are not supported")
		}
		return fmt.Errorf("PDF encryption preflight failed: %w", err)
	}
	return nil
}
