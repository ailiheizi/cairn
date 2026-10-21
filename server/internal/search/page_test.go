package search

import (
	"errors"
	"strings"
	"testing"
	"time"
)

// TestContinuationTokenRoundTrip proves a minted token parses back to exactly
// the position it was minted for, and that the caller-visible token carries no
// query, path, workspace, or filter text.
func TestContinuationTokenRoundTrip(t *testing.T) {
	now := time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)
	binding := ContinuationBinding{
		Scope:        AuthorizationScopeDigest("wsp_0123456789abcdef0123456789abcdef"),
		Query:        strings.Repeat("a", 64),
		GenerationID: "idx_0123456789abcdef0123456789abcdef",
		Lane:         DimensionLexical,
		Order:        OrderRankRowID,
	}
	position := PagePosition{Lane: DimensionLexical, RowID: 4242, Rank: -1.375e-06, HasRank: true}
	token, expires, err := MintContinuation(binding, position, now)
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	if !expires.Equal(now.Add(ContinuationTTL)) {
		t.Fatalf("expiry = %s, want %s", expires, now.Add(ContinuationTTL))
	}
	parsed, err := ParseContinuation(token, binding, now)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if parsed != position {
		t.Fatalf("parsed position = %+v, want %+v", parsed, position)
	}
	// The token is opaque: it must not carry the query text, a path, a
	// workspace id, or a filter value a caller could read or rewrite.
	for _, secret := range []string{"wsp_0123456789abcdef0123456789abcdef", "docs/secret.txt", "STORE_EXACT"} {
		if strings.Contains(token, secret) {
			t.Fatalf("continuation token leaks %q: %s", secret, token)
		}
	}
}

// TestContinuationTokenRefusals proves the token fails closed: a malformed,
// tampered, expired, or out-of-scope token is refused, never answered with a
// page from another query, generation, or authorization scope.
func TestContinuationTokenRefusals(t *testing.T) {
	now := time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)
	binding := ContinuationBinding{
		Scope:        AuthorizationScopeDigest("wsp_0123456789abcdef0123456789abcdef"),
		Query:        strings.Repeat("b", 64),
		GenerationID: "idx_0123456789abcdef0123456789abcdef",
		Lane:         DimensionLexical,
		Order:        OrderRankRowID,
	}
	position := PagePosition{Lane: DimensionLexical, RowID: 7, Rank: -2.5, HasRank: true}
	token, _, err := MintContinuation(binding, position, now)
	if err != nil {
		t.Fatalf("mint: %v", err)
	}

	other := func(mutate func(*ContinuationBinding)) ContinuationBinding {
		candidate := binding
		mutate(&candidate)
		return candidate
	}
	cases := []struct {
		name    string
		token   string
		binding ContinuationBinding
		at      time.Time
		want    error
	}{
		{name: "empty", token: "", binding: binding, at: now, want: ErrInvalidContinuation},
		{name: "not base64", token: "not-a-token", binding: binding, at: now, want: ErrInvalidContinuation},
		{name: "missing mac", token: strings.Split(token, ".")[0], binding: binding, at: now, want: ErrInvalidContinuation},
		{name: "tampered payload", token: tamperTokenSegment(token, 0), binding: binding, at: now, want: ErrInvalidContinuation},
		{name: "tampered mac", token: tamperTokenSegment(token, 1), binding: binding, at: now, want: ErrInvalidContinuation},
		{name: "expired", token: token, binding: binding, at: now.Add(ContinuationTTL + time.Second), want: ErrStaleContinuation},
		{
			name: "another authorization scope", token: token, at: now, want: ErrStaleContinuation,
			binding: other(func(c *ContinuationBinding) {
				c.Scope = AuthorizationScopeDigest("wsp_ffffffffffffffffffffffffffffffff")
			}),
		},
		{
			name: "another query", token: token, at: now, want: ErrStaleContinuation,
			binding: other(func(c *ContinuationBinding) { c.Query = strings.Repeat("c", 64) }),
		},
		{
			name: "another generation", token: token, at: now, want: ErrStaleContinuation,
			binding: other(func(c *ContinuationBinding) { c.GenerationID = "idx_ffffffffffffffffffffffffffffffff" }),
		},
		{
			name: "another order", token: token, at: now, want: ErrStaleContinuation,
			binding: other(func(c *ContinuationBinding) { c.Order = OrderRowID }),
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			parsed, err := ParseContinuation(testCase.token, testCase.binding, testCase.at)
			if err == nil {
				t.Fatalf("expected refusal, got position %+v", parsed)
			}
			if !errors.Is(err, testCase.want) {
				t.Fatalf("refusal = %v, want %v", err, testCase.want)
			}
		})
	}
}

func TestSavedViewContinuationUsesOnlyCanonicalProjectionOrdinals(t *testing.T) {
	now := time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC)
	binding := ContinuationBinding{
		Scope:        AuthorizationScopeDigest("wsp_0123456789abcdef0123456789abcdef"),
		Query:        strings.Repeat("c", 64),
		GenerationID: "idx_0123456789abcdef0123456789abcdef",
		Lane:         LaneSavedView,
		Order:        OrderSavedViewLexical,
	}
	position := PagePosition{Lane: LaneSavedView, EntryID: "200"}
	token, expires, err := MintContinuation(binding, position, now)
	if err != nil {
		t.Fatalf("mint saved-view continuation: %v", err)
	}
	if !expires.Equal(now.Add(ContinuationTTL)) {
		t.Fatalf("expiry = %s, want %s", expires, now.Add(ContinuationTTL))
	}
	parsed, err := ParseContinuation(token, binding, now)
	if err != nil || parsed != position {
		t.Fatalf("saved-view continuation parsed %+v, %v; want %+v", parsed, err, position)
	}
	for _, malformed := range []string{"", "00", "-1", "+1", "1.0", "9223372036854775808"} {
		if _, _, err := MintContinuation(binding, PagePosition{Lane: LaneSavedView, EntryID: malformed}, now); err == nil {
			t.Fatalf("mint accepted noncanonical saved-view ordinal %q", malformed)
		}
	}
	if _, _, err := MintContinuation(binding, PagePosition{Lane: LaneSavedView, EntryID: "1", HasRank: true}, now); err == nil {
		t.Fatal("mint accepted saved-view ordinal carrying an index rank")
	}
	wrongOrder := binding
	wrongOrder.Order = OrderRowID
	if _, _, err := MintContinuation(wrongOrder, PagePosition{Lane: LaneSavedView, EntryID: "1"}, now); err == nil {
		t.Fatal("mint accepted saved-view lane with a search-index order")
	}
	if _, err := ParseContinuation(token, ContinuationBinding{
		Scope: binding.Scope, Query: binding.Query, GenerationID: binding.GenerationID,
		Lane: LaneSavedView, Order: OrderRowID,
	}, now); err == nil {
		t.Fatal("parse accepted saved-view token under a different order")
	}
	if _, err := ParseContinuation(token, binding, now.Add(ContinuationTTL)); !errors.Is(err, ErrStaleContinuation) {
		t.Fatalf("expired saved-view continuation = %v, want stale refusal", err)
	}
}

// TestContinuationRefusesANonPageableLane proves a position can only be minted
// for a lane that has a complete, seekable order.
func TestContinuationRefusesANonPageableLane(t *testing.T) {
	now := time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)
	binding := ContinuationBinding{
		Scope:        AuthorizationScopeDigest("wsp_0123456789abcdef0123456789abcdef"),
		Query:        strings.Repeat("d", 64),
		GenerationID: "idx_0123456789abcdef0123456789abcdef",
		Lane:         DimensionSemantic,
		Order:        OrderRankRowID,
	}
	if _, _, err := MintContinuation(binding, PagePosition{Lane: DimensionSemantic, RowID: 1}, now); err == nil {
		t.Fatal("minting a continuation for a bounded top-k lane must fail closed")
	}
}

func TestDescriptionListContinuationUsesStrictProjectionPosition(t *testing.T) {
	now := time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC)
	binding := ContinuationBinding{
		Scope:        AuthorizationScopeDigest("wsp_0123456789abcdef0123456789abcdef"),
		Query:        strings.Repeat("e", 64),
		GenerationID: "sha256:" + strings.Repeat("f", 64),
		Lane:         LaneDescriptionList,
		Order:        OrderDescriptionSubjectRevisionID,
	}
	position := PagePosition{Lane: LaneDescriptionList, EntryID: "opaque-keyset-position"}
	token, _, err := MintContinuation(binding, position, now)
	if err != nil {
		t.Fatalf("mint description continuation: %v", err)
	}
	parsed, err := ParseContinuation(token, binding, now)
	if err != nil || parsed != position {
		t.Fatalf("parse description continuation = %+v, %v", parsed, err)
	}
	if _, err := ParseContinuation(token, binding, now.Add(ContinuationTTL+time.Second)); !errors.Is(err, ErrStaleContinuation) {
		t.Fatalf("expired description continuation error = %v", err)
	}
	for name, invalid := range map[string]PagePosition{
		"missing keyset": {Lane: LaneDescriptionList},
		"index row id":   {Lane: LaneDescriptionList, EntryID: "opaque", RowID: 4},
		"index rank":     {Lane: LaneDescriptionList, EntryID: "opaque", HasRank: true, Rank: 1},
		"stray rank":     {Lane: LaneDescriptionList, EntryID: "opaque", Rank: 1},
	} {
		if _, _, err := MintContinuation(binding, invalid, now); !errors.Is(err, ErrInvalidContinuation) {
			t.Errorf("mint %s position error = %v", name, err)
		}
	}
	wrongOrder := binding
	wrongOrder.Order = OrderEntryPathID
	if _, _, err := MintContinuation(wrongOrder, position, now); !errors.Is(err, ErrInvalidContinuation) {
		t.Fatalf("description position with content order error = %v", err)
	}
}

// TestQueryShapeDigestIsCanonical proves two spellings of one query share one
// digest, and that any change to the query changes it. This is what stops a
// cursor from one query being replayed against another.
func TestQueryShapeDigestIsCanonical(t *testing.T) {
	base := QueryShape{
		WorkspaceID: "wsp_0123456789abcdef0123456789abcdef",
		Dimension:   DimensionLexical,
		Text:        "  quarterly report  ",
		Axes:        []string{AxisName, AxisPath, AxisName},
	}
	digest, err := base.Digest()
	if err != nil {
		t.Fatalf("digest: %v", err)
	}
	reordered := QueryShape{
		WorkspaceID: base.WorkspaceID,
		Dimension:   base.Dimension,
		Text:        "quarterly report",
		Axes:        []string{AxisPath, AxisName},
	}
	other, err := reordered.Digest()
	if err != nil {
		t.Fatalf("digest: %v", err)
	}
	if digest != other {
		t.Fatalf("equivalent query shapes produced different digests: %s vs %s", digest, other)
	}
	for name, changed := range map[string]QueryShape{
		"text":      {WorkspaceID: base.WorkspaceID, Dimension: base.Dimension, Text: "quarterly"},
		"dimension": {WorkspaceID: base.WorkspaceID, Dimension: DimensionSemantic, Text: "quarterly report"},
		"workspace": {WorkspaceID: "wsp_ffffffffffffffffffffffffffffffff", Dimension: base.Dimension, Text: "quarterly report"},
		"filter": {
			WorkspaceID: base.WorkspaceID, Dimension: base.Dimension, Text: "quarterly report",
			Filters: Filters{EntryType: "REGULAR_FILE"},
		},
	} {
		changedDigest, digestErr := changed.Digest()
		if digestErr != nil {
			t.Fatalf("digest %s: %v", name, digestErr)
		}
		if changedDigest == digest {
			t.Fatalf("changing %s did not change the query digest", name)
		}
	}
}

// TestResolvePageSizeRefusesOutOfRange proves the bound is caller-controllable
// within a documented maximum and refused outside it, never silently clamped.
func TestResolvePageSizeRefusesOutOfRange(t *testing.T) {
	if got, err := ResolvePageSize(0); err != nil || got != DefaultPageSize {
		t.Fatalf("default page size = %d, %v", got, err)
	}
	if got, err := ResolvePageSize(MaxPageSize); err != nil || got != MaxPageSize {
		t.Fatalf("max page size = %d, %v", got, err)
	}
	if _, err := ResolvePageSize(MaxPageSize + 1); err == nil {
		t.Fatal("page size above the maximum must be refused, not clamped")
	}
	if _, err := ResolvePageSize(-1); err == nil {
		t.Fatal("negative page size must be refused")
	}
}

func tamperTokenSegment(token string, segment int) string {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return token
	}
	payload := []byte(parts[segment])
	if len(payload) < 6 {
		return token
	}
	replacement := byte('A')
	if payload[5] == 'A' {
		replacement = 'B'
	}
	payload[5] = replacement
	parts[segment] = string(payload)
	return strings.Join(parts, ".")
}
