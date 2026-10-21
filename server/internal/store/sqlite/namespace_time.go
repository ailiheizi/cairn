package sqlite

import (
	"encoding/json"
	"strings"
	"time"
)

// CapturedModificationTime returns the scanner-recorded modification time in
// metadata when it is present and valid. It never consults the live source.
func CapturedModificationTime(metadata json.RawMessage) (time.Time, bool) {
	if len(metadata) == 0 {
		return time.Time{}, false
	}
	var snapshot struct {
		ModTime *string `json:"mod_time"`
	}
	if err := json.Unmarshal(metadata, &snapshot); err != nil || snapshot.ModTime == nil {
		return time.Time{}, false
	}

	parsed, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(*snapshot.ModTime))
	if err != nil || parsed.IsZero() {
		return time.Time{}, false
	}
	return parsed.UTC(), true
}
