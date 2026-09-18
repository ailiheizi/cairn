package search

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// profileDocument decodes the valid test profile into a mutable document so a
// test can remove or corrupt exactly one egress fact.
func profileDocument(t *testing.T, endpoint string) map[string]any {
	t.Helper()
	var document map[string]any
	if err := json.Unmarshal(validOnlineProfileJSON(t, endpoint), &document); err != nil {
		t.Fatal(err)
	}
	if _, ok := document["egress"].(map[string]any); !ok {
		t.Fatalf("test profile must carry an egress object: %+v", document["egress"])
	}
	return document
}

// TestOnlineProfileRequiresCompleteEgressScope proves a profile missing any
// required egress field is refused before it can describe a production space.
func TestOnlineProfileRequiresCompleteEgressScope(t *testing.T) {
	base := func(t *testing.T) map[string]any {
		return profileDocument(t, "https://api.example.invalid/v1/embeddings")
	}
	egressOf := func(document map[string]any) map[string]any {
		return document["egress"].(map[string]any)
	}
	mutations := []struct {
		name   string
		mutate func(document map[string]any)
		want   string
	}{
		{"egress object missing", func(d map[string]any) { delete(d, "egress") }, "destination_host"},
		{"destination host missing", func(d map[string]any) { delete(egressOf(d), "destination_host") }, "destination_host"},
		{"destination host disagrees with endpoint", func(d map[string]any) {
			egressOf(d)["destination_host"] = "elsewhere.invalid"
		}, "must equal the endpoint host"},
		{"data classes missing", func(d map[string]any) { delete(egressOf(d), "disclosed_data_classes") }, "disclosed_data_classes"},
		{"data class unknown", func(d map[string]any) {
			egressOf(d)["disclosed_data_classes"] = []any{"text.secret"}
		}, "closed vocabulary"},
		{"subject classes missing", func(d map[string]any) { delete(egressOf(d), "allowed_subject_classes") }, "allowed_subject_classes"},
		{"subject class unknown", func(d map[string]any) {
			egressOf(d)["allowed_subject_classes"] = []any{"EXACT_MAYBE"}
		}, "closed vocabulary"},
		{"minimization missing", func(d map[string]any) { delete(egressOf(d), "minimization") }, "minimization.statement"},
		{"minimization fields missing", func(d map[string]any) {
			egressOf(d)["minimization"] = map[string]any{"statement": "only inputs"}
		}, "minimization.fields"},
		{"minimization declares an undeclared field", func(d map[string]any) {
			egressOf(d)["minimization"] = map[string]any{
				"statement": "model, input, and a secret extra",
				"fields":    []any{"model", "input", "encoding_format", "user"},
			}
		}, "minimization.fields"},
		{"budgets missing", func(d map[string]any) { delete(egressOf(d), "budgets") }, "max_requests"},
		{"budget unbounded", func(d map[string]any) {
			egressOf(d)["budgets"] = map[string]any{"max_requests": 0, "max_bytes": 1024, "max_seconds": 60}
		}, "max_requests"},
		{"budget beyond bounds", func(d map[string]any) {
			egressOf(d)["budgets"] = map[string]any{"max_requests": 1, "max_bytes": 1, "max_seconds": int64(400 * 24 * 60 * 60)}
		}, "max_seconds"},
		{"expiry missing", func(d map[string]any) { delete(egressOf(d), "expiry") }, "expiry"},
		{"expiry past", func(d map[string]any) {
			egressOf(d)["expiry"] = time.Now().UTC().Add(-time.Hour).Format(time.RFC3339)
		}, "not in the future"},
		{"expiry not RFC3339", func(d map[string]any) { egressOf(d)["expiry"] = "tomorrow" }, "RFC3339"},
		{"revocation reference missing", func(d map[string]any) { delete(egressOf(d), "revocation_ref") }, "revocation_ref"},
		{"revocation reference unqualified", func(d map[string]any) { egressOf(d)["revocation_ref"] = "RW_REVOKED" }, "scheme-qualified"},
		{"policy reference missing", func(d map[string]any) {
			policies := egressOf(d)["policy_refs"].(map[string]any)
			delete(policies, "retention")
		}, "policy_refs.retention"},
	}
	for _, test := range mutations {
		t.Run(test.name, func(t *testing.T) {
			document := base(t)
			test.mutate(document)
			payload, err := json.Marshal(document)
			if err != nil {
				t.Fatal(err)
			}
			_, err = ParseOnlineEmbeddingProfile(payload)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("parse error = %v, want substring %q", err, test.want)
			}
		})
	}
}

// TestOnlineEgressScopeRoundTrips proves a complete scope survives the strict
// document encode/decode and that the profile digest covers the egress object.
func TestOnlineEgressScopeRoundTrips(t *testing.T) {
	profile := testOnlineProfile(t, "https://api.example.invalid/v1/embeddings")
	payload, err := json.Marshal(profile)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := ParseOnlineEmbeddingProfile(payload)
	if err != nil {
		t.Fatalf("round trip: %v", err)
	}
	if parsed.Egress.DestinationHost != profile.Egress.DestinationHost ||
		parsed.Egress.Expiry != profile.Egress.Expiry ||
		parsed.Egress.RevocationRef != profile.Egress.RevocationRef ||
		parsed.Egress.AuditRequired != profile.Egress.AuditRequired ||
		parsed.Egress.Budgets != profile.Egress.Budgets {
		t.Fatalf("egress scope did not round-trip: %+v", parsed.Egress)
	}
	if parsed.ProviderProfileDigest() != profile.ProviderProfileDigest() {
		t.Fatal("a re-encoded identical profile must have the same digest")
	}
	// The digest covers the whole document: editing any egress fact in the
	// JSON changes it, so stored grants and receipts cannot be reinterpreted.
	mutated := profile
	mutated.Egress.PolicyRefs.Retention = "a different policy"
	if mutated.ProviderProfileDigest() == profile.ProviderProfileDigest() {
		t.Fatal("the egress scope must be covered by the profile digest")
	}
}

// TestOnlineEgressMinimizationMatchesTransmittedBody proves the declared
// minimization field list is exactly the request body vocabulary the provider
// builds, with and without an instruction and a dimensions parameter.
func TestOnlineEgressMinimizationMatchesTransmittedBody(t *testing.T) {
	tests := []struct {
		name             string
		instructionField string
		instruction      string
		sendDimensions   bool
	}{
		{name: "plain", instructionField: "", sendDimensions: false},
		{name: "instruction", instructionField: "input_type", instruction: "document", sendDimensions: false},
		{name: "dimensions", instructionField: "", sendDimensions: true},
		{name: "instruction and dimensions", instructionField: "instruction", instruction: "retrieve", sendDimensions: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			stub := newOnlineStub(t, 4)
			profile := testOnlineProfile(t, stub.server.URL)
			profile.InstructionField = test.instructionField
			profile.Instruction = test.instruction
			profile.SendDimensions = test.sendDimensions
			profile.Egress.Minimization.Fields = expectedOnlineEgressRequestFields(test.instructionField, test.sendDimensions)
			if err := profile.Validate(); err != nil {
				t.Fatalf("profile with matching minimization refused: %v", err)
			}
			built := testOnlineProviderOptions(t, profile)
			provider := mustTestOnlineProvider(t, built.options)
			if _, err := provider.Embed(context.Background(), onlineDocumentRequest(built.options.Manifest, "minimization text")); err != nil {
				t.Fatalf("embed: %v", err)
			}
			stub.mu.Lock()
			body := stub.bodies[0]
			stub.mu.Unlock()
			var fields map[string]json.RawMessage
			if err := json.Unmarshal(body, &fields); err != nil {
				t.Fatal(err)
			}
			declared := map[string]bool{}
			for _, field := range profile.Egress.Minimization.Fields {
				declared[field] = true
			}
			for field := range fields {
				if !declared[field] {
					t.Fatalf("the request body carries undeclared field %q; declared = %+v", field, profile.Egress.Minimization.Fields)
				}
			}
			if len(fields) != len(profile.Egress.Minimization.Fields) {
				t.Fatalf("body fields = %+v, declared = %+v", fields, profile.Egress.Minimization.Fields)
			}
		})
	}
}
