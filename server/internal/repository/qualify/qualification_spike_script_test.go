//go:build !windows

package qualify

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestQualificationSpikeReportContractWithMissingEngines(t *testing.T) {
	repoRoot := qualificationRepoRoot(t)
	corpus := t.TempDir()
	payload := []byte("qualification corpus must remain unchanged\n")
	corpusFile := filepath.Join(corpus, "payload.txt")
	if err := os.WriteFile(corpusFile, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	work := filepath.Join(t.TempDir(), "work")
	operatorManifest := filepath.Join(t.TempDir(), "operator-corpus.json")
	manifestCommand := exec.Command("go", "run", "-tags=savingsreport", filepath.Join(repoRoot, "server", "internal", "repository", "savingsreport"),
		"-manifest-only", "-corpus", corpus, "-manifest-out", operatorManifest)
	manifestCommand.Dir = repoRoot
	if output, err := manifestCommand.CombinedOutput(); err != nil {
		t.Fatalf("create operator manifest: %v\n%s", err, output)
	}
	missing := filepath.Join(t.TempDir(), "missing-engine")
	command := exec.Command("bash", filepath.Join(repoRoot, "scripts", "qualification-spike.sh"),
		"--existing-corpus", corpus, "--corpus-manifest", operatorManifest, "--work-dir", work)
	command.Dir = repoRoot
	command.Env = append(os.Environ(),
		"KOPIA_BIN="+missing+"-kopia",
		"RESTIC_BIN="+missing+"-restic",
		"PLAKAR_BIN="+missing+"-plakar",
	)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("qualification script: %v\n%s", err, output)
	}
	after, err := os.ReadFile(corpusFile)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(after, payload) {
		t.Fatal("qualification script changed the supplied corpus")
	}

	report, err := os.Open(filepath.Join(work, "results.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	defer report.Close()
	reader := csv.NewReader(report)
	reader.Comma = '\t'
	reader.FieldsPerRecord = 27
	rows, err := reader.ReadAll()
	if err != nil {
		t.Fatalf("parse results.tsv: %v", err)
	}
	if len(rows) != 4 {
		t.Fatalf("report rows = %d, want header plus three engines", len(rows))
	}
	columns := make(map[string]int, len(rows[0]))
	for i, name := range rows[0] {
		columns[name] = i
	}
	for _, name := range []string{
		"corpus_digest", "run_status", "failure_step", "logical_bytes",
		"dedup_bytes", "compression_bytes", "repository_growth_bytes",
		"catalog_overhead_bytes", "index_overhead_bytes", "model_overhead_bytes",
		"temp_overhead_bytes", "net_savings_bytes",
	} {
		if _, ok := columns[name]; !ok {
			t.Fatalf("report omitted %q: %v", name, rows[0])
		}
	}
	for _, row := range rows[1:] {
		if row[columns["run_status"]] != "FAILED" || row[columns["failure_step"]] != "binary check" {
			t.Fatalf("failure row is ambiguous: %v", row)
		}
		if digest := row[columns["corpus_digest"]]; digest == "" || digest == "UNMEASURED" {
			t.Fatalf("failure row omitted corpus digest: %v", row)
		}
		for _, name := range []string{
			"dedup_bytes", "compression_bytes", "repository_growth_bytes",
			"catalog_overhead_bytes", "index_overhead_bytes", "model_overhead_bytes",
			"temp_overhead_bytes", "net_savings_bytes",
		} {
			if row[columns[name]] != "UNMEASURED" {
				t.Fatalf("failure row %s = %q, want UNMEASURED", name, row[columns[name]])
			}
		}
	}
	manifest, err := os.ReadFile(filepath.Join(work, "corpus.manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(manifest, []byte(`"sha256"`)) || !bytes.Contains(manifest, []byte(`"digest"`)) {
		t.Fatalf("corpus manifest is incomplete: %s", manifest)
	}
}

func TestQualificationSpikeRejectsCorpusDriftBeforeEngine(t *testing.T) {
	repoRoot := qualificationRepoRoot(t)
	corpus := t.TempDir()
	sentinel := filepath.Join(corpus, "payload.txt")
	if err := os.WriteFile(sentinel, []byte("before"), 0o600); err != nil {
		t.Fatal(err)
	}
	manifest := filepath.Join(t.TempDir(), "operator-corpus.json")
	manifestCommand := exec.Command("go", "run", "-tags=savingsreport", filepath.Join(repoRoot, "server", "internal", "repository", "savingsreport"),
		"-manifest-only", "-corpus", corpus, "-manifest-out", manifest)
	manifestCommand.Dir = repoRoot
	if output, err := manifestCommand.CombinedOutput(); err != nil {
		t.Fatalf("create operator manifest: %v\n%s", err, output)
	}
	if err := os.WriteFile(sentinel, []byte("after"), 0o600); err != nil {
		t.Fatal(err)
	}
	work := filepath.Join(t.TempDir(), "work")
	missing := filepath.Join(t.TempDir(), "missing-engine")
	command := exec.Command("bash", filepath.Join(repoRoot, "scripts", "qualification-spike.sh"),
		"--existing-corpus", corpus, "--corpus-manifest", manifest, "--work-dir", work)
	command.Dir = repoRoot
	command.Env = append(os.Environ(),
		"KOPIA_BIN="+missing+"-kopia",
		"RESTIC_BIN="+missing+"-restic",
		"PLAKAR_BIN="+missing+"-plakar",
	)
	output, err := command.CombinedOutput()
	if err == nil {
		t.Fatalf("corpus drift was accepted:\n%s", output)
	}
	if !strings.Contains(string(output), "verify corpus manifest") {
		t.Fatalf("unexpected corpus-drift error: %v\n%s", err, output)
	}
	for _, engine := range []string{"kopia", "restic", "plakar"} {
		if _, statErr := os.Stat(filepath.Join(work, engine+".log")); !os.IsNotExist(statErr) {
			t.Fatalf("%s was invoked before corpus verification: %v", engine, statErr)
		}
	}
	if got, readErr := os.ReadFile(sentinel); readErr != nil || string(got) != "after" {
		t.Fatalf("corpus changed after failed verification: body=%q err=%v", got, readErr)
	}
}

func TestQualificationSpikeRejectsAddedCorpusFileBeforeEngine(t *testing.T) {
	repoRoot := qualificationRepoRoot(t)
	corpus := t.TempDir()
	if err := os.WriteFile(filepath.Join(corpus, "payload.txt"), []byte("before"), 0o600); err != nil {
		t.Fatal(err)
	}
	manifest := filepath.Join(t.TempDir(), "operator-corpus.json")
	manifestCommand := exec.Command("go", "run", "-tags=savingsreport", filepath.Join(repoRoot, "server", "internal", "repository", "savingsreport"),
		"-manifest-only", "-corpus", corpus, "-manifest-out", manifest)
	manifestCommand.Dir = repoRoot
	if output, err := manifestCommand.CombinedOutput(); err != nil {
		t.Fatalf("create operator manifest: %v\n%s", err, output)
	}
	if err := os.WriteFile(filepath.Join(corpus, "unexpected.txt"), []byte("not in manifest"), 0o600); err != nil {
		t.Fatal(err)
	}
	work := filepath.Join(t.TempDir(), "work")
	missing := filepath.Join(t.TempDir(), "missing-engine")
	command := exec.Command("bash", filepath.Join(repoRoot, "scripts", "qualification-spike.sh"),
		"--existing-corpus", corpus, "--corpus-manifest", manifest, "--work-dir", work)
	command.Dir = repoRoot
	command.Env = append(os.Environ(),
		"KOPIA_BIN="+missing+"-kopia",
		"RESTIC_BIN="+missing+"-restic",
		"PLAKAR_BIN="+missing+"-plakar",
	)
	output, err := command.CombinedOutput()
	if err == nil {
		t.Fatalf("added corpus file was accepted:\n%s", output)
	}
	if !strings.Contains(string(output), "verify corpus manifest") {
		t.Fatalf("unexpected added-file error: %v\n%s", err, output)
	}
	for _, engine := range []string{"kopia", "restic", "plakar"} {
		if _, statErr := os.Stat(filepath.Join(work, engine+".log")); !os.IsNotExist(statErr) {
			t.Fatalf("%s was invoked before corpus verification: %v", engine, statErr)
		}
	}
}

func TestQualificationSpikeRefusesExistingGeneratedCorpus(t *testing.T) {
	repoRoot := qualificationRepoRoot(t)
	corpus := t.TempDir()
	sentinel := filepath.Join(corpus, "keep.txt")
	if err := os.WriteFile(sentinel, []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	command := exec.Command("bash", filepath.Join(repoRoot, "scripts", "qualification-spike.sh"),
		"--corpus-dir", corpus, "--work-dir", filepath.Join(t.TempDir(), "work"))
	command.Dir = repoRoot
	output, err := command.CombinedOutput()
	if err == nil {
		t.Fatalf("generated mode accepted an existing corpus destination:\n%s", output)
	}
	if !strings.Contains(string(output), "generated corpus destination already exists") {
		t.Fatalf("unexpected refusal: %v\n%s", err, output)
	}
	if got, readErr := os.ReadFile(sentinel); readErr != nil || string(got) != "keep" {
		t.Fatalf("existing corpus was changed: body=%q err=%v", got, readErr)
	}
}

func TestQualificationSpikeDoesNotCallFailedVerificationSuccessful(t *testing.T) {
	repoRoot := qualificationRepoRoot(t)
	corpus := t.TempDir()
	if err := os.WriteFile(filepath.Join(corpus, "payload.txt"), []byte("verify me\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	fakeRestic := filepath.Join(t.TempDir(), "restic")
	fakeScript := `#!/usr/bin/env bash
set -eu
case "$1" in
    version) printf 'restic qualification-fake\n' ;;
    --help) printf '  check  verify repository\n' ;;
    init)
        mkdir -p "$RESTIC_REPOSITORY"
        printf 'fake repository\n' >"$RESTIC_REPOSITORY/config"
        ;;
    backup)
        printf '%s\n' "$2" >"$RESTIC_REPOSITORY/source"
        ;;
    snapshots) printf 'fake snapshot\n' ;;
    restore)
        source_path=$(cat "$RESTIC_REPOSITORY/source")
        target=$4
        restored="$target/$(basename "$source_path")"
        mkdir -p "$restored"
        cp -R "$source_path"/. "$restored"/
        ;;
    check) exit 1 ;;
    *) exit 2 ;;
esac
`
	if err := os.WriteFile(fakeRestic, []byte(fakeScript), 0o700); err != nil {
		t.Fatal(err)
	}
	work := filepath.Join(t.TempDir(), "work")
	missing := filepath.Join(t.TempDir(), "missing-engine")
	command := exec.Command("bash", filepath.Join(repoRoot, "scripts", "qualification-spike.sh"),
		"--existing-corpus", corpus, "--work-dir", work)
	command.Dir = repoRoot
	command.Env = append(os.Environ(),
		"KOPIA_BIN="+missing+"-kopia",
		"RESTIC_BIN="+fakeRestic,
		"PLAKAR_BIN="+missing+"-plakar",
	)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("qualification script: %v\n%s", err, output)
	}
	report, err := os.Open(filepath.Join(work, "results.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	defer report.Close()
	reader := csv.NewReader(report)
	reader.Comma = '\t'
	reader.FieldsPerRecord = 27
	rows, err := reader.ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range rows[1:] {
		if row[0] != "restic" {
			continue
		}
		if row[16] != "FAILED" || row[17] != "verify" || row[8] != "NO" || row[9] != "YES" {
			t.Fatalf("failed verification row is dishonest: %v", row)
		}
		if row[21] == "" || row[21] == "UNMEASURED" || row[21] == "0" {
			t.Fatalf("completed repository growth was not measured: %v", row)
		}
		return
	}
	t.Fatal("restic result row is missing")
}

func TestQualificationSpikeRejectsCorpusDriftDuringEngine(t *testing.T) {
	repoRoot := qualificationRepoRoot(t)
	corpus := t.TempDir()
	sentinel := filepath.Join(corpus, "payload.txt")
	if err := os.WriteFile(sentinel, []byte("before"), 0o600); err != nil {
		t.Fatal(err)
	}
	fakeRestic := filepath.Join(t.TempDir(), "restic")
	fakeScript := `#!/usr/bin/env bash
set -eu
case "$1" in
    version) printf 'restic qualification-toctou-fake\n' ;;
    --help) printf '  check  verify repository\n' ;;
    init)
        mkdir -p "$RESTIC_REPOSITORY"
        printf 'fake repository\n' >"$RESTIC_REPOSITORY/config"
        ;;
    backup)
        printf 'after-engine-drift' >"$2/payload.txt"
        printf '%s\n' "$2" >"$RESTIC_REPOSITORY/source"
        ;;
    snapshots) printf '[{"id":"fake-snapshot"}]\n' ;;
    restore)
        source_path=$(cat "$RESTIC_REPOSITORY/source")
        target=$4
        restored="$target/$(basename "$source_path")"
        mkdir -p "$restored"
        cp -R "$source_path"/. "$restored"/
        ;;
    check) ;;
    *) exit 2 ;;
esac
`
	if err := os.WriteFile(fakeRestic, []byte(fakeScript), 0o700); err != nil {
		t.Fatal(err)
	}
	work := filepath.Join(t.TempDir(), "work")
	missing := filepath.Join(t.TempDir(), "missing-engine")
	command := exec.Command("bash", filepath.Join(repoRoot, "scripts", "qualification-spike.sh"),
		"--existing-corpus", corpus, "--work-dir", work)
	command.Dir = repoRoot
	command.Env = append(os.Environ(),
		"KOPIA_BIN="+missing+"-kopia",
		"RESTIC_BIN="+fakeRestic,
		"PLAKAR_BIN="+missing+"-plakar",
	)
	output, err := command.CombinedOutput()
	if err == nil {
		t.Fatalf("corpus drift during engine was accepted:\n%s", output)
	}
	if !strings.Contains(string(output), "corpus manifest after engine") {
		t.Fatalf("unexpected TOCTOU error: %v\n%s", err, output)
	}
	report, readErr := os.ReadFile(filepath.Join(work, "results.tsv"))
	if readErr != nil {
		t.Fatal(readErr)
	}
	rows := strings.Split(strings.TrimSpace(string(report)), "\n")
	if len(rows) != 3 {
		t.Fatalf("report rows = %d, want header plus failed kopia/restic rows: %s", len(rows), report)
	}
	for _, row := range rows[1:] {
		fields := strings.Split(row, "\t")
		if len(fields) != 27 {
			t.Fatalf("malformed result row: %q", row)
		}
		if fields[0] == "restic" && (fields[16] == "SUCCEEDED" || fields[17] != "corpus manifest after engine") {
			t.Fatalf("drifted engine was recorded as successful: %v", fields)
		}
	}
}

func TestSavingsReportHeterogeneousProfileMeasuresBothInTreeProfiles(t *testing.T) {
	repoRoot := qualificationRepoRoot(t)
	work := filepath.Join(t.TempDir(), "work")
	command := exec.Command("bash", filepath.Join(repoRoot, "scripts", "savings-report.sh"),
		"--corpus-profile", "heterogeneous", "--profile", "both", "--work-dir", work)
	command.Dir = repoRoot
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("heterogeneous savings report: %v\n%s", err, output)
	}
	manifest, err := os.ReadFile(filepath.Join(work, "generated-corpus.qualification.json"))
	if err != nil {
		t.Fatalf("generated corpus manifest: %v", err)
	}
	for _, marker := range []string{
		`"schema": "cairn.qualification-corpus.v1"`,
		`"license": "self-generated"`,
		`"category": "pdf"`,
		`"category": "opaque"`,
	} {
		if !bytes.Contains(manifest, []byte(marker)) {
			t.Fatalf("generated corpus manifest omitted %s", marker)
		}
	}
	report, err := os.ReadFile(filepath.Join(work, "raw.candidate-evidence.json"))
	if err != nil {
		t.Fatalf("raw candidate report: %v", err)
	}
	zstdReport, err := os.ReadFile(filepath.Join(work, "zstd.candidate-evidence.json"))
	if err != nil {
		t.Fatalf("zstd candidate report: %v", err)
	}
	for name, body := range map[string][]byte{"raw": report, "zstd": zstdReport} {
		for _, marker := range []string{`"LogicalBytes": 4212077`, `"DuplicateBytes": 4760`, `"RepositoryGrowthBytes":`} {
			if !bytes.Contains(body, []byte(marker)) {
				t.Fatalf("%s candidate report omitted %s", name, marker)
			}
		}
	}
	assertGeneratedOperatorCorpusBinding(t, work)
}

func TestSavingsReportSmallGeneratedCorpusBindsBothInTreeProfiles(t *testing.T) {
	repoRoot := qualificationRepoRoot(t)
	work := filepath.Join(t.TempDir(), "work")
	command := exec.Command("bash", filepath.Join(repoRoot, "scripts", "savings-report.sh"),
		"--profile", "both", "--work-dir", work)
	command.Dir = repoRoot
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("small generated savings report: %v\n%s", err, output)
	}
	if _, err := os.Stat(filepath.Join(work, "generated-corpus.qualification.json")); !os.IsNotExist(err) {
		t.Fatalf("small generated corpus wrote a qualification sidecar: %v", err)
	}
	assertGeneratedOperatorCorpusBinding(t, work)
}

func TestSavingsReportRejectsChangedGeneratedCorpusBeforeRepositoryOpen(t *testing.T) {
	repoRoot := qualificationRepoRoot(t)
	root := t.TempDir()
	corpus := filepath.Join(root, "corpus")
	qualificationManifest := filepath.Join(root, "generated-corpus.qualification.json")
	generateCommand := exec.Command("go", "run", "-tags=savingsreport", "./server/internal/repository/savingsreport",
		"-generate-corpus", corpus,
		"-generate-seed", "cairn-phase5-heterogeneous-v1",
		"-manifest-out", qualificationManifest)
	generateCommand.Dir = repoRoot
	if output, err := generateCommand.CombinedOutput(); err != nil {
		t.Fatalf("generate corpus: %v\n%s", err, output)
	}
	operatorManifest := filepath.Join(root, "generated-corpus.operator.manifest.json")
	manifestCommand := exec.Command("go", "run", "-tags=savingsreport", "./server/internal/repository/savingsreport",
		"-manifest-only", "-corpus", corpus, "-manifest-out", operatorManifest)
	manifestCommand.Dir = repoRoot
	if output, err := manifestCommand.CombinedOutput(); err != nil {
		t.Fatalf("build generated operator manifest: %v\n%s", err, output)
	}
	changed := filepath.Join(corpus, "docs", "readme.txt")
	if err := os.WriteFile(changed, []byte("changed after generated operator manifest"), 0o600); err != nil {
		t.Fatal(err)
	}

	work := filepath.Join(root, "work")
	command := exec.Command("bash", filepath.Join(repoRoot, "scripts", "savings-report.sh"),
		"--corpus-dir", corpus, "--corpus-manifest", operatorManifest, "--profile", "raw", "--work-dir", work)
	command.Dir = repoRoot
	output, err := command.CombinedOutput()
	if err == nil {
		t.Fatalf("changed generated corpus was accepted:\n%s", output)
	}
	if !strings.Contains(string(output), "verify corpus manifest") {
		t.Fatalf("unexpected changed generated-corpus failure: %v\n%s", err, output)
	}
	if _, statErr := os.Lstat(filepath.Join(work, "raw-repo")); !os.IsNotExist(statErr) {
		t.Fatalf("repository opened before generated operator manifest rejection: %v", statErr)
	}
}

func TestSavingsReportReviewedManifestBindsBothInTreeProfiles(t *testing.T) {
	repoRoot := qualificationRepoRoot(t)
	root := t.TempDir()
	corpus := filepath.Join(root, "corpus")
	if err := os.Mkdir(corpus, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(corpus, "alpha.txt"), []byte("reviewed alpha"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(corpus, "copy.txt"), []byte("reviewed alpha"), 0o600); err != nil {
		t.Fatal(err)
	}
	manifest := filepath.Join(root, "reviewed.manifest.json")
	manifestCommand := exec.Command("go", "run", "-tags=savingsreport", "./server/internal/repository/savingsreport",
		"-manifest-only", "-corpus", corpus, "-manifest-out", manifest)
	manifestCommand.Dir = repoRoot
	if output, err := manifestCommand.CombinedOutput(); err != nil {
		t.Fatalf("build reviewed manifest: %v\n%s", err, output)
	}

	work := filepath.Join(root, "work")
	command := exec.Command("bash", filepath.Join(repoRoot, "scripts", "savings-report.sh"),
		"--corpus-dir", corpus, "--corpus-manifest", manifest, "--profile", "both", "--work-dir", work, "--keep")
	command.Dir = repoRoot
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("reviewed savings report: %v\n%s", err, output)
	}
	reviewed := mustCandidateCorpusDigest(t, manifest)
	for _, name := range []string{"raw.candidate-evidence.json", "zstd.candidate-evidence.json"} {
		if got := mustCandidateCorpusDigest(t, filepath.Join(work, name)); got != reviewed {
			t.Fatalf("%s corpus digest = %q, want reviewed %q", name, got, reviewed)
		}
	}
}

func TestSavingsReportRejectsChangedReviewedCorpusBeforeRepositoryOpen(t *testing.T) {
	repoRoot := qualificationRepoRoot(t)
	root := t.TempDir()
	corpus := filepath.Join(root, "corpus")
	if err := os.Mkdir(corpus, 0o700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(corpus, "item.txt")
	if err := os.WriteFile(path, []byte("before review"), 0o600); err != nil {
		t.Fatal(err)
	}
	manifest := filepath.Join(root, "reviewed.manifest.json")
	manifestCommand := exec.Command("go", "run", "-tags=savingsreport", "./server/internal/repository/savingsreport",
		"-manifest-only", "-corpus", corpus, "-manifest-out", manifest)
	manifestCommand.Dir = repoRoot
	if output, err := manifestCommand.CombinedOutput(); err != nil {
		t.Fatalf("build reviewed manifest: %v\n%s", err, output)
	}
	if err := os.WriteFile(path, []byte("changed after review"), 0o600); err != nil {
		t.Fatal(err)
	}

	work := filepath.Join(root, "work")
	command := exec.Command("bash", filepath.Join(repoRoot, "scripts", "savings-report.sh"),
		"--corpus-dir", corpus, "--corpus-manifest", manifest, "--profile", "raw", "--work-dir", work, "--keep")
	command.Dir = repoRoot
	output, err := command.CombinedOutput()
	if err == nil {
		t.Fatalf("changed reviewed corpus was accepted:\n%s", output)
	}
	if !strings.Contains(string(output), "verify corpus manifest") {
		t.Fatalf("unexpected changed-corpus failure: %v\n%s", err, output)
	}
	if _, statErr := os.Lstat(filepath.Join(work, "raw-repo")); !os.IsNotExist(statErr) {
		t.Fatalf("repository opened before reviewed manifest rejection: %v", statErr)
	}
}

func assertGeneratedOperatorCorpusBinding(t *testing.T, work string) {
	t.Helper()
	operatorManifest := filepath.Join(work, "generated-corpus.operator.manifest.json")
	operatorBody, err := os.ReadFile(operatorManifest)
	if err != nil {
		t.Fatalf("generated operator corpus manifest: %v", err)
	}
	if !bytes.Contains(operatorBody, []byte(`"schema": "cairn.corpus-manifest.v1"`)) {
		t.Fatalf("generated operator corpus manifest omitted corpus-manifest.v1: %s", operatorBody)
	}
	operatorDigest := mustCandidateCorpusDigest(t, operatorManifest)
	for _, name := range []string{"raw.candidate-evidence.json", "zstd.candidate-evidence.json"} {
		if got := mustCandidateCorpusDigest(t, filepath.Join(work, name)); got != operatorDigest {
			t.Fatalf("%s corpus digest = %q, want generated operator %q", name, got, operatorDigest)
		}
	}
}

func mustCandidateCorpusDigest(t *testing.T, path string) string {
	t.Helper()
	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if err := json.Unmarshal(payload, &document); err != nil {
		t.Fatal(err)
	}
	if corpus, ok := document["corpus"].(map[string]any); ok {
		if digest, ok := corpus["digest"].(string); ok && digest != "" {
			return digest
		}
	}
	if digest, ok := document["digest"].(string); ok && digest != "" {
		return digest
	}
	t.Fatalf("%s has no corpus digest", path)
	return ""
}

func qualificationRepoRoot(t *testing.T) string {
	t.Helper()
	root, err := filepath.Abs(filepath.Join("..", "..", "..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	return root
}
