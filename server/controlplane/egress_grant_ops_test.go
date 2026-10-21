package controlplane

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ailiheizi/cairn/client/command"
	"github.com/ailiheizi/cairn/server/internal/exact"
	"github.com/ailiheizi/cairn/server/internal/repository"
	"github.com/ailiheizi/cairn/server/internal/search"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
	"github.com/ailiheizi/cairn/server/testutil"
)

func controlPlaneOnlineProfile(t *testing.T) search.OnlineEmbeddingProfile {
	t.Helper()
	const endpoint = "https://api.example.invalid/v1/embeddings"
	profile := search.OnlineEmbeddingProfile{
		Schema:               search.OnlineEmbeddingProfileSchemaV2,
		ProfileID:            "operator-online-v1",
		Provider:             "operator",
		APIStyle:             search.OnlineEmbeddingAPIStyleOpenAI,
		Endpoint:             endpoint,
		ModelID:              "stub-embed-v1",
		ModelRevision:        "2026-09-18",
		Dimension:            4,
		InputType:            search.OnlineEmbeddingInputTypeDocument,
		Normalization:        search.OnlineEmbeddingNormalizationL2,
		Distance:             search.OnlineEmbeddingDistanceCosine,
		ElementType:          search.OnlineEmbeddingElementType,
		Pooling:              "provider-managed",
		Tokenizer:            "provider-managed",
		MaxBatchInputs:       8,
		TimeoutMS:            5000,
		RetentionDeclaration: "declared by operator",
		TrainingUse:          "none",
		Egress: search.OnlineEgressScope{
			DestinationHost:       "api.example.invalid",
			DisclosedDataClasses:  []string{search.EgressDataClassTextSegment, search.EgressDataClassTextQuery},
			AllowedSubjectClasses: search.EgressSubjectClasses(),
			Minimization: search.OnlineEgressMinimization{
				Statement: "only the model id, input text, and encoding format are transmitted",
				Fields:    []string{"model", "input", "encoding_format"},
			},
			Budgets:       search.EgressBudget{MaxRequests: 8, MaxBytes: 1 << 20, MaxSeconds: 120},
			Expiry:        time.Now().UTC().Add(24 * time.Hour).Format(time.RFC3339),
			RevocationRef: "env://RW_REVOKED_TEST",
			PolicyRefs: search.OnlineEgressPolicyRefs{
				Residency: "operator-declared", Logging: "operator-declared", Retention: "operator-declared",
				TrainingUse: "operator-declared", OutputUse: "operator-declared",
			},
			AuditRequired: true,
		},
	}
	if err := profile.Validate(); err != nil {
		t.Fatalf("control plane test profile must be valid: %v", err)
	}
	return profile
}

func writeControlPlaneProfileDocument(t *testing.T, dir string, profile search.OnlineEmbeddingProfile) string {
	t.Helper()
	payload, err := json.Marshal(profile)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "profile.json")
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func newOnlineProviderDispatcher(t *testing.T, modelsRoot string) (*Dispatcher, *sqlite.Store) {
	t.Helper()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	dispatcher := NewDispatcher(store, "catalog.sqlite", "/tmp/cairn.sock",
		WithOnlineProviderInstaller(modelsRoot, func(ctx context.Context, root, sourcePath, declaredDigest string) (OnlineProviderInstallReceipt, error) {
			receipt, err := search.InstallOnlineEmbeddingProfile(ctx, root, sourcePath, declaredDigest)
			if err != nil {
				return OnlineProviderInstallReceipt{}, err
			}
			return OnlineProviderInstallReceipt{
				Profile: receipt.Profile, Destination: receipt.Destination,
				Changed: receipt.Changed, AlreadyInstalled: receipt.AlreadyInstalled,
			}, nil
		}))
	return dispatcher, store
}

type listOnlyDescribeProvider struct{ profile search.OnlineDescribeProfile }

func (p listOnlyDescribeProvider) Describe(context.Context, search.DescribeRequest) (search.DescribeResult, error) {
	return search.DescribeResult{}, nil
}
func (p listOnlyDescribeProvider) CheckDescribeReadiness(context.Context) error { return nil }
func (p listOnlyDescribeProvider) Profile() search.OnlineDescribeProfile        { return p.profile }

func TestSemanticProviderInstallAndListThroughTheDispatcher(t *testing.T) {
	modelsRoot := filepath.Join(t.TempDir(), "models")
	dispatcher, _ := newOnlineProviderDispatcher(t, modelsRoot)
	profile := controlPlaneOnlineProfile(t)
	source := writeControlPlaneProfileDocument(t, t.TempDir(), profile)

	// Input is strict: a URL, a relative path, or a missing digest is refused
	// before any callback runs.
	for _, input := range []string{
		`{"path":"https://example.invalid/profile.json","profile_digest":"sha256:x"}`,
		`{"path":"profile.json","profile_digest":"sha256:x"}`,
		`{"path":"/tmp/profile.json"}`,
		`{"path":"/tmp/profile.json","profile_digest":"sha256:x","extra":true}`,
		`[]`, `null`,
	} {
		result := dispatcher.Handle(context.Background(), command.Envelope{
			Operation: command.OpSemanticProviderInstall, Input: []byte(input),
		})
		if result.Status != command.StatusFailed || !hasReasonCode(result, ReasonCodeInvalidInput) {
			t.Fatalf("input %s = %s, reasons=%+v; want invalid input", input, result.Status, result.Reasons)
		}
	}

	// A mismatched declared digest is refused by the real installer.
	result := dispatcher.Handle(context.Background(), command.Envelope{
		Operation: command.OpSemanticProviderInstall,
		Input:     mustEncodeJSON(t, command.SemanticProviderInstallInput{Path: source, ProfileDigest: "sha256:" + strings.Repeat("0", 64)}),
	})
	if result.Status != command.StatusFailed || !hasReasonCode(result, ReasonCodeUnavailable) {
		t.Fatalf("digest mismatch = %s, reasons=%+v", result.Status, result.Reasons)
	}

	// The admitted install publishes the profile and reports its immutable
	// facts plus restart-required.
	result = dispatcher.Handle(context.Background(), command.Envelope{
		Operation: command.OpSemanticProviderInstall,
		Input:     mustEncodeJSON(t, command.SemanticProviderInstallInput{Path: source, ProfileDigest: profile.ProviderProfileDigest()}),
	})
	if result.Status != command.StatusSucceeded {
		t.Fatalf("install = %s, reasons=%+v", result.Status, result.Reasons)
	}
	var installed command.SemanticProviderInstallData
	if err := json.Unmarshal(result.Data, &installed); err != nil {
		t.Fatal(err)
	}
	if installed.ProfileID != profile.ProfileID || installed.ProfileDigest != profile.ProviderProfileDigest() ||
		installed.EndpointHost != "api.example.invalid" || !installed.Changed || !installed.RestartRequired ||
		installed.SpaceDigest == "" || installed.ModelID != profile.ModelID {
		t.Fatalf("install data = %+v", installed)
	}
	if installed.AlreadyInstalled {
		t.Fatal("the first install must not report already-installed")
	}

	// Reinstalling the identical document is an explicit no-op.
	result = dispatcher.Handle(context.Background(), command.Envelope{
		Operation: command.OpSemanticProviderInstall,
		Input:     mustEncodeJSON(t, command.SemanticProviderInstallInput{Path: source, ProfileDigest: profile.ProviderProfileDigest()}),
	})
	if result.Status != command.StatusSucceeded {
		t.Fatalf("reinstall = %s, reasons=%+v", result.Status, result.Reasons)
	}
	var reinstalled command.SemanticProviderInstallData
	if err := json.Unmarshal(result.Data, &reinstalled); err != nil {
		t.Fatal(err)
	}
	if reinstalled.Changed || !reinstalled.AlreadyInstalled {
		t.Fatalf("reinstall data = %+v, want an unchanged already-installed result", reinstalled)
	}

	// The list operation reports what the daemon reads from its own root.
	result = dispatcher.Handle(context.Background(), command.Envelope{
		Operation: command.OpSemanticProviderList, Input: []byte(`{}`),
	})
	if result.Status != command.StatusSucceeded {
		t.Fatalf("list = %s, reasons=%+v", result.Status, result.Reasons)
	}
	var listed command.SemanticProviderListData
	if err := json.Unmarshal(result.Data, &listed); err != nil {
		t.Fatal(err)
	}
	if listed.ModelsRoot != modelsRoot || len(listed.Profiles) != 1 {
		t.Fatalf("list data = %+v", listed)
	}
	if listed.Profiles[0].ProfileDigest != profile.ProviderProfileDigest() || listed.Profiles[0].Expired {
		t.Fatalf("listed profile = %+v", listed.Profiles[0])
	}
}

func TestSemanticProviderListOptInProjectsDescribeProfilesWithoutChangingLegacyShape(t *testing.T) {
	modelsRoot := filepath.Join(t.TempDir(), "models")
	dispatcher, _ := newOnlineProviderDispatcher(t, modelsRoot)
	embedding := controlPlaneOnlineProfile(t)
	embeddingSource := writeControlPlaneProfileDocument(t, t.TempDir(), embedding)
	installed := dispatcher.Handle(context.Background(), command.Envelope{
		Operation: command.OpSemanticProviderInstall,
		Input:     mustEncodeJSON(t, command.SemanticProviderInstallInput{Path: embeddingSource, ProfileDigest: embedding.ProviderProfileDigest()}),
	})
	if installed.Status != command.StatusSucceeded {
		t.Fatalf("install embedding profile = %s, reasons=%+v", installed.Status, installed.Reasons)
	}
	describe := installDescribeProfile(t, modelsRoot, "http://127.0.0.1:43127")
	dispatcher.describeModelsRoot = modelsRoot
	dispatcher.describeProvider = listOnlyDescribeProvider{profile: describe}

	legacy := dispatcher.Handle(context.Background(), command.Envelope{
		Operation: command.OpSemanticProviderList, Input: []byte(`{}`),
	})
	if legacy.Status != command.StatusSucceeded {
		t.Fatalf("legacy list = %s, reasons=%+v", legacy.Status, legacy.Reasons)
	}
	var legacyJSON map[string]json.RawMessage
	if err := json.Unmarshal(legacy.Data, &legacyJSON); err != nil {
		t.Fatal(err)
	}
	var legacyData command.SemanticProviderListData
	if err := json.Unmarshal(legacy.Data, &legacyData); err != nil {
		t.Fatal(err)
	}
	if _, present := legacyJSON["describe"]; present || len(legacyData.Profiles) != 1 || legacyData.Profiles[0].ProfileID != embedding.ProfileID {
		t.Fatalf("legacy list changed: raw=%s data=%+v", legacy.Data, legacyData)
	}

	listed := dispatcher.Handle(context.Background(), command.Envelope{
		Operation: command.OpSemanticProviderList,
		Input:     []byte(`{"include_describe":true}`),
	})
	if listed.Status != command.StatusSucceeded {
		t.Fatalf("opt-in list = %s, reasons=%+v", listed.Status, listed.Reasons)
	}
	var data command.SemanticProviderListData
	if err := json.Unmarshal(listed.Data, &data); err != nil {
		t.Fatal(err)
	}
	if len(data.Profiles) != 1 || data.Profiles[0].ProfileID != embedding.ProfileID || data.Describe == nil ||
		data.Describe.State != "AVAILABLE" || data.Describe.Reason != "" || len(data.Describe.Profiles) != 1 {
		t.Fatalf("opt-in list = %+v describe=%+v raw=%s", data, data.Describe, listed.Data)
	}
	row := data.Describe.Profiles[0]
	if row.ProfileID != describe.ProfileID || row.ProfileDigest != describe.ProviderProfileDigest() ||
		row.Provider != describe.Provider || row.APIStyle != describe.APIStyle || row.EndpointHost != "127.0.0.1:43127" ||
		row.ModelID != describe.ModelID || row.ModelRevision != describe.ModelRevision ||
		row.OutputSchema != search.OnlineDescribeOutputSchema || row.Destination != filepath.Join(modelsRoot, search.OnlineDescribeProfileDirName, describe.ProfileID, search.OnlineDescribeProfileFileName) ||
		row.Expiry != describe.Egress.Expiry || row.MaxRequests != describe.Egress.Budgets.MaxRequests ||
		row.MaxBytes != describe.Egress.Budgets.MaxBytes || row.MaxSeconds != describe.Egress.Budgets.MaxSeconds ||
		!row.AuditRequired || row.Expired {
		t.Fatalf("describe profile projection = %+v", row)
	}
	var listedJSON map[string]any
	if err := json.Unmarshal(listed.Data, &listedJSON); err != nil {
		t.Fatal(err)
	}
	describeJSON := listedJSON["describe"].(map[string]any)
	profileJSON := describeJSON["profiles"].([]any)[0].(map[string]any)
	for _, secretOrPrivateField := range []string{"credential_ref", "system_instruction", "max_output_tokens", "max_output_bytes"} {
		if _, present := profileJSON[secretOrPrivateField]; present {
			t.Fatalf("describe profile projection leaked %q: %s", secretOrPrivateField, listed.Data)
		}
	}
	for _, rawInput := range []string{`{"include_describe":"true"}`, `{"include_describe":null}`, `{"include_describe":true,"extra":1}`} {
		invalid := dispatcher.Handle(context.Background(), command.Envelope{Operation: command.OpSemanticProviderList, Input: []byte(rawInput)})
		if invalid.Status != command.StatusFailed || !hasReasonCode(invalid, ReasonCodeInvalidInput) {
			t.Fatalf("input %s = %s reasons=%+v; want strict invalid-input rejection", rawInput, invalid.Status, invalid.Reasons)
		}
	}

	// A malformed describe profile makes only the opted-in describe projection
	// unavailable; the established embedding profile response remains usable.
	malformedDir := filepath.Join(modelsRoot, search.OnlineDescribeProfileDirName, "broken-describe")
	if err := os.MkdirAll(malformedDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(malformedDir, search.OnlineDescribeProfileFileName), []byte(`{"schema":"unknown"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	withMalformed := dispatcher.Handle(context.Background(), command.Envelope{
		Operation: command.OpSemanticProviderList, Input: []byte(`{"include_describe":true}`),
	})
	if withMalformed.Status != command.StatusSucceeded {
		t.Fatalf("malformed describe listing = %s, reasons=%+v", withMalformed.Status, withMalformed.Reasons)
	}
	var unavailable command.SemanticProviderListData
	if err := json.Unmarshal(withMalformed.Data, &unavailable); err != nil {
		t.Fatal(err)
	}
	if len(unavailable.Profiles) != 1 || unavailable.Describe == nil || unavailable.Describe.State != "UNAVAILABLE" ||
		strings.TrimSpace(unavailable.Describe.Reason) == "" || len(unavailable.Describe.Profiles) != 0 {
		t.Fatalf("malformed describe result = %+v", unavailable)
	}
}

func TestSemanticProviderOperationsAreUnavailableWithoutWiring(t *testing.T) {
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	dispatcher := NewDispatcher(store, "catalog.sqlite", "/tmp/cairn.sock")
	for _, operation := range []string{command.OpSemanticProviderInstall, command.OpSemanticProviderList} {
		result := dispatcher.Handle(context.Background(), command.Envelope{Operation: operation, Input: []byte(`{}`)})
		if result.Status != command.StatusFailed || !hasReasonCode(result, ReasonCodeUnimplemented) {
			t.Fatalf("%s without wiring = %s, reasons=%+v; want unimplemented", operation, result.Status, result.Reasons)
		}
	}
}

func TestEgressGrantLifecycleThroughTheDispatcher(t *testing.T) {
	modelsRoot := filepath.Join(t.TempDir(), "models")
	dispatcher, store := newOnlineProviderDispatcher(t, modelsRoot)
	profile := controlPlaneOnlineProfile(t)
	source := writeControlPlaneProfileDocument(t, t.TempDir(), profile)
	install := dispatcher.Handle(context.Background(), command.Envelope{
		Operation: command.OpSemanticProviderInstall,
		Input:     mustEncodeJSON(t, command.SemanticProviderInstallInput{Path: source, ProfileDigest: profile.ProviderProfileDigest()}),
	})
	if install.Status != command.StatusSucceeded {
		t.Fatalf("precondition install = %s, reasons=%+v", install.Status, install.Reasons)
	}
	ctx := context.Background()
	workspaceID := mustDefaultWorkspace(t, store)

	baseInput := command.EgressGrantCreateInput{
		WorkspaceID: workspaceID, ProfileID: profile.ProfileID, ProfileDigest: profile.ProviderProfileDigest(),
		EndpointHost: profile.EndpointHost(), ModelID: profile.ModelID, Purpose: search.EgressPurposeDocument,
		DataClasses:    []string{search.EgressDataClassTextSegment},
		SubjectClasses: []string{search.EgressSubjectClassExactProtected},
		MaxRequests:    4, MaxBytes: 4096, MaxSeconds: 60,
		ExpiresAt: time.Now().UTC().Add(time.Hour).Format(time.RFC3339),
	}

	// Refusals: past expiry, unknown profile, mismatched endpoint, class
	// outside the installed profile's declaration, budgets beyond the profile.
	for _, test := range []struct {
		name   string
		mutate func(*command.EgressGrantCreateInput)
		want   string
	}{
		{"past expiry", func(in *command.EgressGrantCreateInput) {
			in.ExpiresAt = time.Now().UTC().Add(-time.Hour).Format(time.RFC3339)
		}, ReasonCodeInvalidInput},
		{"unknown profile", func(in *command.EgressGrantCreateInput) { in.ProfileID = "not-installed" }, ReasonCodeNotFound},
		{"mismatched endpoint", func(in *command.EgressGrantCreateInput) { in.EndpointHost = "elsewhere.invalid" }, ReasonCodeInvalidInput},
		{"mismatched model", func(in *command.EgressGrantCreateInput) { in.ModelID = "other-model" }, ReasonCodeInvalidInput},
		{"mismatched digest", func(in *command.EgressGrantCreateInput) { in.ProfileDigest = "sha256:" + strings.Repeat("9", 64) }, ReasonCodeInvalidInput},
		{"class outside the profile", func(in *command.EgressGrantCreateInput) {
			in.SubjectClasses = []string{"EXACT_MAYBE"}
		}, ReasonCodeInvalidInput},
		{"budget beyond the profile", func(in *command.EgressGrantCreateInput) { in.MaxRequests = 999 }, ReasonCodeInvalidInput},
		{"missing classes", func(in *command.EgressGrantCreateInput) { in.DataClasses = nil }, ReasonCodeInvalidInput},
	} {
		t.Run(test.name, func(t *testing.T) {
			input := baseInput
			test.mutate(&input)
			result := dispatcher.Handle(ctx, command.Envelope{
				Operation: command.OpEgressGrantCreate, Input: mustEncodeJSON(t, input),
			})
			if result.Status != command.StatusFailed || !hasReasonCode(result, test.want) {
				t.Fatalf("result = %s, reasons=%+v; want %s", result.Status, result.Reasons, test.want)
			}
		})
	}

	// The admitted grant is durable, listed as live, and audited.
	result := dispatcher.Handle(ctx, command.Envelope{Operation: command.OpEgressGrantCreate, Input: mustEncodeJSON(t, baseInput)})
	if result.Status != command.StatusSucceeded {
		t.Fatalf("create = %s, reasons=%+v", result.Status, result.Reasons)
	}
	var created command.EgressGrantData
	if err := json.Unmarshal(result.Data, &created); err != nil {
		t.Fatal(err)
	}
	if created.GrantID == "" || !created.Live || created.Revoked {
		t.Fatalf("created grant = %+v", created)
	}
	result = dispatcher.Handle(ctx, command.Envelope{Operation: command.OpEgressGrantList, Input: mustEncodeJSON(t, command.EgressGrantListInput{WorkspaceID: workspaceID})})
	if result.Status != command.StatusSucceeded {
		t.Fatalf("list = %s, reasons=%+v", result.Status, result.Reasons)
	}
	var listed command.EgressGrantListData
	if err := json.Unmarshal(result.Data, &listed); err != nil {
		t.Fatal(err)
	}
	if len(listed.Grants) != 1 || !listed.Grants[0].Live || listed.Grants[0].GrantID != created.GrantID {
		t.Fatalf("listed grants = %+v", listed.Grants)
	}
	events, err := store.ListAuditEvents(ctx, workspaceID, 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].Action != AuditActionEgressGrantCreated || events[0].TargetType != AuditTargetEgressGrant {
		t.Fatalf("create audit events = %+v", events)
	}

	// Revocation appends; the grant itself is never edited or deleted.
	result = dispatcher.Handle(ctx, command.Envelope{
		Operation: command.OpEgressGrantRevoke,
		Input:     mustEncodeJSON(t, command.EgressGrantRevokeInput{WorkspaceID: workspaceID, GrantID: created.GrantID, Reason: "operator rotation"}),
	})
	if result.Status != command.StatusSucceeded {
		t.Fatalf("revoke = %s, reasons=%+v", result.Status, result.Reasons)
	}
	var revoked command.EgressGrantRevokeData
	if err := json.Unmarshal(result.Data, &revoked); err != nil {
		t.Fatal(err)
	}
	if revoked.Live || revoked.RevocationID == "" || revoked.Reason != "operator rotation" {
		t.Fatalf("revoke data = %+v", revoked)
	}
	result = dispatcher.Handle(ctx, command.Envelope{
		Operation: command.OpEgressGrantRevoke,
		Input:     mustEncodeJSON(t, command.EgressGrantRevokeInput{WorkspaceID: workspaceID, GrantID: created.GrantID, Reason: "again"}),
	})
	if result.Status != command.StatusFailed || !hasReasonCode(result, ReasonCodeConflict) {
		t.Fatalf("double revoke = %s, reasons=%+v; want conflict", result.Status, result.Reasons)
	}
	result = dispatcher.Handle(ctx, command.Envelope{Operation: command.OpEgressGrantList, Input: mustEncodeJSON(t, command.EgressGrantListInput{WorkspaceID: workspaceID})})
	if err := json.Unmarshal(result.Data, &listed); err != nil {
		t.Fatal(err)
	}
	if len(listed.Grants) != 1 || listed.Grants[0].Live || !listed.Grants[0].Revoked || listed.Grants[0].RevokedReason != "operator rotation" {
		t.Fatalf("listed revoked grant = %+v", listed.Grants)
	}
	events, err = store.ListAuditEvents(ctx, workspaceID, 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 || events[1].Action != AuditActionEgressGrantRevoked {
		t.Fatalf("revoke audit events = %+v", events)
	}
}

// TestSemanticEgressGrantLookupProjectsGrantStates proves the catalog adapter
// hands the gate every matching grant with its revocation evidence.
func TestSemanticEgressGrantLookupProjectsGrantStates(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	workspaceID := mustDefaultWorkspace(t, store)
	profile := controlPlaneOnlineProfile(t)
	grant := sqlite.EgressGrant{
		ID: mustStableID(t, sqlite.IDPrefixEgressGrant), WorkspaceID: workspaceID,
		ProfileID: profile.ProfileID, ProfileDigest: profile.ProviderProfileDigest(),
		EndpointHost: profile.EndpointHost(), ModelID: profile.ModelID, Purpose: search.EgressPurposeDocument,
		DataClasses: []string{search.EgressDataClassTextSegment}, SubjectClasses: []string{search.EgressSubjectClassExactProtected},
		MaxRequests: 2, MaxBytes: 1024, MaxSeconds: 30,
		ExpiresAt: time.Now().UTC().Add(time.Hour), GrantedBy: "operator",
	}
	if err := store.Update(ctx, func(tx *sqlite.Tx) error { return tx.InsertEgressGrant(ctx, &grant) }); err != nil {
		t.Fatal(err)
	}
	lookup := NewSemanticEgressGrantLookup(store)
	grants, err := lookup.EgressGrants(ctx, search.EgressGrantQuery{
		ProfileID: grant.ProfileID, ProfileDigest: grant.ProfileDigest,
		EndpointHost: grant.EndpointHost, ModelID: grant.ModelID, Purpose: grant.Purpose,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(grants) != 1 || grants[0].ID != grant.ID || grants[0].Revoked {
		t.Fatalf("grants = %+v", grants)
	}
	for _, class := range []string{search.EgressDataClassTextSegment} {
		if !grants[0].CoversDataClass(class) {
			t.Fatalf("grant must cover %s", class)
		}
	}
	if grants[0].CoversDataClass(search.EgressDataClassTextQuery) {
		t.Fatal("grant must not cover an undeclared data class")
	}
	revocation := sqlite.EgressGrantRevocation{
		ID: mustStableID(t, sqlite.IDPrefixEgressRevocation), WorkspaceID: workspaceID, GrantID: grant.ID,
		Reason: "rotation", RevokedBy: "operator",
	}
	if err := store.Update(ctx, func(tx *sqlite.Tx) error { return tx.InsertEgressGrantRevocation(ctx, &revocation) }); err != nil {
		t.Fatal(err)
	}
	grants, err = lookup.EgressGrants(ctx, search.EgressGrantQuery{
		ProfileID: grant.ProfileID, ProfileDigest: grant.ProfileDigest,
		EndpointHost: grant.EndpointHost, ModelID: grant.ModelID, Purpose: grant.Purpose,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(grants) != 1 || !grants[0].Revoked || grants[0].RevokedReason != "rotation" {
		t.Fatalf("revoked grants = %+v", grants)
	}
	if grants[0].Live(time.Now().UTC()) {
		t.Fatal("a revoked grant must never be live")
	}
	// A non-matching query returns nothing.
	grants, err = lookup.EgressGrants(ctx, search.EgressGrantQuery{
		ProfileID: grant.ProfileID, ProfileDigest: grant.ProfileDigest,
		EndpointHost: "elsewhere.invalid", ModelID: grant.ModelID, Purpose: grant.Purpose,
	})
	if err != nil || len(grants) != 0 {
		t.Fatalf("non-matching grants = %+v (%v)", grants, err)
	}
}

func mustEncodeJSON(t *testing.T, value any) []byte {
	t.Helper()
	payload, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return payload
}

// TestEgressConfirmationTypedInputProvesParsingAndStrictness covers the typed
// per-request confirmation object accepted by search.query and search.rebuild.
func TestEgressConfirmationTypedInputProvesParsingAndStrictness(t *testing.T) {
	valid := `{"profile_digest":"sha256:` + strings.Repeat("a", 64) + `","endpoint_host":"api.example.invalid","model":"stub-embed-v1","purpose":"QUERY","grant_id":"egt_0123456789abcdef0123456789abcdef"}`
	confirmation, err := semanticEgressConfirmationFromInput([]byte(valid))
	if err != nil {
		t.Fatalf("valid confirmation refused: %v", err)
	}
	if confirmation.ProfileDigest == "" || confirmation.EndpointHost != "api.example.invalid" ||
		confirmation.ModelID != "stub-embed-v1" || confirmation.Purpose != search.SemanticEmbeddingQuery ||
		confirmation.GrantID == "" {
		t.Fatalf("confirmation = %+v", confirmation)
	}
	if empty, err := semanticEgressConfirmationFromInput(nil); err != nil || empty != nil {
		t.Fatalf("an absent confirmation must be nil/nil, got %+v (%v)", empty, err)
	}
	invalid := []struct {
		name string
		raw  string
		want string
	}{
		{"missing grant", `{"profile_digest":"sha256:a","endpoint_host":"api.example.invalid","model":"m","purpose":"QUERY"}`, "grant_id is required"},
		{"missing identity", `{"endpoint_host":"api.example.invalid","model":"m","purpose":"QUERY","grant_id":"egt_x"}`, "profile_id or profile_digest"},
		{"missing endpoint", `{"profile_digest":"sha256:a","model":"m","purpose":"QUERY","grant_id":"egt_x"}`, "endpoint or endpoint_host"},
		{"missing model", `{"profile_digest":"sha256:a","endpoint_host":"api.example.invalid","purpose":"QUERY","grant_id":"egt_x"}`, "model is required"},
		{"unknown purpose", `{"profile_digest":"sha256:a","endpoint_host":"api.example.invalid","model":"m","purpose":"TRAINING","grant_id":"egt_x"}`, "DOCUMENT or QUERY"},
		{"unknown field", `{"profile_digest":"sha256:a","endpoint_host":"api.example.invalid","model":"m","purpose":"QUERY","grant_id":"egt_x","extra":1}`, "unknown field"},
	}
	for _, test := range invalid {
		t.Run(test.name, func(t *testing.T) {
			if _, err := semanticEgressConfirmationFromInput([]byte(test.raw)); err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("error = %v, want substring %q", err, test.want)
			}
		})
	}
}

// TestSearchQueryRejectsMalformedEgressConfirmation proves the confirmation is
// validated before any search work happens.
func TestSearchQueryRejectsMalformedEgressConfirmation(t *testing.T) {
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	repo, err := repository.OpenDir(filepath.Join(t.TempDir(), "repository"))
	if err != nil {
		t.Fatal(err)
	}
	dispatcher := NewDispatcher(store, "catalog.sqlite", "/tmp/cairn.sock",
		WithExact(&exact.Service{Store: store, Repo: repo}))
	result := dispatcher.Handle(context.Background(), command.Envelope{
		Operation: command.OpSearchQuery,
		Input:     []byte(`{"query":"text","egress_confirmation":{"grant_id":"egt_x"}}`),
	})
	if result.Status != command.StatusFailed || !hasReasonCode(result, ReasonCodeInvalidInput) {
		t.Fatalf("malformed confirmation = %s, reasons=%+v; want invalid input", result.Status, result.Reasons)
	}
	if !strings.Contains(result.Reasons[0].Message, "egress_confirmation") {
		t.Fatalf("refusal must name the confirmation: %+v", result.Reasons)
	}
}

// TestFusedDegradedMessageNamesEgressReasons proves a remote-provider refusal
// is reported with its stable reason instead of generic unavailability.
func TestFusedDegradedMessageNamesEgressReasons(t *testing.T) {
	components := []search.Component{
		{Dimension: search.DimensionLexical, Status: string(command.StatusSucceeded)},
		{Dimension: search.DimensionSemantic, Status: "DEGRADED", Reason: string(search.EgressReasonConfirmationRequired)},
	}
	message := fusedDegradedMessage(components, "fallback text")
	if !strings.Contains(message, string(search.EgressReasonConfirmationRequired)) || !strings.Contains(message, "fallback text") {
		t.Fatalf("message = %q", message)
	}
	plain := fusedDegradedMessage([]search.Component{
		{Dimension: search.DimensionSemantic, Status: "DEGRADED", Reason: "OTHER_REASON"},
	}, "fallback text")
	if plain != "fallback text" {
		t.Fatalf("unrelated component reason changed the message: %q", plain)
	}
}

func TestFusedDegradedMessageExplainsLongSemanticQuery(t *testing.T) {
	message := "This query is too long for semantic search. Shorten it to use semantic search; available keyword and filter results are still shown."
	degraded := fusedDegradedMessage([]search.Component{
		{Dimension: search.DimensionSemantic, Status: "DEGRADED", Reason: search.SemanticQueryInputTruncatedReason},
	}, "fallback text")
	if degraded != message {
		t.Fatalf("long semantic query message = %q, want %q", degraded, message)
	}
	// An egress restriction keeps precedence even if another failed lane has
	// the query-specific truncation reason.
	withEgress := fusedDegradedMessage([]search.Component{
		{Dimension: search.DimensionSemantic, Status: "DEGRADED", Reason: search.SemanticQueryInputTruncatedReason},
		{Dimension: search.DimensionSemantic, Status: "DEGRADED", Reason: string(search.EgressReasonConfirmationRequired)},
	}, "fallback text")
	if !strings.Contains(withEgress, string(search.EgressReasonConfirmationRequired)) {
		t.Fatalf("egress restriction lost priority: %q", withEgress)
	}
	if plain := fusedDegradedMessage([]search.Component{{Dimension: search.DimensionLexical, Status: "DEGRADED", Reason: "OTHER_REASON"}}, "fallback text"); plain != "fallback text" {
		t.Fatalf("unrelated degraded reason = %q, want fallback", plain)
	}
}

// TestEgressGrantOperationsAreImplementedForAnOpenCatalog keeps the operation
// surface honest: grant operations are durable catalog facts, not provider
// capabilities.
func TestEgressGrantOperationsAreImplementedForAnOpenCatalog(t *testing.T) {
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	dispatcher := NewDispatcher(store, "catalog.sqlite", "/tmp/cairn.sock")
	for _, operation := range []string{command.OpEgressGrantCreate, command.OpEgressGrantList, command.OpEgressGrantRevoke} {
		result := dispatcher.Handle(context.Background(), command.Envelope{Operation: operation, Input: []byte(`{}`)})
		if hasReasonCode(result, ReasonCodeUnimplemented) || hasReasonCode(result, ReasonCodeUnknownOperation) {
			t.Fatalf("%s = %s, reasons=%+v; want an implemented operation", operation, result.Status, result.Reasons)
		}
	}
}
