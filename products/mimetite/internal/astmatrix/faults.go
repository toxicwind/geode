package astmatrix

// faults.go — Go port of the router/src/faults classification contract.
//
// The TS side classifies upstream responses through a Lua worker (7 modules,
// priority-ordered). This file mirrors that contract in Go so the astmatrix
// router applies the same fault taxonomy without a Lua dependency:
//
//	opencode-429-free-tier-timer (pri 5)  → trip model, timer duration
//	ua-blocked                  (pri 9)  → trip provider, 5m
//	auth-failed                 (pri 10) → trip provider, 30m
//	not-found                   (pri 10) → trip model, 1h
//	gone                        (pri 10) → trip model, forever
//	concurrency-shed            (pri 20) → shed (wait + resend)
//	quota-exhausted             (pri 30) → quota (honor wait once)
//
// Lower priority runs first; ties break by name. The internal routing outcomes
// (circuit_open, no_providers, *_exhausted, …) are also centralized here as
// typed reasons so router.go stops scattering magic strings.

import (
	"os"
	"regexp"
	"strconv"
	"strings"
)

// FaultAction mirrors the TS BreakerAction.
type FaultAction string

const (
	FaultShed  FaultAction = "shed"
	FaultQuota FaultAction = "quota"
	FaultTrip  FaultAction = "trip"
	FaultNone  FaultAction = "none"
)

// FaultPolicy mirrors the TS BreakerPolicy.
type FaultPolicy struct {
	Action       FaultAction
	RetryAfterMs int64
	Scope        string // "provider" | "model"
	Reason       string
}

// FaultResult mirrors the TS BreakerClassifyResult.
type FaultResult struct {
	Matched string
	Policy  *FaultPolicy
}

// retryableSaturation is the shared gate from the TS concurrency/quota modules:
// 429|503|409, or >=500 with a saturation keyword in the body.
func retryableSaturation(status int, body string) bool {
	if status == 429 || status == 503 || status == 409 {
		return true
	}
	if status >= 500 {
		b := strings.ToLower(body)
		for _, kw := range []string{"concurrency", "too many", "rate.limit", "busy", "overload", "temporarily"} {
			if strings.Contains(b, kw) {
				return true
			}
		}
	}
	return false
}

var (
	uaError1010Re = regexp.MustCompile(`error[\s_-]?1010`)
)

// classify mirrors the Lua worker: classify an upstream response (status +
// body) into a fault policy. Returns a zero FaultResult when no module owns
// the response (caller falls back to generic retryable handling).
func Classify(status int, body string) FaultResult {
	b := strings.ToLower(body)

	// opencode-429-free-tier-timer (pri 5) — before the generic buckets.
	if status == 429 {
		if strings.Contains(b, "freeusagelimiterror") ||
			strings.Contains(b, "free usage limit reached") ||
			(strings.Contains(b, "free") && strings.Contains(b, "opencode") && strings.Contains(b, "limit")) {
			timer := int64(3600000) // default 1h
			if v := os.Getenv("OPENCODE_FREE_TIER_TIMER_MS"); v != "" {
				if n, err := strconv.ParseInt(v, 10, 64); err == nil {
					timer = n
				}
			}
			return FaultResult{
				Matched: "opencode-429-free-tier-timer",
				Policy:  &FaultPolicy{Action: FaultTrip, Scope: "model", RetryAfterMs: timer, Reason: "opencode free-tier timer: model locked until reset"},
			}
		}
	}

	// ua-blocked (pri 9) — must run before auth-failed (both see 403).
	if status == 403 {
		if uaError1010Re.MatchString(b) ||
			strings.Contains(b, "browser signature") ||
			strings.Contains(b, "cloudflare-1xxx-errors") ||
			strings.Contains(b, "cf-error-details") {
			return FaultResult{
				Matched: "ua-blocked",
				Policy:  &FaultPolicy{Action: FaultTrip, Scope: "provider", RetryAfterMs: 300000, Reason: "ua_blocked: egress IP reputation"},
			}
		}
	}

	// auth-failed (pri 10).
	if status == 401 || status == 403 {
		return FaultResult{
			Matched: "auth-failed",
			Policy:  &FaultPolicy{Action: FaultTrip, Scope: "provider", RetryAfterMs: 1800000, Reason: "auth failed (401/403)"},
		}
	}

	// not-found (pri 10).
	if status == 404 {
		return FaultResult{
			Matched: "not-found",
			Policy:  &FaultPolicy{Action: FaultTrip, Scope: "model", RetryAfterMs: 3600000, Reason: "404 Not Found: model/route gone"},
		}
	}

	// gone (pri 10).
	if status == 410 {
		return FaultResult{
			Matched: "gone",
			Policy:  &FaultPolicy{Action: FaultTrip, Scope: "model", RetryAfterMs: 9007199254740991, Reason: "410 Gone: model permanently removed"},
		}
	}

	// concurrency-shed (pri 20).
	if retryableSaturation(status, body) {
		if strings.Contains(b, "concurrent") ||
			strings.Contains(b, "concurrency_limit") ||
			strings.Contains(b, "slot") {
			return FaultResult{
				Matched: "concurrency-shed",
				Policy:  &FaultPolicy{Action: FaultShed, Reason: "concurrency shed: slots full, wait+resend then diversify"},
			}
		}
	}

	// quota-exhausted (pri 30).
	if retryableSaturation(status, body) {
		for _, kw := range []string{"quota", "budget", "daily cost", "exhausted", "spend cap", "rate.limit", "exceeded"} {
			if strings.Contains(b, kw) {
				return FaultResult{
					Matched: "quota-exhausted",
					Policy:  &FaultPolicy{Action: FaultQuota, Reason: "quota/budget exhausted: honor wait once, then diversify"},
				}
			}
		}
	}

	return FaultResult{}
}

// Internal routing fault reasons. These are NOT upstream classifications —
// they are outcomes of the router's own strategy logic, centralized here so
// router.go stops scattering magic strings.
const (
	FaultCircuitOpen            = "circuit_open"
	FaultRateLimitedByRouter    = "rate_limited_by_router"
	FaultUnknownProvider        = "unknown_provider"
	FaultMarshalError           = "marshal_error"
	FaultRequestError           = "request_error"
	FaultReadError              = "read_error"
	FaultNoProviders            = "no_providers"
	FaultAstRaceExhausted       = "ast_race_exhausted"
	FaultExplicitProviderUnavail = "explicit_provider_unavailable"
	FaultCircuitChainExhausted  = "circuit_chain_exhausted"
	FaultFifoFull               = "fifo_full"
	FaultNoFreeProviders        = "no_free_providers"
	FaultExhausted              = "_exhausted"
)
