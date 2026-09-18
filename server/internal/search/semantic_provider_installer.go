package search

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Installing an online provider profile
//
// An online embedding profile is operator-supplied input, but the daemon is
// the only component that admits it. The install source is an absolute local
// path on the host (never a URL, never a browser upload), the document is
// strictly decoded and validated, its declared profile digest must match the
// digest the daemon computes over the whole document, and the published file
// lands only at <models>/online-embedding/<profile_id>/profile.json.
//
// Replacing a different existing profile moves the old directory aside with a
// timestamped sibling name; this code never deletes a previously admitted
// profile. Installing never selects, activates, or grants anything: it is a
// profile fact that requires a restart and an explicit grant to be useful.

// InstalledOnlineEmbeddingProfile is one profile the daemon read from its own
// configured models root.
type InstalledOnlineEmbeddingProfile struct {
	Profile     OnlineEmbeddingProfile
	Destination string
	Expired     bool
}

// OnlineEmbeddingProfileInstallReceipt is the deterministic result of one
// profile installation.
type OnlineEmbeddingProfileInstallReceipt struct {
	Profile          OnlineEmbeddingProfile
	Destination      string
	Changed          bool
	AlreadyInstalled bool
}

// ListOnlineEmbeddingProfiles reads every installed online embedding profile
// below the configured models root. A missing online-embedding directory is an
// empty list, not an error: no profile has been installed yet. A malformed or
// unreadable directory entry is reported as an error, never silently skipped.
func ListOnlineEmbeddingProfiles(modelsRoot string) ([]InstalledOnlineEmbeddingProfile, error) {
	root, err := canonicalSemanticBundleInstallRoot(modelsRoot)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidOnlineEmbeddingProfile, err)
	}
	base := filepath.Join(root, OnlineEmbeddingProfileDirName)
	info, err := os.Lstat(base)
	if errors.Is(err, os.ErrNotExist) {
		return []InstalledOnlineEmbeddingProfile{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("%w: inspect %s: %v", ErrInvalidOnlineEmbeddingProfile, base, err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return nil, fmt.Errorf("%w: %s must be a real directory", ErrInvalidOnlineEmbeddingProfile, base)
	}
	entries, err := os.ReadDir(base)
	if err != nil {
		return nil, fmt.Errorf("%w: read %s: %v", ErrInvalidOnlineEmbeddingProfile, base, err)
	}
	profiles := make([]InstalledOnlineEmbeddingProfile, 0, len(entries))
	now := time.Now().UTC()
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		if !entry.IsDir() {
			return nil, fmt.Errorf("%w: %s is not a profile directory", ErrInvalidOnlineEmbeddingProfile, entry.Name())
		}
		profile, loadErr := LoadOnlineEmbeddingProfile(root, entry.Name())
		if loadErr != nil {
			return nil, loadErr
		}
		destination, pathErr := OnlineEmbeddingProfilePath(root, entry.Name())
		if pathErr != nil {
			return nil, pathErr
		}
		profiles = append(profiles, InstalledOnlineEmbeddingProfile{
			Profile: profile, Destination: destination, Expired: profile.Egress.Expired(now),
		})
	}
	sort.Slice(profiles, func(i, j int) bool { return profiles[i].Profile.ProfileID < profiles[j].Profile.ProfileID })
	return profiles, nil
}

// InstallOnlineEmbeddingProfile admits one operator-supplied profile file and
// publishes it atomically below the configured models root. declaredDigest is
// the operator's declared profile digest; the install is refused unless it
// equals the digest computed over the whole document.
func InstallOnlineEmbeddingProfile(ctx context.Context, modelsRoot, sourcePath, declaredDigest string) (OnlineEmbeddingProfileInstallReceipt, error) {
	var receipt OnlineEmbeddingProfileInstallReceipt
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return receipt, err
	}
	root, err := canonicalSemanticBundleInstallRoot(modelsRoot)
	if err != nil {
		return receipt, fmt.Errorf("%w: %v", ErrInvalidOnlineEmbeddingProfile, err)
	}
	profile, err := readOnlineEmbeddingProfileSource(sourcePath)
	if err != nil {
		return receipt, err
	}
	declared := strings.TrimSpace(declaredDigest)
	if declared == "" {
		return receipt, fmt.Errorf("%w: a declared profile digest is required", ErrInvalidOnlineEmbeddingProfile)
	}
	if declared != profile.ProviderProfileDigest() {
		return receipt, fmt.Errorf("%w: declared profile digest %q does not match the admitted document digest %q",
			ErrInvalidOnlineEmbeddingProfile, declared, profile.ProviderProfileDigest())
	}
	destination, err := OnlineEmbeddingProfilePath(root, profile.ProfileID)
	if err != nil {
		return receipt, err
	}
	changed, already, err := publishOnlineEmbeddingProfile(ctx, root, destination, profile)
	if err != nil {
		return receipt, err
	}
	installed, err := LoadOnlineEmbeddingProfile(root, profile.ProfileID)
	if err != nil {
		return receipt, fmt.Errorf("%w: installed profile does not admit: %v", ErrInvalidOnlineEmbeddingProfile, err)
	}
	if installed.ProviderProfileDigest() != profile.ProviderProfileDigest() {
		return receipt, fmt.Errorf("%w: installed profile digest differs from the admitted document", ErrInvalidOnlineEmbeddingProfile)
	}
	return OnlineEmbeddingProfileInstallReceipt{
		Profile: installed, Destination: destination, Changed: changed, AlreadyInstalled: already,
	}, nil
}

func readOnlineEmbeddingProfileSource(sourcePath string) (OnlineEmbeddingProfile, error) {
	if strings.TrimSpace(sourcePath) == "" || strings.TrimSpace(sourcePath) != sourcePath ||
		!filepath.IsAbs(sourcePath) || filepath.Clean(sourcePath) != sourcePath {
		return OnlineEmbeddingProfile{}, fmt.Errorf("%w: profile source path must be absolute and canonical", ErrInvalidOnlineEmbeddingProfile)
	}
	parent := filepath.Dir(sourcePath)
	if err := validateSemanticBundlePath(parent, false); err != nil {
		return OnlineEmbeddingProfile{}, fmt.Errorf("%w: profile source parent: %v", ErrInvalidOnlineEmbeddingProfile, err)
	}
	file, err := openBundleFileNoFollow(parent, filepath.Base(sourcePath))
	if err != nil {
		return OnlineEmbeddingProfile{}, fmt.Errorf("%w: open profile source: %v", ErrInvalidOnlineEmbeddingProfile, err)
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil {
		return OnlineEmbeddingProfile{}, fmt.Errorf("%w: stat profile source: %v", ErrInvalidOnlineEmbeddingProfile, err)
	}
	if !stat.Mode().IsRegular() || stat.Size() <= 0 || uint64(stat.Size()) > OnlineEmbeddingProfileMaxBytes {
		return OnlineEmbeddingProfile{}, fmt.Errorf("%w: profile source must be a regular file inside the size bounds", ErrInvalidOnlineEmbeddingProfile)
	}
	payload, err := io.ReadAll(io.LimitReader(file, int64(OnlineEmbeddingProfileMaxBytes)+1))
	if err != nil {
		return OnlineEmbeddingProfile{}, fmt.Errorf("%w: read profile source: %v", ErrInvalidOnlineEmbeddingProfile, err)
	}
	return ParseOnlineEmbeddingProfile(payload)
}

// publishOnlineEmbeddingProfile stages the admitted document beside the
// destination and renames it into place. An identical existing profile is left
// untouched; a different one is moved aside under a timestamped sibling name
// and is never deleted by this call.
func publishOnlineEmbeddingProfile(ctx context.Context, modelsRoot, destination string, profile OnlineEmbeddingProfile) (changed, alreadyInstalled bool, err error) {
	base := filepath.Join(modelsRoot, OnlineEmbeddingProfileDirName)
	if err := os.MkdirAll(base, 0o700); err != nil {
		return false, false, fmt.Errorf("%w: create online profile root: %v", ErrInvalidOnlineEmbeddingProfile, err)
	}
	if existing, loadErr := LoadOnlineEmbeddingProfile(modelsRoot, profile.ProfileID); loadErr == nil {
		// An identical installed profile is a no-op; a different one is
		// replaced below with the previous tree moved aside.
		if existing.ProviderProfileDigest() == profile.ProviderProfileDigest() {
			return false, true, nil
		}
	}
	stage, err := os.MkdirTemp(base, ".restoreweave-online-profile-")
	if err != nil {
		return false, false, fmt.Errorf("%w: stage profile: %v", ErrInvalidOnlineEmbeddingProfile, err)
	}
	defer os.RemoveAll(stage)
	payload, err := json.Marshal(profile)
	if err != nil {
		return false, false, fmt.Errorf("%w: encode profile: %v", ErrInvalidOnlineEmbeddingProfile, err)
	}
	stageFile := filepath.Join(stage, OnlineEmbeddingProfileFileName)
	handle, err := os.OpenFile(stageFile, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return false, false, fmt.Errorf("%w: create staged profile: %v", ErrInvalidOnlineEmbeddingProfile, err)
	}
	if _, writeErr := handle.Write(payload); writeErr != nil {
		_ = handle.Close()
		return false, false, fmt.Errorf("%w: write staged profile: %v", ErrInvalidOnlineEmbeddingProfile, writeErr)
	}
	if syncErr := handle.Sync(); syncErr != nil {
		_ = handle.Close()
		return false, false, fmt.Errorf("%w: sync staged profile: %v", ErrInvalidOnlineEmbeddingProfile, syncErr)
	}
	if closeErr := handle.Close(); closeErr != nil {
		return false, false, fmt.Errorf("%w: close staged profile: %v", ErrInvalidOnlineEmbeddingProfile, closeErr)
	}
	if err := ctx.Err(); err != nil {
		return false, false, err
	}
	profileDir := filepath.Dir(destination)
	if _, statErr := os.Lstat(profileDir); statErr == nil {
		aside := profileDir + ".replaced-" + time.Now().UTC().Format("20060102T150405Z")
		if renameErr := os.Rename(profileDir, aside); renameErr != nil {
			return false, false, fmt.Errorf("%w: move existing profile aside: %v", ErrInvalidOnlineEmbeddingProfile, renameErr)
		}
	} else if !errors.Is(statErr, os.ErrNotExist) {
		return false, false, fmt.Errorf("%w: inspect existing profile: %v", ErrInvalidOnlineEmbeddingProfile, statErr)
	}
	if renameErr := os.Rename(stage, profileDir); renameErr != nil {
		return false, false, fmt.Errorf("%w: publish profile: %v", ErrInvalidOnlineEmbeddingProfile, renameErr)
	}
	return true, false, nil
}
