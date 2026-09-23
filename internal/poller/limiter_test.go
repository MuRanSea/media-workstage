package poller

import (
	"context"
	"sync"
	"testing"
	"time"
)

func TestIPMLimiter_AcquireAndRefill(t *testing.T) {
	// 60 capacity, 60 IPM -> 1 token/sec
	limiter := NewIPMLimiter(60, 60)

	if !limiter.Acquire(30) {
		t.Fatal("expected acquire 30 tokens to succeed")
	}

	avail := limiter.AvailableTokens()
	if avail < 29.5 || avail > 30.5 {
		t.Fatalf("expected around 30 available tokens, got %f", avail)
	}

	if !limiter.Acquire(30) {
		t.Fatal("expected acquire remaining 30 tokens to succeed")
	}

	// Should now be exhausted
	if limiter.Acquire(5) {
		t.Fatal("expected acquire 5 tokens to fail when empty")
	}

	// Refund 10 tokens
	limiter.Refund(10)
	avail = limiter.AvailableTokens()
	if avail < 9.5 || avail > 10.5 {
		t.Fatalf("expected around 10 tokens after refund, got %f", avail)
	}
}

func TestIPMLimiter_LayerDecompositionDeductionAndRefund(t *testing.T) {
	limiter := NewIPMLimiter(60, 60)
	ctx := context.Background()

	// Pre-deduct 17 tokens
	if err := limiter.PreDeductLayerDecomposition(ctx); err != nil {
		t.Fatalf("pre-deduct failed: %v", err)
	}

	avail := limiter.AvailableTokens()
	if avail < 42.5 || avail > 43.5 {
		t.Fatalf("expected ~43 tokens remaining (60 - 17), got %f", avail)
	}

	// Case 1: Produced 1 base + 4 layers = 5 consumed. Refund 17 - 5 = 12 tokens.
	limiter.RefundLayerDecomposition(4)
	avail = limiter.AvailableTokens()
	// Should now be ~43 + 12 = 55
	if avail < 54.5 || avail > 55.5 {
		t.Fatalf("expected ~55 tokens after partial refund (4 layers), got %f", avail)
	}

	// Case 2: Failed task -> full refund 17 tokens
	limiter2 := NewIPMLimiter(20, 60)
	_ = limiter2.PreDeductLayerDecomposition(ctx) // 20 - 17 = 3 left
	limiter2.FullRefundLayerDecomposition()       // refunds 17 -> back to 20
	avail2 := limiter2.AvailableTokens()
	if avail2 < 19.5 || avail2 > 20.0 {
		t.Fatalf("expected ~20 tokens after full refund, got %f", avail2)
	}
}

func TestIPMLimiter_WaitContextCancellation(t *testing.T) {
	limiter := NewIPMLimiter(5, 60)
	_ = limiter.Acquire(5) // Exhaust all tokens

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	err := limiter.Wait(ctx, 10)
	if err == nil || err != context.DeadlineExceeded {
		t.Fatalf("expected deadline exceeded, got: %v", err)
	}
}

func TestIPMLimiter_ConcurrentSafety(t *testing.T) {
	limiter := NewIPMLimiter(1000, 6000)
	var wg sync.WaitGroup

	for range 50 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range 10 {
				if limiter.Acquire(1) {
					limiter.Refund(0.5)
				}
			}
		}()
	}

	wg.Wait()
	avail := limiter.AvailableTokens()
	if avail <= 0 || avail > 1000 {
		t.Fatalf("unexpected available tokens after concurrent execution: %f", avail)
	}
}
