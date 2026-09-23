package poller

import (
	"context"
	"errors"
	"math"
	"sync"
	"time"
)

// IPMLimiter provides token-bucket rate limiting for cloud provider API calls,
// specifically enforcing Images Per Minute (IPM) quotas and handling Seedream 5.0 Pro
// layer decomposition pre-deduction (17 IPM) and post-generation refunds.
type IPMLimiter struct {
	mu             sync.Mutex
	capacity       float64
	tokens         float64
	refillRate     float64 // tokens per second
	lastRefillTime time.Time
}

// NewIPMLimiter creates a new IPMLimiter with max capacity and IPM rate.
// For example, ipm=60 means 60 tokens per minute (1 token/sec).
func NewIPMLimiter(capacity float64, ipm float64) *IPMLimiter {
	if capacity <= 0 {
		capacity = 60
	}
	if ipm <= 0 {
		ipm = 60
	}
	refillRate := ipm / 60.0

	return &IPMLimiter{
		capacity:       capacity,
		tokens:         capacity,
		refillRate:     refillRate,
		lastRefillTime: time.Now(),
	}
}

// refill updates the available tokens based on elapsed time. Must be called with mu locked.
func (l *IPMLimiter) refill() {
	now := time.Now()
	elapsed := now.Sub(l.lastRefillTime).Seconds()
	if elapsed > 0 {
		l.tokens = math.Min(l.capacity, l.tokens+elapsed*l.refillRate)
		l.lastRefillTime = now
	}
}

// AvailableTokens returns current available token count.
func (l *IPMLimiter) AvailableTokens() float64 {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.refill()
	return l.tokens
}

// Acquire attempts to immediately consume tokens without blocking.
func (l *IPMLimiter) Acquire(tokens float64) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	l.refill()
	if l.tokens >= tokens {
		l.tokens -= tokens
		return true
	}
	return false
}

// Wait blocks until the required tokens are available or context is cancelled.
func (l *IPMLimiter) Wait(ctx context.Context, tokens float64) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		l.mu.Lock()
		l.refill()
		if l.tokens >= tokens {
			l.tokens -= tokens
			l.mu.Unlock()
			return nil
		}

		// Calculate sleep time needed to accrue missing tokens
		missing := tokens - l.tokens
		sleepSec := missing / l.refillRate
		l.mu.Unlock()

		if sleepSec > 1.0 {
			sleepSec = 1.0
		}
		sleepDuration := time.Duration(sleepSec * float64(time.Second))
		if sleepDuration < 10*time.Millisecond {
			sleepDuration = 10 * time.Millisecond
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(sleepDuration):
		}
	}
}

// PreDeductLayerDecomposition pre-deducts 17 IPM tokens for Seedream 5.0 Pro layer decomposition.
func (l *IPMLimiter) PreDeductLayerDecomposition(ctx context.Context) error {
	return l.Wait(ctx, 17)
}

// Refund returns tokens back to the bucket (capped at capacity).
func (l *IPMLimiter) Refund(tokens float64) {
	if tokens <= 0 {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()

	l.refill()
	l.tokens = math.Min(l.capacity, l.tokens+tokens)
}

// RefundLayerDecomposition computes and returns unused tokens when layer decomposition finishes.
// 17 tokens were pre-deducted. Actual consumed = 1 (base image) + actualLayersCount.
// Refund amount = 17 - (1 + actualLayersCount).
func (l *IPMLimiter) RefundLayerDecomposition(actualLayersCount int) {
	if actualLayersCount < 0 {
		actualLayersCount = 0
	}
	consumed := 1 + actualLayersCount
	if consumed < 17 {
		refundTokens := float64(17 - consumed)
		l.Refund(refundTokens)
	}
}

// FullRefundLayerDecomposition refunds all 17 pre-deducted tokens if task fails or cancels.
func (l *IPMLimiter) FullRefundLayerDecomposition() {
	l.Refund(17)
}

var ErrLimiterTimeout = errors.New("rate limiter timeout waiting for tokens")
