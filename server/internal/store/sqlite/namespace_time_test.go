package sqlite

import (
	"encoding/json"
	"testing"
	"time"
)

func TestCapturedModificationTime(t *testing.T) {
	tests := []struct {
		name     string
		metadata string
		want     string
		ok       bool
	}{
		{name: "offset and nanosecond precision normalize to UTC", metadata: `{"mod_time":"2024-05-06T07:08:09.123456789+02:30"}`, want: "2024-05-06T04:38:09.123456789Z", ok: true},
		{name: "unix epoch is a valid captured time", metadata: `{"mod_time":"1970-01-01T00:00:00Z"}`, want: "1970-01-01T00:00:00Z", ok: true},
		{name: "pre epoch is valid", metadata: `{"mod_time":"1969-12-31T23:59:59.5Z"}`, want: "1969-12-31T23:59:59.5Z", ok: true},
		{name: "missing", metadata: `{}`, ok: false},
		{name: "null", metadata: `{"mod_time":null}`, ok: false},
		{name: "wrong type", metadata: `{"mod_time":17}`, ok: false},
		{name: "malformed", metadata: `{"mod_time":"yesterday"}`, ok: false},
		{name: "Go zero time", metadata: `{"mod_time":"0001-01-01T00:00:00Z"}`, ok: false},
		{name: "invalid JSON", metadata: `{"mod_time":`, ok: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, ok := CapturedModificationTime(json.RawMessage(test.metadata))
			if ok != test.ok {
				t.Fatalf("CapturedModificationTime() ok = %v, want %v", ok, test.ok)
			}
			if !ok {
				return
			}
			want, err := time.Parse(time.RFC3339Nano, test.want)
			if err != nil {
				t.Fatalf("invalid test expectation: %v", err)
			}
			if !got.Equal(want) || got.Location() != time.UTC {
				t.Fatalf("CapturedModificationTime() = %s (%s), want %s UTC", got.Format(time.RFC3339Nano), got.Location(), test.want)
			}
		})
	}
}
