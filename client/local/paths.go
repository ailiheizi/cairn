package local

import (
	"os"
	"path/filepath"
)

const SocketEnv = "CAIRN_SOCKET"

func DefaultSocketPath() string {
	if value := os.Getenv(SocketEnv); value != "" {
		return value
	}
	if runtimeDir := os.Getenv("XDG_RUNTIME_DIR"); runtimeDir != "" {
		return filepath.Join(runtimeDir, "cairn", "cairnd.sock")
	}
	return filepath.Join(os.TempDir(), "cairn", "cairnd.sock")
}

func DefaultCatalogPath() string {
	if value := os.Getenv("CAIRN_CATALOG"); value != "" {
		return value
	}
	if dataHome := os.Getenv("XDG_DATA_HOME"); dataHome != "" {
		return filepath.Join(dataHome, "cairn", "catalog.sqlite")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(os.TempDir(), "cairn", "catalog.sqlite")
	}
	return filepath.Join(home, ".local", "share", "cairn", "catalog.sqlite")
}

func DefaultRepositoryPath() string {
	if value := os.Getenv("CAIRN_REPOSITORY"); value != "" {
		return value
	}
	if dataHome := os.Getenv("XDG_DATA_HOME"); dataHome != "" {
		return filepath.Join(dataHome, "cairn", "repository")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(os.TempDir(), "cairn", "repository")
	}
	return filepath.Join(home, ".local", "share", "cairn", "repository")
}
