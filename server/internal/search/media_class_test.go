package search

import (
	"context"
	"errors"
	"testing"
)

// TestMediaClassOfIsOneDerivedProjection pins the single suffix table: a
// recorded suffix maps to its class, case and a leading dot are normalized,
// an empty suffix has no class at all, and a recorded but unclassified suffix
// is "other" — never a guessed class.
func TestMediaClassOfIsOneDerivedProjection(t *testing.T) {
	cases := []struct {
		suffix string
		want   string
	}{
		{"png", MediaClassImage}, {"JPG", MediaClassImage}, {".WebP", MediaClassImage},
		{"heic", MediaClassImage}, {"cr2", MediaClassImage},
		{"mp4", MediaClassVideo}, {"mkv", MediaClassVideo}, {"webm", MediaClassVideo},
		{"mp3", MediaClassAudio}, {"flac", MediaClassAudio}, {"wav", MediaClassAudio},
		{"txt", MediaClassDocument}, {"pdf", MediaClassDocument}, {"docx", MediaClassDocument},
		{"epub", MediaClassDocument}, {"csv", MediaClassDocument},
		{"zip", MediaClassArchive}, {"tar", MediaClassArchive}, {"7z", MediaClassArchive},
		{"xyzzy", MediaClassOther}, {"bin", MediaClassOther}, {"exe", MediaClassOther},
		{"", ""}, {"   ", ""}, {".", ""},
	}
	for _, testCase := range cases {
		if got := MediaClassOf(testCase.suffix); got != testCase.want {
			t.Errorf("MediaClassOf(%q) = %q, want %q", testCase.suffix, got, testCase.want)
		}
	}
}

// TestMediaClassTableOnlyDeclaresKnownClasses keeps the one definitions table
// honest: every entry names a declared class, every key is a normalized
// suffix, and each classified class has at least one suffix so a class can
// never be declared in the vocabulary while being unreachable.
func TestMediaClassTableOnlyDeclaresKnownClasses(t *testing.T) {
	declared := make(map[string]bool, len(MediaClasses))
	for _, class := range MediaClasses {
		declared[class] = true
	}
	seen := map[string]bool{}
	for suffix, class := range mediaClassSuffixes {
		if !declared[class] {
			t.Errorf("suffix %q maps to undeclared class %q", suffix, class)
		}
		if NormalizeSuffix(suffix) != suffix {
			t.Errorf("table key %q is not a normalized suffix", suffix)
		}
		seen[class] = true
	}
	for _, class := range []string{MediaClassImage, MediaClassVideo, MediaClassAudio, MediaClassDocument, MediaClassArchive} {
		if !seen[class] {
			t.Errorf("class %q has no suffix in the definitions table", class)
		}
	}
}

func TestNormalizeMediaClassAcceptsOnlyTheClosedVocabulary(t *testing.T) {
	for _, value := range []string{"image", " IMAGE ", "Video", "document", "archive", "other"} {
		normalized, err := NormalizeMediaClass(value)
		if err != nil {
			t.Fatalf("NormalizeMediaClass(%q) error = %v", value, err)
		}
		if normalized != NormalizeSuffix(value) {
			t.Fatalf("NormalizeMediaClass(%q) = %q, want %q", value, normalized, NormalizeSuffix(value))
		}
	}
	if normalized, err := NormalizeMediaClass("  "); err != nil || normalized != "" {
		t.Fatalf("an empty media_class must be an absent constraint: %q err=%v", normalized, err)
	}
	if _, err := NormalizeMediaClass("banana"); err == nil {
		t.Fatal("a media_class outside the vocabulary must be rejected")
	}
	if _, err := NormalizeMediaClass("images"); err == nil {
		t.Fatal("a near-miss media_class must be rejected, not silently matched")
	}
}

// TestEngineQueryFilteredMediaClassIsDaemonSideAndUnknownStaysUnknown proves
// the derived filter over one built generation: each class returns exactly its
// own recorded suffixes, an entry whose suffix is not recorded has no class
// and matches nothing (including "other"), the existing entry_type filter is
// unchanged, and an invalid class value fails closed as an invalid query.
func TestEngineQueryFilteredMediaClassIsDaemonSideAndUnknownStaysUnknown(t *testing.T) {
	ctx := context.Background()
	engine := &Engine{Dir: t.TempDir()}
	path, err := engine.Build(ctx, "idx_testmediaclass0000000000000000", []Document{
		{SubjectID: "subject-photo", Path: "holiday.png", Name: "holiday.png", Suffix: "png", EntryType: "REGULAR_FILE"},
		{SubjectID: "subject-clip", Path: "clip.mp4", Name: "clip.mp4", Suffix: "mp4", EntryType: "REGULAR_FILE"},
		{SubjectID: "subject-notes", Path: "notes.txt", Name: "notes.txt", Suffix: "txt", EntryType: "REGULAR_FILE"},
		{SubjectID: "subject-mystery", Path: "mystery.xyzzy", Name: "mystery.xyzzy", Suffix: "xyzzy", EntryType: "REGULAR_FILE"},
		{SubjectID: "subject-extensionless", Path: "README", Name: "README", EntryType: "REGULAR_FILE"},
		{SubjectID: "subject-directory", Path: "album", Name: "album", EntryType: "DIRECTORY"},
	})
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	subjects := func(filters Filters) []string {
		t.Helper()
		hits, queryErr := engine.QueryFiltered(ctx, path, "", nil, filters)
		if queryErr != nil {
			t.Fatalf("QueryFiltered(%+v): %v", filters, queryErr)
		}
		out := make([]string, 0, len(hits))
		for _, hit := range hits {
			out = append(out, hit.SubjectID)
		}
		return out
	}
	equal := func(got, want []string, message string) {
		t.Helper()
		if len(got) != len(want) {
			t.Fatalf("%s: got %v, want %v", message, got, want)
		}
		for index := range want {
			if got[index] != want[index] {
				t.Fatalf("%s: got %v, want %v", message, got, want)
			}
		}
	}

	equal(subjects(Filters{MediaClass: "image"}), []string{"subject-photo"}, "image class")
	equal(subjects(Filters{MediaClass: "video"}), []string{"subject-clip"}, "video class")
	equal(subjects(Filters{MediaClass: "audio"}), nil, "audio class with no audio suffix")
	equal(subjects(Filters{MediaClass: "document"}), []string{"subject-notes"}, "document class")
	equal(subjects(Filters{MediaClass: "archive"}), nil, "archive class with no archive suffix")
	// "other" is a recorded suffix the table does not classify. The
	// extensionless README and the directory have no recorded suffix and must
	// not be classified as other.
	equal(subjects(Filters{MediaClass: "other"}), []string{"subject-mystery"}, "other class excludes unrecorded suffixes")
	// Case and whitespace are normalized like the other text facets.
	equal(subjects(Filters{MediaClass: " IMAGE "}), []string{"subject-photo"}, "normalized class value")

	// The existing entry_type filter keeps its behavior: it selects every
	// regular file, whatever its media class or missing suffix.
	equal(subjects(Filters{EntryType: "REGULAR_FILE"}), []string{
		"subject-photo", "subject-clip", "subject-notes", "subject-mystery", "subject-extensionless",
	}, "entry_type REGULAR_FILE")
	equal(subjects(Filters{EntryType: "DIRECTORY"}), []string{"subject-directory"}, "entry_type DIRECTORY")
	// Both filters together intersect, exactly as two typed constraints do.
	equal(subjects(Filters{EntryType: "REGULAR_FILE", MediaClass: "document"}), []string{"subject-notes"}, "entry_type and media_class intersect")

	if _, err := engine.QueryFiltered(ctx, path, "", nil, Filters{MediaClass: "banana"}); !errors.Is(err, ErrInvalidQuery) {
		t.Fatalf("invalid media class error = %v, want ErrInvalidQuery", err)
	}
}
