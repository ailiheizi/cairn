package search

import (
	"context"
	"fmt"
	"strings"
)

// Hybrid local + online component provider
//
// semantic.embedding_mode=hybrid configures two independent components: the
// local pinned ONNX/BGE space (the personal default) and one online profile
// space. A vector generation is always bound to exactly one immutable space,
// so the hybrid provider routes every request to the component whose manifest
// is the request's manifest. A request for a space that neither component
// serves is refused (EGRESS_SPACE_UNBOUND); it is never served by the other
// component, by a fixture vector, or by a locally re-embedded approximation.
//
// Component health is reported per component through ComponentStatuses, and
// the existing SemanticFailure surface carries the same per-component summary
// so search.rebuild, capability, and doctor output name every degraded
// component with its stable reason.

// SemanticComponentState is the operator-facing state of one hybrid component.
const (
	SemanticComponentReady       = "READY"
	SemanticComponentUnavailable = "UNAVAILABLE"
)

// SemanticProviderComponentStatus is the honest per-component status of one
// hybrid semantic provider.
type SemanticProviderComponentStatus struct {
	Component      string `json:"component"`
	State          string `json:"state"`
	Reason         string `json:"reason,omitempty"`
	Default        bool   `json:"default"`
	Space          string `json:"space"`
	ProviderDigest string `json:"provider_digest"`
	Dimension      int    `json:"dimension"`
	Failure        string `json:"failure,omitempty"`
}

// SemanticProviderComponent is one named component of a hybrid provider.
type SemanticProviderComponent struct {
	// Name identifies the component in status output ("local", "online").
	Name string
	// Provider is the component implementation.
	Provider SemanticEmbeddingProvider
	// Manifest is the immutable space binding of this component.
	Manifest EmbeddingGenerationManifest
	// Default marks the component that serves the daemon's bound generation
	// space. Exactly one component must be the default; it is the component
	// the normal rebuild and query path uses.
	Default bool
}

// HybridSemanticProvider is the composite provider for hybrid mode.
type HybridSemanticProvider struct {
	components []SemanticProviderComponent
	defaultAt  int
}

// NewHybridSemanticProvider validates two or more components with distinct
// immutable spaces and exactly one default.
func NewHybridSemanticProvider(components ...SemanticProviderComponent) (*HybridSemanticProvider, error) {
	if len(components) < 2 {
		return nil, fmt.Errorf("hybrid embedding requires at least two components")
	}
	names := map[string]struct{}{}
	spaces := map[string]struct{}{}
	defaultAt := -1
	for position, component := range components {
		name := strings.TrimSpace(component.Name)
		if name == "" {
			return nil, fmt.Errorf("hybrid component %d has no name", position)
		}
		if _, ok := names[name]; ok {
			return nil, fmt.Errorf("hybrid component name %q is duplicated", name)
		}
		names[name] = struct{}{}
		if component.Provider == nil {
			return nil, fmt.Errorf("hybrid component %q has no provider", name)
		}
		if err := component.Manifest.Validate(); err != nil {
			return nil, fmt.Errorf("hybrid component %q manifest: %w", name, err)
		}
		// Two components with the same space would be ambiguous: which one
		// produced a vector could not be recorded.
		key := component.Manifest.CanonicalDigest()
		if _, ok := spaces[key]; ok {
			return nil, fmt.Errorf("hybrid component %q duplicates another component's embedding space", name)
		}
		spaces[key] = struct{}{}
		if component.Default {
			if defaultAt >= 0 {
				return nil, fmt.Errorf("hybrid requires exactly one default component")
			}
			defaultAt = position
		}
	}
	if defaultAt < 0 {
		return nil, fmt.Errorf("hybrid requires exactly one default component")
	}
	return &HybridSemanticProvider{components: components, defaultAt: defaultAt}, nil
}

// SemanticProviderKind identifies the hybrid family for capability reporting.
func (p *HybridSemanticProvider) SemanticProviderKind() string {
	if p == nil {
		return ""
	}
	return "hybrid"
}

// DefaultSpace returns the space of the default (bound) component.
func (p *HybridSemanticProvider) DefaultSpace() string {
	if p == nil || p.defaultAt < 0 {
		return ""
	}
	return p.components[p.defaultAt].Manifest.SemanticSpace
}

// Embed routes one request to the component whose space matches the request
// manifest and reports any refusal with its stable reason. There is no
// cross-space fallback.
func (p *HybridSemanticProvider) Embed(ctx context.Context, request SemanticEmbeddingRequest) ([]SemanticVector, error) {
	if p == nil {
		return nil, refusedEgress(EgressReasonSpaceUnbound, "hybrid", "hybrid provider is not configured")
	}
	digest := request.Manifest.CanonicalDigest()
	for _, component := range p.components {
		if component.Manifest.CanonicalDigest() == digest {
			return component.Provider.Embed(ctx, request)
		}
	}
	return nil, refusedEgress(EgressReasonSpaceUnbound, "hybrid",
		"the request manifest matches no configured hybrid embedding component; no fallback across spaces is admitted")
}

// SemanticReady reports whether the default (bound) component can embed.
func (p *HybridSemanticProvider) SemanticReady() bool {
	if p == nil || p.defaultAt < 0 {
		return false
	}
	return semanticProviderReady(p.components[p.defaultAt].Provider)
}

// SemanticFailure returns a per-component summary; it is empty only when
// every component is ready.
func (p *HybridSemanticProvider) SemanticFailure() string {
	if p == nil {
		return ""
	}
	parts := make([]string, 0, len(p.components))
	degraded := false
	for _, status := range p.ComponentStatuses() {
		if status.State == SemanticComponentReady {
			parts = append(parts, status.Component+"="+SemanticComponentReady)
			continue
		}
		degraded = true
		detail := firstNonEmpty(status.Reason, status.Failure, SemanticIndexUnavailableReason)
		parts = append(parts, status.Component+"="+SemanticComponentUnavailable+"("+detail+")")
	}
	if !degraded {
		return ""
	}
	return strings.Join(parts, " ")
}

// SemanticFailureReason returns the default component's stable reason code,
// when it has one.
func (p *HybridSemanticProvider) SemanticFailureReason() SemanticEgressReason {
	if p == nil || p.defaultAt < 0 {
		return ""
	}
	if health, ok := p.components[p.defaultAt].Provider.(interface {
		SemanticFailureReason() SemanticEgressReason
	}); ok {
		return health.SemanticFailureReason()
	}
	return ""
}

// ComponentStatuses reports every component's state independently. A degraded
// online component never makes the local default look degraded, and vice
// versa.
func (p *HybridSemanticProvider) ComponentStatuses() []SemanticProviderComponentStatus {
	if p == nil {
		return nil
	}
	statuses := make([]SemanticProviderComponentStatus, 0, len(p.components))
	for position, component := range p.components {
		status := SemanticProviderComponentStatus{
			Component:      component.Name,
			State:          SemanticComponentReady,
			Default:        position == p.defaultAt,
			Space:          component.Manifest.SemanticSpace,
			ProviderDigest: component.Manifest.ProviderDigest,
			Dimension:      component.Manifest.Dimension,
		}
		failure := ""
		if health, ok := component.Provider.(interface{ SemanticFailure() string }); ok {
			failure = strings.TrimSpace(health.SemanticFailure())
		}
		reason := ""
		if health, ok := component.Provider.(interface {
			SemanticFailureReason() SemanticEgressReason
		}); ok {
			reason = string(health.SemanticFailureReason())
		}
		if !semanticProviderReady(component.Provider) || failure != "" || reason != "" {
			status.State = SemanticComponentUnavailable
			status.Failure = failure
			status.Reason = reason
		}
		statuses = append(statuses, status)
	}
	return statuses
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

// semanticProviderReady asks a provider whether it is currently able to
// embed. A provider without the optional health method is assumed ready: the
// embedding call still fails closed.
func semanticProviderReady(provider SemanticEmbeddingProvider) bool {
	if provider == nil {
		return false
	}
	if health, ok := provider.(interface{ SemanticReady() bool }); ok {
		return health.SemanticReady()
	}
	return true
}
