package controlplane

import (
	"encoding/json"
	"testing"

	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

func TestEntryModifiedAtUsesCapturedTimeAndPreservesPrecision(t *testing.T) {
	tests := []struct {
		name     string
		metadata string
		want     string
	}{
		{name: "offset normalized and nanoseconds retained", metadata: `{"mod_time":"2024-05-06T07:08:09.123456789+02:30"}`, want: "2024-05-06T04:38:09.123456789Z"},
		{name: "epoch retained", metadata: `{"mod_time":"1970-01-01T00:00:00Z"}`, want: "1970-01-01T00:00:00Z"},
		{name: "pre epoch retained", metadata: `{"mod_time":"1969-12-31T23:59:59.5Z"}`, want: "1969-12-31T23:59:59.5Z"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := entryModifiedAt(sqlite.NamespaceEntry{Metadata: json.RawMessage(test.metadata)})
			if got != test.want {
				t.Fatalf("entryModifiedAt() = %q, want %q", got, test.want)
			}
		})
	}

	for _, metadata := range []string{
		`{}`, `{"mod_time":null}`, `{"mod_time":17}`, `{"mod_time":"bad"}`, `{"mod_time":"0001-01-01T00:00:00Z"}`,
	} {
		if got := entryModifiedAt(sqlite.NamespaceEntry{Metadata: json.RawMessage(metadata)}); got != "" {
			t.Errorf("entryModifiedAt(%s) = %q, want absent", metadata, got)
		}
	}
}
