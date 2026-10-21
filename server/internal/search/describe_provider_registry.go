package search

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// InstalledOnlineDescribeProfile is one validated DESCRIBE_SUBJECT profile
// read from the daemon's configured models root. The destination is a host
// path and no credential is resolved by listing.
type InstalledOnlineDescribeProfile struct {
	Profile     OnlineDescribeProfile
	Destination string
	Expired     bool
}

// ListOnlineDescribeProfiles lists validated describe profiles from their
// fixed directory under the configured models root. A missing directory is an
// empty list; malformed or unreadable entries fail the listing rather than
// being silently omitted. Profile loading uses the same strict parser and
// no-follow file open as the configured-provider path, without resolving a
// credential or making a network request.
func ListOnlineDescribeProfiles(modelsRoot string) ([]InstalledOnlineDescribeProfile, error) {
	root, err := canonicalSemanticBundleInstallRoot(modelsRoot)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidOnlineDescribeProfile, err)
	}
	base := filepath.Join(root, OnlineDescribeProfileDirName)
	info, err := os.Lstat(base)
	if errors.Is(err, os.ErrNotExist) {
		return []InstalledOnlineDescribeProfile{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("%w: inspect %s: %v", ErrInvalidOnlineDescribeProfile, base, err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return nil, fmt.Errorf("%w: %s must be a real directory", ErrInvalidOnlineDescribeProfile, base)
	}
	entries, err := os.ReadDir(base)
	if err != nil {
		return nil, fmt.Errorf("%w: read %s: %v", ErrInvalidOnlineDescribeProfile, base, err)
	}
	profiles := make([]InstalledOnlineDescribeProfile, 0, len(entries))
	now := time.Now().UTC()
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		if !entry.IsDir() {
			return nil, fmt.Errorf("%w: %s is not a profile directory", ErrInvalidOnlineDescribeProfile, entry.Name())
		}
		profile, loadErr := LoadOnlineDescribeProfile(root, entry.Name())
		if loadErr != nil {
			return nil, loadErr
		}
		destination, pathErr := OnlineDescribeProfilePath(root, entry.Name())
		if pathErr != nil {
			return nil, pathErr
		}
		profiles = append(profiles, InstalledOnlineDescribeProfile{
			Profile: profile, Destination: destination, Expired: profile.Egress.Expired(now),
		})
	}
	sort.Slice(profiles, func(i, j int) bool {
		return profiles[i].Profile.ProfileID < profiles[j].Profile.ProfileID
	})
	return profiles, nil
}
