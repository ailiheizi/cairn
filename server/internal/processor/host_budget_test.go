package processor

import (
	"testing"
	"time"
)

// TestBudgetForPrefersOverrideThenMediaThenDefaults pins the resolution order a
// capability budget follows, so a media processor can raise its own ceiling
// without a host-side list of capability names.
func TestBudgetForPrefersOverrideThenMediaThenDefaults(t *testing.T) {
	host := &Host{
		opts: Options{
			MaxSourceBytes: defaultMaxSourceBytes,
			StageTimeout:   defaultStageTimeout,
			Processors:     []Processor{&OCRImageText{}, ClipEmbedding{}},
		},
		byCap: map[string]Processor{},
	}
	for _, proc := range host.opts.Processors {
		host.byCap[proc.CapabilityID()] = proc
	}

	text := host.budgetFor(CapabilityTextExtract)
	if text.MaxSourceBytes != defaultMaxSourceBytes || text.StageTimeout != defaultStageTimeout {
		t.Fatalf("an undeclared capability must keep the host defaults, got %+v", text)
	}

	media := host.budgetFor(CapabilityOCRImageText)
	if media.MaxSourceBytes != mediaMaxSourceBytes || media.StageTimeout != mediaStageTimeout {
		t.Fatalf("a media capability must declare its own budget, got %+v", media)
	}
	if media.MaxSourceBytes <= defaultMaxSourceBytes || media.StageTimeout <= defaultStageTimeout {
		t.Fatalf("the media budget must exceed the text defaults, got %+v", media)
	}

	host.opts.CapabilityBudgets = map[string]CapabilityBudget{
		CapabilityOCRImageText: {MaxSourceBytes: 3 << 20, StageTimeout: 7 * time.Second},
	}
	override := host.budgetFor(CapabilityOCRImageText)
	if override.MaxSourceBytes != 3<<20 || override.StageTimeout != 7*time.Second {
		t.Fatalf("an explicit override must win over the declared budget, got %+v", override)
	}

	// A route's read ceiling is the largest node ceiling, and its deadline is the
	// sum of the per-node deadlines so a multi-stage route is not cut short.
	budgets := []CapabilityBudget{
		{MaxSourceBytes: defaultMaxSourceBytes, StageTimeout: defaultStageTimeout},
		{MaxSourceBytes: mediaMaxSourceBytes, StageTimeout: mediaStageTimeout},
	}
	if got := routeReadCeiling(budgets, defaultMaxSourceBytes); got != mediaMaxSourceBytes {
		t.Fatalf("route read ceiling = %d, want %d", got, mediaMaxSourceBytes)
	}
	if got := routeDeadline(budgets, defaultStageTimeout); got != defaultStageTimeout+mediaStageTimeout {
		t.Fatalf("route deadline = %s, want the sum of the node deadlines", got)
	}
}
