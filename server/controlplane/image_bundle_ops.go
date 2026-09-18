package controlplane

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/ailiheizi/restoreweave/client/command"
	"github.com/ailiheizi/restoreweave/server/internal/search"
)

// handleImageBundleInstall installs one image bundle archive into the
// configured models root. Installation is explicit and independent from index
// building: it never loads a provider, activates a dimension, or rebuilds a
// generation. A daemon started without an installer keeps the operation visible
// and unavailable, which is how an override or test configuration stays honest.
func (d *Dispatcher) handleImageBundleInstall(ctx context.Context, env command.Envelope, started time.Time) command.Result {
	var input command.ImageBundleInstallInput
	if err := decodeImageBundleInstallInput(env.Input, &input); err != nil {
		return invalidInputResult(env, started, err)
	}
	archive := strings.TrimSpace(input.ArchivePath)
	if archive == "" {
		return invalidInputResult(env, started, errors.New("archive_path is required: the image bundle is installed from a local archive"))
	}
	if d == nil || d.imageBundleArchiveInstaller == nil || strings.TrimSpace(d.imageBundleModelsRoot) == "" {
		return failed(env, started, newReason(ReasonCodeUnavailable, "image bundle installer is unavailable"))
	}
	// The installer stages and publishes atomically; this mutex keeps two
	// requests inside one daemon from racing over the same models root.
	d.imageBundleInstallMu.Lock()
	defer d.imageBundleInstallMu.Unlock()
	receipt, err := d.imageBundleArchiveInstaller(ctx, d.imageBundleModelsRoot, archive)
	if err != nil {
		return failed(env, started, newReason(ReasonCodeUnavailable, "image bundle installation unavailable: "+err.Error()))
	}
	if err := validateImageBundleInstallReceipt(receipt, d.imageBundleModelsRoot); err != nil {
		return failed(env, started, newReason(ReasonCodeUnavailable, "image bundle installation returned invalid admission: "+err.Error()))
	}
	return succeeded(env, started, command.ImageBundleInstallData{
		ProfileID:       receipt.Admission.Descriptor.ProfileID,
		ProfileDigest:   receipt.Admission.ProfileDigest,
		Destination:     receipt.Destination,
		AssetCount:      len(receipt.Admission.AssetDigests),
		Changed:         receipt.Changed,
		RestartRequired: true,
	})
}

// validateImageBundleInstallReceipt refuses a receipt whose admission does not
// actually live under the configured models root, so an installer cannot report
// a bundle it did not install.
func validateImageBundleInstallReceipt(receipt ImageBundleInstallReceipt, modelsRoot string) error {
	expected, err := search.DefaultImageBundleDestination(modelsRoot)
	if err != nil {
		return err
	}
	if strings.TrimSpace(receipt.Destination) != expected {
		return fmt.Errorf("destination %q is not the admitted image bundle root %q", receipt.Destination, expected)
	}
	if receipt.Admission.Root != expected {
		return fmt.Errorf("admission root %q does not match destination %q", receipt.Admission.Root, expected)
	}
	if err := search.ValidateDefaultImageBundleAdmission(receipt.Admission); err != nil {
		return err
	}
	if len(receipt.Admission.AssetDigests) == 0 {
		return errors.New("admission carries no verified assets")
	}
	loaded, err := search.LoadImageBundle(expected)
	if err != nil {
		return fmt.Errorf("installed bundle does not admit: %w", err)
	}
	if loaded.ProfileDigest != receipt.Admission.ProfileDigest {
		return errors.New("installed profile digest differs from the reported admission")
	}
	return nil
}

func decodeImageBundleInstallInput(raw json.RawMessage, input *command.ImageBundleInstallInput) error {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return errors.New("input must be a JSON object")
	}
	decoder := json.NewDecoder(bytes.NewReader(trimmed))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(input); err != nil {
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
