package controlplane

import (
	"bytes"
	"context"
	"io"
	"path/filepath"
	"testing"
	"time"

	"github.com/ailiheizi/cairn/server/internal/repository"
)

type openCountingDriver struct {
	repository.Driver
	opens  int
	closes int
}

func (d *openCountingDriver) Open(ctx context.Context, contentID string) (io.ReadCloser, error) {
	d.opens++
	body, err := d.Driver.Open(ctx, contentID)
	if err != nil {
		return nil, err
	}
	if seeker, ok := body.(io.Seeker); ok {
		return openCountingSeekReader{openCountingReader: openCountingReader{ReadCloser: body, closed: &d.closes}, seeker: seeker}, nil
	}
	return openCountingReader{ReadCloser: body, closed: &d.closes}, nil
}

type openCountingReader struct {
	io.ReadCloser
	closed *int
}

type openCountingSeekReader struct {
	openCountingReader
	seeker io.Seeker
}

func (r openCountingSeekReader) Seek(offset int64, whence int) (int64, error) {
	return r.seeker.Seek(offset, whence)
}

func (r openCountingReader) Close() error {
	*r.closed++
	return r.ReadCloser.Close()
}

func TestContentSessionReusesSequentialRawAndZstdReaders(t *testing.T) {
	for _, profile := range []string{"raw", "zstd"} {
		t.Run(profile, func(t *testing.T) {
			root := filepath.Join(t.TempDir(), "repository")
			var driver repository.Driver
			var err error
			if profile == "zstd" {
				driver, err = repository.OpenZstdDir(root)
			} else {
				driver, err = repository.OpenDir(root)
			}
			if err != nil {
				t.Fatal(err)
			}
			payload := make([]byte, 3*maxContentRead+17)
			for index := range payload {
				payload[index] = byte((index*19 + index/11) % 251)
			}
			placed, err := driver.Place(context.Background(), bytes.NewReader(payload))
			if err != nil {
				t.Fatal(err)
			}
			counted := &openCountingDriver{Driver: driver}
			sessions := newContentSessions(counted)
			sessions.put(&contentSession{handle: "hdl_test", contentID: placed.ContentID, logicalSize: int64(len(payload))})
			session, ok := sessions.get("hdl_test")
			if !ok {
				t.Fatal("content session was not retained")
			}
			for offset := int64(0); offset < int64(len(payload)); offset += maxContentRead {
				wantEnd := offset + maxContentRead
				if wantEnd > int64(len(payload)) {
					wantEnd = int64(len(payload))
				}
				got, eof, err := sessions.read(context.Background(), session, offset, wantEnd-offset)
				if err != nil {
					t.Fatal(err)
				}
				if !bytes.Equal(got, payload[offset:wantEnd]) || eof != (wantEnd == int64(len(payload))) {
					t.Fatalf("read at %d returned %d bytes, eof=%t", offset, len(got), eof)
				}
			}
			if counted.opens != 1 {
				t.Fatalf("sequential reads opened repository %d times, want 1", counted.opens)
			}
			sessions.close("hdl_test")
			if counted.closes != 1 || session.reader != nil || !session.closed {
				t.Fatalf("close lifecycle: reader closes=%d retained=%t", counted.closes, session.reader != nil)
			}
			if _, _, err := sessions.read(context.Background(), session, 0, 1); err == nil {
				t.Fatal("a request that retained the old pointer reopened a closed session")
			}
		})
	}
}

func TestContentSessionReopensForOutOfOrderReadAndExpiryCloses(t *testing.T) {
	for _, profile := range []string{"raw", "zstd"} {
		t.Run(profile, func(t *testing.T) {
			root := filepath.Join(t.TempDir(), "repository")
			var driver repository.Driver
			var err error
			if profile == "zstd" {
				driver, err = repository.OpenZstdDir(root)
			} else {
				driver, err = repository.OpenDir(root)
			}
			if err != nil {
				t.Fatal(err)
			}
			payload := bytes.Repeat([]byte("cursor-boundary-"), 1000)
			placed, err := driver.Place(context.Background(), bytes.NewReader(payload))
			if err != nil {
				t.Fatal(err)
			}
			counted := &openCountingDriver{Driver: driver}
			sessions := newContentSessions(counted)
			sessions.put(&contentSession{handle: "hdl_test", contentID: placed.ContentID, logicalSize: int64(len(payload))})
			session, _ := sessions.get("hdl_test")
			got, _, err := sessions.read(context.Background(), session, 64, 32)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(got, payload[64:96]) {
				t.Fatal("first offset read returned the wrong bytes")
			}
			got, _, err = sessions.read(context.Background(), session, 7, 16)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(got, payload[7:23]) {
				t.Fatal("out-of-order read returned the wrong bytes")
			}
			wantOpens := 1
			if profile == "zstd" {
				wantOpens = 2
			}
			if counted.opens != wantOpens {
				t.Fatalf("out-of-order %s reads opened repository %d times, want %d", profile, counted.opens, wantOpens)
			}
			sessions.expireHandle("hdl_test", time.Now().Add(-time.Second))
			if sessions.sweep(time.Now()) != 1 {
				t.Fatal("expired content session was not reaped")
			}
			if sessions.len() != 0 || session.reader != nil || !session.closed || counted.closes != counted.opens {
				t.Fatalf("expiry lifecycle: sessions=%d reader=%t opens=%d closes=%d", sessions.len(), session.reader != nil, counted.opens, counted.closes)
			}
			if _, _, err := sessions.read(context.Background(), session, 0, 1); err == nil {
				t.Fatal("a request that retained the expired pointer reopened its reader")
			}
		})
	}
}
