package processor

import (
	"archive/zip"
	"bytes"
	"context"
	"fmt"
	"strings"
	"testing"
)

const testDOCXContentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<ct:Types xmlns:ct="http://schemas.openxmlformats.org/package/2006/content-types">
  <ct:Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</ct:Types>`

func testDOCXDocument(inner string) string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<x:document xmlns:x="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <x:body>` + inner + `</x:body>
</x:document>`
}

func makeDOCX(t *testing.T, members ...[2]string) []byte {
	t.Helper()
	var body bytes.Buffer
	zw := zip.NewWriter(&body)
	for _, member := range members {
		w, err := zw.Create(member[0])
		if err != nil {
			t.Fatalf("create ZIP member %q: %v", member[0], err)
		}
		if _, err := w.Write([]byte(member[1])); err != nil {
			t.Fatalf("write ZIP member %q: %v", member[0], err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("close DOCX ZIP: %v", err)
	}
	return body.Bytes()
}

func validDOCX(t *testing.T, document string, extras ...[2]string) []byte {
	t.Helper()
	members := [][2]string{
		{docxContentTypesPath, testDOCXContentTypes},
		{docxDocumentPath, document},
	}
	members = append(members, extras...)
	return makeDOCX(t, members...)
}

func TestExtractDOCXBodyParagraphsTablesAndCJK(t *testing.T) {
	document := testDOCXDocument(`<x:p><x:r><x:t>第一段</x:t><x:tab/><x:t>tab后</x:t><x:br/><x:t>换行</x:t></x:r></x:p>
  <x:p><x:r><x:t>第二段</x:t><x:del><x:r><x:delText>删除文字</x:delText></x:r></x:del><x:instrText>隐藏指令</x:instrText><x:t>保留文字</x:t></x:r></x:p>
  <x:tbl><x:tr><x:tc><x:p><x:r><x:t>左格</x:t></x:r></x:p></x:tc><x:tc><x:p><x:r><x:t>右格</x:t></x:r></x:p></x:tc></x:tr></x:tbl>`)
	body := validDOCX(t, document)
	got, err := extractDOCXBody(context.Background(), body, docxMaxOutputBytes)
	if err != nil {
		t.Fatal(err)
	}
	want := "第一段\ttab后\n换行\n第二段保留文字\n左格\n\t右格\n\t\n"
	if got != want {
		t.Fatalf("extracted text = %q, want %q", got, want)
	}
	for _, unwanted := range []string{"删除文字", "隐藏指令"} {
		if strings.Contains(got, unwanted) {
			t.Fatalf("extracted deleted/instruction text %q", unwanted)
		}
	}
}

func TestExtractDOCXBodyIgnoresNonBodyAndDoesNotFollowRelationships(t *testing.T) {
	document := `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:header><w:p><w:r><w:t>header-not-body</w:t></w:r></w:p></w:header>
<w:body><w:p><w:r><w:t>body-only</w:t></w:r></w:p></w:body>
<w:comments><w:comment><w:p><w:r><w:t>comment-not-body</w:t></w:r></w:p></w:comment></w:comments>
</w:document>`
	rels := `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="https://example.invalid/document.xml" TargetMode="External"/></Relationships>`
	body := validDOCX(t, document, [2]string{"_rels/.rels", rels})
	got, err := extractDOCXBody(context.Background(), body, 1024)
	if err != nil {
		t.Fatal(err)
	}
	if got != "body-only\n" {
		t.Fatalf("got %q, want only main body text", got)
	}
}

func TestExtractDOCXBodyRefusesMalformedAndUnsupportedPackages(t *testing.T) {
	tests := []struct {
		name    string
		body    []byte
		wantErr string
	}{
		{name: "malformed zip", body: []byte("not a zip"), wantErr: "ZIP"},
		{name: "malformed xml", body: validDOCX(t, `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p>`), wantErr: "XML"},
		{name: "missing body", body: validDOCX(t, `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>`), wantErr: "body"},
		{name: "empty text", body: validDOCX(t, testDOCXDocument(`<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>`)), wantErr: "text"},
		{name: "external chunk", body: validDOCX(t, testDOCXDocument(`<w:altChunk xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>`)), wantErr: "unsupported"},
		{name: "office math", body: validDOCX(t, testDOCXDocument(`<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:r><m:t>2+2</m:t></m:r></m:oMath>`)), wantErr: "math"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := extractDOCXBody(context.Background(), tt.body, docxMaxOutputBytes)
			if err == nil || !strings.Contains(strings.ToLower(err.Error()), strings.ToLower(tt.wantErr)) {
				t.Fatalf("error = %v, want it to contain %q", err, tt.wantErr)
			}
		})
	}

	macroTypes := strings.Replace(testDOCXContentTypes, docxMainContentType, "application/vnd.ms-word.document.macroEnabled.main+xml", 1)
	macro := makeDOCX(t, [2]string{docxContentTypesPath, macroTypes}, [2]string{docxDocumentPath, testDOCXDocument(`<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:r><w:t>text</w:t></w:r></w:p>`)})
	if _, err := extractDOCXBody(context.Background(), macro, 1024); err == nil {
		t.Fatal("macro-enabled package was accepted")
	}
}

func TestExtractDOCXBodyRefusesUnsafeAndDuplicateMembers(t *testing.T) {
	document := testDOCXDocument(`<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:r><w:t>safe</w:t></w:r></w:p>`)
	for _, name := range []string{"../escape", "/absolute", `word\\document.xml`, "word/./document.xml", "C:/drive"} {
		t.Run("unsafe-"+strings.ReplaceAll(name, "/", "_"), func(t *testing.T) {
			safeName := strings.Repeat("a", len(name))
			body := validDOCX(t, document, [2]string{safeName, "x"})
			body = bytes.ReplaceAll(body, []byte(safeName), []byte(name))
			if _, err := extractDOCXBody(context.Background(), body, 1024); err == nil {
				t.Fatalf("unsafe member %q was accepted", name)
			}
		})
	}
	var body bytes.Buffer
	zw := zip.NewWriter(&body)
	for _, content := range []string{testDOCXContentTypes, testDOCXContentTypes} {
		w, err := zw.Create(docxContentTypesPath)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = w.Write([]byte(content))
	}
	w, _ := zw.Create(docxDocumentPath)
	_, _ = w.Write([]byte(document))
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := extractDOCXBody(context.Background(), body.Bytes(), 1024); err == nil || !strings.Contains(err.Error(), "duplicate") {
		t.Fatalf("duplicate member error = %v", err)
	}
}

func TestExtractDOCXBodyEnforcesOutputAndXMLDepthLimits(t *testing.T) {
	body := validDOCX(t, testDOCXDocument(`<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:r><w:t>too long</w:t></w:r></w:p>`))
	if got, err := extractDOCXBody(context.Background(), body, 3); err == nil || got != "" {
		t.Fatalf("limited extraction = %q, %v; want empty result and error", got, err)
	}
	deep := strings.Repeat(`<x:sdt>`, docxMaxXMLDepth) + `<x:p><x:r><x:t>x</x:t></x:r></x:p>` + strings.Repeat(`</x:sdt>`, docxMaxXMLDepth)
	deepBody := validDOCX(t, testDOCXDocument(deep))
	if _, err := extractDOCXBody(context.Background(), deepBody, 1024); err == nil || !strings.Contains(strings.ToLower(err.Error()), "nesting") {
		t.Fatalf("deep XML error = %v", err)
	}
}

func TestExtractDOCXBodyChecksInputContextAndExpansion(t *testing.T) {
	if _, err := extractDOCXBody(context.Background(), make([]byte, docxMaxInputBytes+1), 1024); err == nil {
		t.Fatal("oversized input was accepted")
	}
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := extractDOCXBody(canceled, []byte("x"), 1024); err == nil {
		t.Fatal("canceled extraction was accepted")
	}

	padding := strings.Repeat("z", 11<<20)
	body := validDOCX(t, testDOCXDocument(`<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:r><w:t>ok</w:t></w:r></w:p>`),
		[2]string{"extra/one.bin", padding}, [2]string{"extra/two.bin", padding}, [2]string{"extra/three.bin", padding})
	if len(body) >= docxMaxInputBytes {
		t.Fatalf("compressed expansion fixture unexpectedly large: %d", len(body))
	}
	if _, err := extractDOCXBody(context.Background(), body, 1024); err == nil || !strings.Contains(strings.ToLower(err.Error()), "expansion") {
		t.Fatalf("aggregate expansion error = %v", err)
	}

	largeDocument := testDOCXDocument(`<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:r><w:t>` + strings.Repeat("x", docxMaxDocumentXMLBytes) + `</w:t></w:r></w:p>`)
	largeBody := validDOCX(t, largeDocument)
	if len(largeBody) >= docxMaxInputBytes {
		t.Fatalf("compressed main-XML fixture unexpectedly large: %d", len(largeBody))
	}
	if _, err := extractDOCXBody(context.Background(), largeBody, docxMaxOutputBytes); err == nil || !strings.Contains(strings.ToLower(err.Error()), "main xml") {
		t.Fatalf("main XML size error = %v", err)
	}
}

func TestExtractDOCXBodyRefusesTooManyEntriesAndInvalidContentType(t *testing.T) {
	base := [][2]string{{docxContentTypesPath, testDOCXContentTypes}, {docxDocumentPath, testDOCXDocument(`<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:r><w:t>x</w:t></w:r></w:p>`)}}
	for i := 0; i < docxMaxEntries-1; i++ {
		base = append(base, [2]string{fmt.Sprintf("extra/%04d", i), ""})
	}
	tooMany := makeDOCX(t, base...)
	if _, err := extractDOCXBody(context.Background(), tooMany, 1024); err == nil || !strings.Contains(strings.ToLower(err.Error()), "entries") {
		t.Fatalf("entry count error = %v", err)
	}
	wrongType := strings.Replace(testDOCXContentTypes, docxMainContentType, "text/plain", 1)
	badTypes := makeDOCX(t, [2]string{docxContentTypesPath, wrongType}, [2]string{docxDocumentPath, base[1][1]})
	if _, err := extractDOCXBody(context.Background(), badTypes, 1024); err == nil || !strings.Contains(strings.ToLower(err.Error()), "content type") {
		t.Fatalf("content type error = %v", err)
	}
}
