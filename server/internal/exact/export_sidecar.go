package exact

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
)

// Export handoff sidecar policies.
//
// The frozen ExportManifest records the sidecar policy the operator requested
// ("requested metadata and sidecar policy", content-store-views-and-exports.md
// 7.3). The vocabulary is deliberately small and explicit:
//
//   - ExportSidecarPolicyNone (the empty string, today's default) requests no
//     sidecar: the destination holds exactly the frozen subject files.
//   - ExportSidecarPolicyHandoffV1ManifestJSON writes exactly one derived file,
//     ExportSidecarFileName, next to the frozen subject files.
//
// Every other non-empty value is an unimplemented policy. export.plan rejects it
// as invalid_input, and apply/verify refuse a frozen manifest that carries one,
// because an operator who requests a sidecar and silently receives none is the
// failure this vocabulary exists to remove.
const (
	// ExportSidecarPolicyNone requests no sidecar output.
	ExportSidecarPolicyNone = ""
	// ExportSidecarPolicyHandoffV1ManifestJSON is the only implemented policy:
	// one derived JSON description of the frozen manifest.
	ExportSidecarPolicyHandoffV1ManifestJSON = "handoff-v1:manifest-json"
	// ExportSidecarFileName is the fixed destination-relative name of the one
	// derived sidecar file. It is a derived output, never a frozen subject
	// name: a frozen output that would occupy this name fails closed.
	ExportSidecarFileName = "cairn-export.json"
	// ExportSidecarSchemaV1 names the derived sidecar document. It is a
	// handoff aid, not a recovery or identity record.
	ExportSidecarSchemaV1 = "org.cairn.export-handoff.v1"
)

// ExportSidecarNote is embedded in every generated sidecar so the file states
// its own standing. The sidecar is derived output: exact bytes stay identified
// by the per-item SHA-256 content ids and the frozen manifest digest, and this
// file neither establishes identity nor records a verification the daemon did
// not perform.
const ExportSidecarNote = "Derived export handoff sidecar, recomputed from the frozen ExportManifest at write and verify time. It is not content identity: exact bytes are identified by each item's SHA-256 content id and by the frozen manifest digest. Editing this file cannot change what the manifest froze; re-plan the export instead."

// The frozen org.cairn.export-manifest.v1 field set carries content
// identity, logical size, and exactness per item, and no protection outcome.
// The sidecar therefore states that outcome as unavailable with the reason
// instead of fabricating one; a protection outcome also must never be re-read
// from live catalog state, which would make the sidecar non-deterministic.
const (
	exportSidecarProtectionOutcome       = "UNAVAILABLE"
	exportSidecarProtectionOutcomeReason = "the frozen org.cairn.export-manifest.v1 field set records content identity, logical size, and exactness per item and carries no protection outcome, so none is asserted here"
)

// UnsupportedSidecarPolicyError reports a sidecar policy that this build does
// not implement. It is a caller-visible input problem: the policy value came
// from an export.plan input or from a frozen manifest, and neither may be
// silently materialized with fewer outputs than it requested.
type UnsupportedSidecarPolicyError struct {
	Policy string
}

func (err UnsupportedSidecarPolicyError) Error() string {
	return fmt.Sprintf(
		"sidecar policy %q is not implemented by this daemon build; the only implemented policy is %q, and omitting sidecars requests none",
		err.Policy, ExportSidecarPolicyHandoffV1ManifestJSON)
}

// IsUnsupportedSidecarPolicy reports whether err is an
// UnsupportedSidecarPolicyError.
func IsUnsupportedSidecarPolicy(err error) bool {
	var unsupported UnsupportedSidecarPolicyError
	return errors.As(err, &unsupported)
}

// ResolveExportSidecarFiles maps one frozen sidecar policy to the exact set of
// destination-relative derived files it requires. The empty policy requires
// none. Any other value is unimplemented and fails closed rather than being
// ignored.
func ResolveExportSidecarFiles(policy string) ([]string, error) {
	trimmed := strings.TrimSpace(policy)
	switch trimmed {
	case ExportSidecarPolicyNone:
		return nil, nil
	case ExportSidecarPolicyHandoffV1ManifestJSON:
		return []string{ExportSidecarFileName}, nil
	default:
		return nil, UnsupportedSidecarPolicyError{Policy: trimmed}
	}
}

// ExportSidecarNameConflictError reports a frozen output name that would
// occupy the same destination path as a requested derived sidecar file. The
// collision fails closed; a derived file never overwrites, and is never
// overwritten by, a frozen subject output. It keeps ErrBlocked in its chain so
// the exact lane's existing reason mapping is unchanged.
type ExportSidecarNameConflictError struct {
	Name string
}

func (err ExportSidecarNameConflictError) Error() string {
	return fmt.Sprintf(
		"frozen output name %q collides with the derived sidecar file of the requested sidecar policy; rename that output or request no sidecar",
		err.Name)
}

func (err ExportSidecarNameConflictError) Unwrap() error { return ErrBlocked }

// ExportSidecarNameConflict returns a non-nil error when one of the requested
// sidecar file names would occupy the same destination path as a frozen output
// name.
func ExportSidecarNameConflict(sidecarFiles []string, items []ExportItem) error {
	if len(sidecarFiles) == 0 {
		return nil
	}
	frozen := make(map[string]struct{}, len(items))
	for _, item := range items {
		frozen[item.OutputName] = struct{}{}
	}
	ordered := append([]string(nil), sidecarFiles...)
	sort.Strings(ordered)
	for _, name := range ordered {
		if _, clash := frozen[name]; clash {
			return ExportSidecarNameConflictError{Name: name}
		}
	}
	return nil
}

// exportSidecarItem is one frozen item restated for the handoff reader: its
// output name, its exact content identity, its logical size, and whether exact
// bytes were selected for it.
type exportSidecarItem struct {
	OutputName  string `json:"output_name"`
	ContentID   string `json:"content_id"`
	LogicalSize int64  `json:"logical_size"`
	Exact       bool   `json:"exact"`
}

// exportSidecarDocument is the derived handoff document. Every field is a
// function of the frozen manifest alone, so the same frozen manifest always
// renders byte-identical sidecar content.
type exportSidecarDocument struct {
	Schema                  string              `json:"schema"`
	Note                    string              `json:"note"`
	ManifestID              string              `json:"manifest_id"`
	ManifestDigest          string              `json:"manifest_digest"`
	SidecarPolicy           string              `json:"sidecar_policy"`
	Representation          string              `json:"representation,omitempty"`
	TargetProfileDigest     string              `json:"target_profile_digest,omitempty"`
	ProtectionOutcome       string              `json:"protection_outcome"`
	ProtectionOutcomeReason string              `json:"protection_outcome_reason"`
	Items                   []exportSidecarItem `json:"items"`
}

// RenderExportSidecar returns the deterministic bytes of the derived handoff
// sidecar for one frozen manifest. Content depends only on the frozen field
// set, so re-applying the same frozen manifest to another empty destination
// reproduces byte-identical sidecar content. The renderer runs only for the
// implemented policy; an unimplemented policy fails closed.
func RenderExportSidecar(manifest ExportManifest) ([]byte, error) {
	files, err := ResolveExportSidecarFiles(manifest.Sidecars)
	if err != nil {
		return nil, err
	}
	if len(files) == 0 {
		return nil, fmt.Errorf("%w: the frozen manifest requested no sidecar to render", ErrBlocked)
	}
	document := exportSidecarDocument{
		Schema:                  ExportSidecarSchemaV1,
		Note:                    ExportSidecarNote,
		ManifestID:              manifest.ManifestID,
		ManifestDigest:          manifest.ManifestDigest,
		SidecarPolicy:           manifest.Sidecars,
		Representation:          manifest.Representation,
		TargetProfileDigest:     manifest.TargetProfileDigest,
		ProtectionOutcome:       exportSidecarProtectionOutcome,
		ProtectionOutcomeReason: exportSidecarProtectionOutcomeReason,
		Items:                   make([]exportSidecarItem, 0, len(manifest.Items)),
	}
	for _, item := range manifest.Items {
		document.Items = append(document.Items, exportSidecarItem{
			OutputName:  item.OutputName,
			ContentID:   item.ContentID,
			LogicalSize: item.LogicalSize,
			Exact:       item.Exact,
		})
	}
	payload, err := json.MarshalIndent(document, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(payload, '\n'), nil
}

// exportSidecarPlan resolves one frozen manifest's derived sidecar files and
// renders the exact bytes each must contain. The empty policy yields an empty
// plan. An unimplemented policy, a frozen-output name collision, or a render
// failure fails closed before any destination is touched.
func exportSidecarPlan(manifest ExportManifest) (map[string][]byte, error) {
	files, err := ResolveExportSidecarFiles(manifest.Sidecars)
	if err != nil {
		return nil, err
	}
	if len(files) == 0 {
		return nil, nil
	}
	if err := ExportSidecarNameConflict(files, manifest.Items); err != nil {
		return nil, err
	}
	payload, err := RenderExportSidecar(manifest)
	if err != nil {
		return nil, err
	}
	plan := make(map[string][]byte, len(files))
	for _, name := range files {
		plan[name] = payload
	}
	return plan, nil
}

// orderedExportSidecarNames returns the plan's file names in deterministic
// order so responses and error messages do not depend on map iteration.
func orderedExportSidecarNames(plan map[string][]byte) []string {
	if len(plan) == 0 {
		return nil
	}
	names := make([]string, 0, len(plan))
	for name := range plan {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}
