package controlplane

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"time"

	"github.com/ailiheizi/cairn/client/command"
	"github.com/ailiheizi/cairn/server/internal/search"
)

// Online provider profile operations
//
// semantic.provider.install admits one operator-supplied online embedding
// profile into the daemon's configured models root. The source is an absolute
// local path on the host; a URL is never an install source and the browser
// never uploads content. Installing is a profile fact, not a capability
// claim: it activates no provider, endpoint, grant, or generation.
//
// semantic.provider.list reports exactly what the daemon can read from its own
// models root. A missing directory is an empty list; a malformed installed
// profile is an explicit error, never a silent omission.

func (d *Dispatcher) handleSemanticProviderInstall(ctx context.Context, env command.Envelope, started time.Time) command.Result {
	var input command.SemanticProviderInstallInput
	if err := decodeStrictOperationInput(env.Input, &input); err != nil {
		return invalidInputResult(env, started, err)
	}
	if strings.TrimSpace(input.Path) == "" || strings.TrimSpace(input.Path) != input.Path ||
		!filepath.IsAbs(input.Path) || filepath.Clean(input.Path) != input.Path {
		return invalidInputResult(env, started, errors.New("path must be an absolute canonical path to a local profile document"))
	}
	if strings.TrimSpace(input.ProfileDigest) == "" {
		return invalidInputResult(env, started, errors.New("profile_digest is required: the daemon checks the declared digest of the whole document"))
	}
	if d == nil || d.onlineProviderInstaller == nil || strings.TrimSpace(d.onlineProviderModelsRoot) == "" {
		return failed(env, started, newReason(ReasonCodeUnavailable, "online provider installer is unavailable"))
	}
	d.onlineProviderInstallMu.Lock()
	defer d.onlineProviderInstallMu.Unlock()
	receipt, err := d.onlineProviderInstaller(ctx, d.onlineProviderModelsRoot, input.Path, input.ProfileDigest)
	if err != nil {
		return failed(env, started, newReason(ReasonCodeUnavailable, "online provider profile installation unavailable: "+err.Error()))
	}
	if err := validateOnlineProviderInstallReceipt(receipt, d.onlineProviderModelsRoot); err != nil {
		return failed(env, started, newReason(ReasonCodeUnavailable, "online provider profile installation returned invalid admission: "+err.Error()))
	}
	return succeeded(env, started, projectOnlineProviderInstall(receipt))
}

// validateOnlineProviderInstallReceipt refuses a receipt whose admission does
// not actually live under the configured models root, so an installer cannot
// report a profile it did not publish.
func validateOnlineProviderInstallReceipt(receipt OnlineProviderInstallReceipt, modelsRoot string) error {
	expected, err := search.OnlineEmbeddingProfilePath(modelsRoot, receipt.Profile.ProfileID)
	if err != nil {
		return err
	}
	if strings.TrimSpace(receipt.Destination) != expected {
		return fmt.Errorf("destination %q is not the admitted online profile path %q", receipt.Destination, expected)
	}
	loaded, err := search.LoadOnlineEmbeddingProfile(modelsRoot, receipt.Profile.ProfileID)
	if err != nil {
		return fmt.Errorf("installed profile does not admit: %w", err)
	}
	if loaded.ProviderProfileDigest() != receipt.Profile.ProviderProfileDigest() {
		return errors.New("installed profile digest differs from the reported admission")
	}
	return nil
}

func projectOnlineProviderInstall(receipt OnlineProviderInstallReceipt) command.SemanticProviderInstallData {
	profile := receipt.Profile
	return command.SemanticProviderInstallData{
		ProfileID:             profile.ProfileID,
		Provider:              profile.Provider,
		APIStyle:              profile.APIStyle,
		EndpointHost:          profile.EndpointHost(),
		ModelID:               profile.ModelID,
		ModelRevision:         profile.ModelRevision,
		Dimension:             profile.Dimension,
		SpaceDigest:           profile.Fingerprint().CanonicalDigest(),
		ProfileDigest:         profile.ProviderProfileDigest(),
		Destination:           receipt.Destination,
		Expiry:                profile.Egress.Expiry,
		DisclosedDataClasses:  append([]string(nil), profile.Egress.DisclosedDataClasses...),
		AllowedSubjectClasses: append([]string(nil), profile.Egress.AllowedSubjectClasses...),
		Changed:               receipt.Changed,
		AlreadyInstalled:      receipt.AlreadyInstalled,
		RestartRequired:       true,
	}
}

func (d *Dispatcher) handleSemanticProviderList(_ context.Context, env command.Envelope, started time.Time) command.Result {
	var input command.SemanticProviderListInput
	if err := decodeOptionalStrictInput(env.Input, &input); err != nil {
		return invalidInputResult(env, started, err)
	}
	if d == nil {
		return failed(env, started, newReason(ReasonCodeUnavailable, "online provider registry is unavailable"))
	}
	onlineModelsRoot := strings.TrimSpace(d.onlineProviderModelsRoot)
	describeModelsRoot := strings.TrimSpace(d.describeModelsRoot)
	if onlineModelsRoot == "" && (!input.IncludeDescribe || describeModelsRoot == "") &&
		(!input.IncludeOrganize || strings.TrimSpace(d.materialOrganizeModelsRoot) == "") {
		return failed(env, started, newReason(ReasonCodeUnavailable, "online provider registry is unavailable: no models root is configured"))
	}
	profiles := []search.InstalledOnlineEmbeddingProfile{}
	if onlineModelsRoot != "" {
		var err error
		profiles, err = search.ListOnlineEmbeddingProfiles(onlineModelsRoot)
		if err != nil {
			return failed(env, started, newReason(ReasonCodeUnavailable, "online provider profile listing unavailable: "+err.Error()))
		}
	}
	data := command.SemanticProviderListData{
		ModelsRoot: onlineModelsRoot,
		Profiles:   make([]command.SemanticProviderProfileData, 0, len(profiles)),
	}
	for _, installed := range profiles {
		profile := installed.Profile
		data.Profiles = append(data.Profiles, command.SemanticProviderProfileData{
			ProfileID:             profile.ProfileID,
			Provider:              profile.Provider,
			APIStyle:              profile.APIStyle,
			EndpointHost:          profile.EndpointHost(),
			ModelID:               profile.ModelID,
			ModelRevision:         profile.ModelRevision,
			Dimension:             profile.Dimension,
			SpaceDigest:           profile.Fingerprint().CanonicalDigest(),
			ProfileDigest:         profile.ProviderProfileDigest(),
			Destination:           installed.Destination,
			Expiry:                profile.Egress.Expiry,
			DisclosedDataClasses:  append([]string(nil), profile.Egress.DisclosedDataClasses...),
			AllowedSubjectClasses: append([]string(nil), profile.Egress.AllowedSubjectClasses...),
			MaxRequests:           profile.Egress.Budgets.MaxRequests,
			MaxBytes:              profile.Egress.Budgets.MaxBytes,
			MaxSeconds:            profile.Egress.Budgets.MaxSeconds,
			AuditRequired:         profile.Egress.AuditRequired,
			Expired:               installed.Expired,
		})
	}
	if input.IncludeDescribe {
		root := describeModelsRoot
		if root == "" {
			root = onlineModelsRoot
		}
		data.Describe = projectDescribeProviderList(root, onlineModelsRoot, describeModelsRoot)
	}
	if input.IncludeOrganize {
		data.Organize = d.projectMaterialOrganizeProviderList()
	}
	return succeeded(env, started, data)
}

func (d *Dispatcher) projectMaterialOrganizeProviderList() *command.MaterialOrganizeProviderListData {
	data := &command.MaterialOrganizeProviderListData{State: "UNAVAILABLE", Profiles: []command.MaterialOrganizeProviderProfileData{}, ActiveProfileID: d.materialOrganizeProfileID}
	if strings.TrimSpace(d.materialOrganizeModelsRoot) == "" {
		data.Reason = "material organizer models root is not configured"
		return data
	}
	profiles, err := search.ListOnlineOrganizeProfiles(d.materialOrganizeModelsRoot)
	if err != nil {
		data.Reason = "material organizer profile listing unavailable"
		return data
	}
	for _, installed := range profiles {
		profile := installed.Profile
		data.Profiles = append(data.Profiles, command.MaterialOrganizeProviderProfileData{
			ProfileID: profile.ProfileID, ProfileDigest: profile.ProviderProfileDigest(), Provider: profile.Provider,
			EndpointHost: profile.EndpointHost(), ModelID: profile.ModelID, ModelRevision: profile.ModelRevision,
			OutputSchema: profile.OutputSchema, Destination: installed.Destination, Expiry: profile.Egress.Expiry,
			DisclosedDataClasses:  append([]string(nil), profile.Egress.DisclosedDataClasses...),
			AllowedSubjectClasses: append([]string(nil), profile.Egress.AllowedSubjectClasses...),
			MaxRequests:           profile.Egress.Budgets.MaxRequests, MaxBytes: profile.Egress.Budgets.MaxBytes,
			MaxSeconds: profile.Egress.Budgets.MaxSeconds, MaxOutputBytes: profile.MaxOutputBytes,
			TimeoutMS: profile.TimeoutMS, Expired: installed.Expired,
		})
	}
	if d.materialOrganizer == nil {
		if d.materialOrganizeUnavailable != "" {
			data.Reason = d.materialOrganizeUnavailable
		} else {
			data.Reason = "no active material organizer profile is configured"
		}
		return data
	}
	if d.materialOrganizeProfileID == "" || d.materialOrganizer.Profile().ProfileID != d.materialOrganizeProfileID {
		data.Reason = "the selected material organizer profile is unavailable"
		return data
	}
	// READY means the selected installed profile is valid and bound to this
	// daemon. Listing does not resolve credentials or inspect live grants;
	// those checks happen only on an explicitly confirmed organize request.
	selected := d.materialOrganizer.Profile()
	if err := selected.ValidateAt(time.Now().UTC()); err != nil {
		data.Reason = "the selected organizer profile is expired or invalid"
		return data
	}
	listed := false
	for _, profile := range profiles {
		if profile.Profile.ProfileID == d.materialOrganizeProfileID && profile.Profile.ProviderProfileDigest() == selected.ProviderProfileDigest() {
			listed = true
			break
		}
	}
	if !listed {
		data.Reason = "the selected organizer profile is not installed in the configured models root"
		return data
	}
	data.State = "READY"
	return data
}

func projectDescribeProviderList(modelsRoot, onlineModelsRoot, describeModelsRoot string) *command.DescribeProviderListData {
	data := &command.DescribeProviderListData{
		State:    "AVAILABLE",
		Profiles: []command.DescribeProviderProfileData{},
	}
	if onlineModelsRoot != "" && describeModelsRoot != "" && onlineModelsRoot != describeModelsRoot {
		data.State = "UNAVAILABLE"
		data.Reason = "the configured embedding and describe profile roots do not match"
		return data
	}
	profiles, err := search.ListOnlineDescribeProfiles(modelsRoot)
	if err != nil {
		data.State = "UNAVAILABLE"
		data.Reason = "describe profile listing unavailable: " + err.Error()
		return data
	}
	for _, installed := range profiles {
		profile := installed.Profile
		data.Profiles = append(data.Profiles, command.DescribeProviderProfileData{
			ProfileID:             profile.ProfileID,
			ProfileDigest:         profile.ProviderProfileDigest(),
			Provider:              profile.Provider,
			APIStyle:              profile.APIStyle,
			EndpointHost:          profile.EndpointHost(),
			ModelID:               profile.ModelID,
			ModelRevision:         profile.ModelRevision,
			OutputSchema:          search.OnlineDescribeOutputSchema,
			Destination:           installed.Destination,
			Expiry:                profile.Egress.Expiry,
			DisclosedDataClasses:  append([]string(nil), profile.Egress.DisclosedDataClasses...),
			AllowedSubjectClasses: append([]string(nil), profile.Egress.AllowedSubjectClasses...),
			MaxRequests:           profile.Egress.Budgets.MaxRequests,
			MaxBytes:              profile.Egress.Budgets.MaxBytes,
			MaxSeconds:            profile.Egress.Budgets.MaxSeconds,
			AuditRequired:         profile.Egress.AuditRequired,
			Expired:               installed.Expired,
		})
	}
	return data
}

// decodeStrictOperationInput decodes one typed input object and refuses
// unknown fields, trailing values, and non-object inputs.
func decodeStrictOperationInput(raw json.RawMessage, into any) error {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return errors.New("input must be a JSON object")
	}
	decoder := json.NewDecoder(bytes.NewReader(trimmed))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(into); err != nil {
		return fmt.Errorf("invalid input: %w", err)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return errors.New("input must contain exactly one JSON object")
		}
		return fmt.Errorf("invalid input: %w", err)
	}
	return nil
}

// requireOptionalEmptyObject accepts an omitted input or exactly an empty JSON
// object for read-only operations.
func requireOptionalEmptyObject(raw json.RawMessage) error {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return nil
	}
	return requireEmptyObject(raw)
}
