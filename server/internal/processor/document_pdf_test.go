package processor

import (
	"context"
	"fmt"
	"testing"

	"github.com/giraffesyo/pdf/pdftest"
)

func TestExtractPDFBodyTextAndToUnicode(t *testing.T) {
	data := pdftest.Build(1,
		pdftest.Catalog(2),
		pdftest.Pages(3),
		pdftest.Page(2, 4, "<< /Font << /F1 5 0 R >> >>"),
		pdftest.Stream("", "BT /F1 12 Tf 72 700 Td (hello) Tj ET"),
		pdftest.Helvetica(),
	)
	got, err := extractPDFBody(context.Background(), data, 64)
	if err != nil || got != "hello" {
		t.Fatalf("extractPDFBody = %q, %v; want hello", got, err)
	}

	cjk := pdftest.Build(1,
		pdftest.Catalog(2),
		pdftest.Pages(3),
		pdftest.Page(2, 4, "<< /Font << /F1 5 0 R >> >>"),
		pdftest.Stream("", "BT /F1 12 Tf 72 700 Td "+pdftest.Hex2(1, 2)+" Tj ET"),
		pdftest.Type0Font(6, 7),
		pdftest.CIDFont("/W [1 [500 500]]"),
		pdftest.ToUnicodeCMap("2 beginbfchar\n<0001> <4F60>\n<0002> <597D>\nendbfchar"),
	)
	got, err = extractPDFBody(context.Background(), cjk, 64)
	if err != nil || got != "你好" {
		t.Fatalf("ToUnicode extraction = %q, %v; want 你好", got, err)
	}
}

func TestExtractPDFBodyRejectsIncompleteOrUnsupportedInputs(t *testing.T) {
	tests := []struct {
		name string
		data []byte
	}{
		{name: "not PDF", data: []byte("not a PDF")},
		{name: "malformed PDF", data: []byte("%PDF-1.4\n")},
		{name: "image only", data: pdftest.Build(1,
			pdftest.Catalog(2), pdftest.Pages(3),
			pdftest.Page(2, 4, "<< /XObject << /Im1 6 0 R >> >>"),
			pdftest.Stream("", "/Im1 Do"), pdftest.Helvetica(),
			pdftest.Stream("/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8", "x"),
		)},
		{name: "encrypted", data: pdftest.BuildEncrypted(1, pdftest.EncryptSpec{R: 4},
			pdftest.Catalog(2), pdftest.Pages(3),
			pdftest.Page(2, 4, "<< /Font << /F1 5 0 R >> >>"),
			pdftest.Stream("", "BT /F1 12 Tf 72 700 Td (secret) Tj ET"), pdftest.Helvetica(),
		)},
		{name: "password protected", data: pdftest.BuildEncrypted(1, pdftest.EncryptSpec{R: 4, UserPassword: "user-secret"},
			pdftest.Catalog(2), pdftest.Pages(3),
			pdftest.Page(2, 4, "<< /Font << /F1 5 0 R >> >>"),
			pdftest.Stream("", "BT /F1 12 Tf 72 700 Td (secret) Tj ET"), pdftest.Helvetica(),
		)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if text, err := extractPDFBody(context.Background(), tt.data, 1024); err == nil || text != "" {
				t.Fatalf("extractPDFBody = %q, %v; want empty text and refusal", text, err)
			}
		})
	}
}

func TestExtractPDFBodyEnforcesSourceOutputAndPageBounds(t *testing.T) {
	textPDF := pdftest.Build(1,
		pdftest.Catalog(2), pdftest.Pages(3),
		pdftest.Page(2, 4, "<< /Font << /F1 5 0 R >> >>"),
		pdftest.Stream("", "BT /F1 12 Tf 72 700 Td (too much text) Tj ET"),
		pdftest.Helvetica(),
	)
	if text, err := extractPDFBody(context.Background(), textPDF, 4); err == nil || text != "" {
		t.Fatalf("output-limit extraction = %q, %v; want refusal without partial text", text, err)
	}
	if text, err := extractPDFBody(context.Background(), textPDF, 0); err == nil || text != "" {
		t.Fatalf("zero output bound = %q, %v; want refusal", text, err)
	}
	if text, err := extractPDFBody(context.Background(), textPDF, maxPDFOutputBytes+1); err != nil || text != "too much text" {
		t.Fatalf("output limit clamp = %q, %v", text, err)
	}
	if text, err := extractPDFBody(context.Background(), append([]byte("%PDF-1.4\n"), make([]byte, maxPDFSourceBytes)...), 1024); err == nil || text != "" {
		t.Fatalf("oversize source = %q, %v; want refusal", text, err)
	}

	const pages = maxPDFPages + 1
	objects := make([]string, 0, 2+pages+2)
	objects = append(objects, pdftest.Catalog(2))
	kids := make([]int, pages)
	for i := range kids {
		kids[i] = 3 + i
	}
	objects = append(objects, pdftest.Pages(kids...))
	streamID := 3 + pages
	fontID := streamID + 1
	for range kids {
		objects = append(objects, pdftest.Page(2, streamID, fmt.Sprintf("<< /Font << /F1 %d 0 R >> >>", fontID)))
	}
	// The final two objects are the shared content stream and font. Page
	// references may share a stream; the parser still counts the full tree.
	objects = append(objects, pdftest.Stream("", "BT /F1 12 Tf 72 700 Td (x) Tj ET"), pdftest.Helvetica())
	pagePDF := pdftest.Build(1, objects...)
	if text, err := extractPDFBody(context.Background(), pagePDF, maxPDFOutputBytes); err == nil || text != "" {
		t.Fatalf("over-page-limit extraction = %q, %v; want refusal", text, err)
	}
}

func TestExtractPDFBodyHonorsCancellation(t *testing.T) {
	data := pdftest.Build(1,
		pdftest.Catalog(2), pdftest.Pages(3),
		pdftest.Page(2, 4, "<< /Font << /F1 5 0 R >> >>"),
		pdftest.Stream("", "BT /F1 12 Tf 72 700 Td (cancel) Tj ET"), pdftest.Helvetica(),
	)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if text, err := extractPDFBody(ctx, data, 1024); err == nil || text != "" {
		t.Fatalf("canceled extraction = %q, %v; want refusal", text, err)
	}
}
