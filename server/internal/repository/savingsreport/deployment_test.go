//go:build savingsreport

package main

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/ailiheizi/restoreweave/server/internal/repository"
)

func TestMeasureDeploymentOverheadScansFilesAndDirectories(t *testing.T) {
	root := t.TempDir()
	catalog := filepath.Join(root, "catalog.db")
	index := filepath.Join(root, "index")
	model := filepath.Join(root, "model.onnx")
	if err := os.WriteFile(catalog, []byte("catalog"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(index, "nested"), 0o700); err != nil {
		t.Fatal(err)
	}
	for path, body := range map[string]string{
		filepath.Join(index, "one"):           "1234",
		filepath.Join(index, "nested", "two"): "567890",
	} {
		if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(model, []byte("model-bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	overhead, err := MeasureDeploymentOverhead(catalog, index, model, 77)
	if err != nil {
		t.Fatal(err)
	}
	assertMeasuredBytes(t, "catalog", overhead.Catalog, int64(len("catalog")))
	assertMeasuredBytes(t, "index", overhead.Index, int64(len("1234")+len("567890")))
	assertMeasuredBytes(t, "model", overhead.Model, int64(len("model-bytes")))
	if overhead.Temporary.Status != repository.SavingsCategoryUnmeasured {
		t.Fatalf("caller-reported temporary peak status = %q, want UNMEASURED", overhead.Temporary.Status)
	}
	if overhead.ReportedTemporaryPeakBytes == nil || *overhead.ReportedTemporaryPeakBytes != 77 {
		t.Fatalf("reported temporary peak = %v, want preserved caller claim 77", overhead.ReportedTemporaryPeakBytes)
	}
}

func TestMeasureDeploymentOverheadLeavesOmittedCategoriesUnmeasured(t *testing.T) {
	overhead, err := MeasureDeploymentOverhead("", "", "", -1)
	if err != nil {
		t.Fatal(err)
	}
	for name, category := range map[string]repository.SavingsOverheadCategory{
		"catalog":   overhead.Catalog,
		"index":     overhead.Index,
		"model":     overhead.Model,
		"temporary": overhead.Temporary,
	} {
		if category.Status != repository.SavingsCategoryUnmeasured {
			t.Errorf("%s status = %q, want UNMEASURED", name, category.Status)
		}
	}
}

func TestMeasureDeploymentOverheadRejectsSymlinksAndSpecialValues(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink setup requires platform support")
	}
	root := t.TempDir()
	target := filepath.Join(root, "target")
	if err := os.WriteFile(target, []byte("target"), 0o600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "link")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	if _, err := measureReadOnlyPath(link); err == nil {
		t.Fatal("symlink root was accepted")
	}
	directory := filepath.Join(root, "directory")
	if err := os.Mkdir(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(directory, "member")); err != nil {
		t.Fatal(err)
	}
	if _, err := measureReadOnlyPath(directory); err == nil {
		t.Fatal("symlink member was accepted")
	}
	if _, err := MeasureDeploymentOverhead(target, "", "", -2); err == nil {
		t.Fatal("negative temporary peak was accepted")
	}
}

func TestValidateDeploymentPathsRejectsOverlap(t *testing.T) {
	root := t.TempDir()
	corpus := filepath.Join(root, "corpus")
	repositoryPath := filepath.Join(root, "repository")
	if err := os.MkdirAll(corpus, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "catalog"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := validateDeploymentPaths(corpus, filepath.Join(root, "catalog"), filepath.Join(root, "catalog", "db"), "", ""); err == nil {
		t.Fatal("nested catalog path was accepted")
	}
	if err := validateDeploymentPaths(corpus, repositoryPath, filepath.Join(root, "catalog"), filepath.Join(root, "catalog"), ""); err == nil {
		t.Fatal("duplicate category path was accepted")
	}
	if err := validateDeploymentPaths(corpus, repositoryPath, filepath.Join(root, "catalog"), filepath.Join(root, "index"), ""); err != nil {
		t.Fatalf("disjoint paths rejected: %v", err)
	}
}

func TestDeploymentSavingsRequiresEveryCategory(t *testing.T) {
	report := repository.SavingsReport{
		LogicalBytes:            1000,
		RepositoryGrowthBytes:   300,
		NetPhysicalSavingsBytes: 700,
	}
	partial := DeploymentOverhead{Catalog: measuredCategory(10), Index: measuredCategory(20), Model: unmeasuredCategory(), Temporary: measuredCategory(40)}
	if got := deploymentSavings(report, partial).Net.Status; got != repository.SavingsCategoryUnmeasured {
		t.Fatalf("partial deployment net status = %q, want UNMEASURED", got)
	}
	full := DeploymentOverhead{Catalog: measuredCategory(10), Index: measuredCategory(20), Model: measuredCategory(30), Temporary: measuredCategory(40)}
	result := deploymentSavings(report, full)
	if result.Net.Status != repository.SavingsCategoryUnmeasured || result.NetReason == "" {
		t.Fatalf("full but unbound deployment net = %+v (reason %q), want reasoned UNMEASURED", result.Net, result.NetReason)
	}
}

func TestDeploymentSavingsRejectsOverflowAndNegativeInputs(t *testing.T) {
	report := repository.SavingsReport{LogicalBytes: 100, RepositoryGrowthBytes: 10}
	allMeasured := DeploymentOverhead{Catalog: measuredCategory(int64(^uint64(0) >> 1)), Index: measuredCategory(1), Model: measuredCategory(0), Temporary: measuredCategory(0)}
	result := deploymentSavings(report, allMeasured)
	if result.Net.Status != repository.SavingsCategoryUnmeasured || result.NetReason == "" {
		t.Fatalf("overflow result = %+v, want reasoned UNMEASURED net", result)
	}
	negative := DeploymentOverhead{Catalog: measuredCategory(-1), Index: measuredCategory(0), Model: measuredCategory(0), Temporary: measuredCategory(0)}
	result = deploymentSavings(report, negative)
	if result.Net.Status != repository.SavingsCategoryUnmeasured || result.NetReason == "" {
		t.Fatalf("negative category result = %+v, want reasoned UNMEASURED net", result)
	}
	zeroOverhead := DeploymentOverhead{Catalog: measuredCategory(0), Index: measuredCategory(0), Model: measuredCategory(0), Temporary: measuredCategory(0)}
	result = deploymentSavings(repository.SavingsReport{LogicalBytes: -1, RepositoryGrowthBytes: 0}, zeroOverhead)
	if result.Net.Status != repository.SavingsCategoryUnmeasured || result.NetReason == "" {
		t.Fatalf("negative logical bytes result = %+v, want reasoned UNMEASURED net", result)
	}
	underflow := DeploymentOverhead{Catalog: measuredCategory(int64(^uint64(0) >> 1)), Index: measuredCategory(0), Model: measuredCategory(0), Temporary: measuredCategory(0)}
	result = deploymentSavings(repository.SavingsReport{LogicalBytes: 0, RepositoryGrowthBytes: 2}, underflow)
	if result.Net.Status != repository.SavingsCategoryUnmeasured || result.NetReason == "" {
		t.Fatalf("net underflow result = %+v, want reasoned UNMEASURED net", result)
	}
}

func TestCheckedDeploymentNet(t *testing.T) {
	if got, err := checkedDeploymentNet(1000, 300, 100); err != nil || got != 600 {
		t.Fatalf("checkedDeploymentNet = %d, %v; want 600, nil", got, err)
	}
	if _, err := checkedDeploymentNet(0, 2, int64(^uint64(0)>>1)); err == nil {
		t.Fatal("overflowing hypothetical deployment net was accepted")
	}
	if _, err := checkedDeploymentNet(-1, 0, 0); err == nil {
		t.Fatal("negative logical bytes were accepted")
	}
}

func TestCallerPeakClaimCannotMeasureDeploymentNet(t *testing.T) {
	overhead, err := MeasureDeploymentOverhead("", "", "", 123)
	if err != nil {
		t.Fatal(err)
	}
	result := deploymentSavings(repository.SavingsReport{LogicalBytes: 1000, RepositoryGrowthBytes: 100}, overhead)
	if overhead.Temporary.Status != repository.SavingsCategoryUnmeasured || result.Net.Status != repository.SavingsCategoryUnmeasured {
		t.Fatalf("caller claim produced measured result: overhead=%+v net=%+v", overhead, result.Net)
	}
	if result.Correlation != "UNBOUND" {
		t.Fatalf("correlation = %q, want UNBOUND", result.Correlation)
	}
}

func TestCandidateEvidencePreservesUnboundCorrelation(t *testing.T) {
	manifest := CorpusManifest{Schema: corpusManifestSchema, Digest: "corpus-digest"}
	repositoryManifest := CorpusManifest{Schema: corpusManifestSchema, Digest: "repository-digest"}
	deployment := DeploymentSavings{External: DeploymentOverhead{Catalog: unmeasuredCategory(), Index: unmeasuredCategory(), Model: unmeasuredCategory(), Temporary: unmeasuredCategory()}, Net: unmeasuredCategory(), RepositoryManifest: repositoryManifest, Correlation: "UNBOUND"}
	evidence := candidateEvidence(manifest, nil, repository.ProfileDescription{}, repository.SavingsReport{}, time.Now(), deployment)
	if evidence.Correlation != "UNBOUND" || evidence.Repository.Digest != repositoryManifest.Digest {
		t.Fatalf("correlation = %q repository = %+v", evidence.Correlation, evidence.Repository)
	}
}

func assertMeasuredBytes(t *testing.T, name string, category repository.SavingsOverheadCategory, want int64) {
	t.Helper()
	if category.Status != repository.SavingsCategoryMeasured || category.Bytes != want {
		t.Fatalf("%s = %+v, want measured %d", name, category, want)
	}
}
