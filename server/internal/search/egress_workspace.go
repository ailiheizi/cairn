package search

import "context"

type egressWorkspaceContextKey struct{}

// WithEgressWorkspaceID scopes catalog-backed egress lookups and receipts to
// the workspace named by a host-authorized typed operation. It carries no
// authorization by itself; the host must first resolve and validate the ID.
func WithEgressWorkspaceID(ctx context.Context, workspaceID string) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, egressWorkspaceContextKey{}, workspaceID)
}

func EgressWorkspaceID(ctx context.Context) (string, bool) {
	if ctx == nil {
		return "", false
	}
	value, ok := ctx.Value(egressWorkspaceContextKey{}).(string)
	return value, ok && value != ""
}
