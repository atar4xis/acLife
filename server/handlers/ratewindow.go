package handlers

import (
	"sync"
	"time"
)

type rateWindow struct {
	mu     sync.Mutex
	epochs []int64
	counts []int
}

func newRateWindow(window time.Duration) *rateWindow {
	n := int(window / time.Minute)
	return &rateWindow{epochs: make([]int64, n), counts: make([]int, n)}
}

func (w *rateWindow) total(minute int64) int {
	sum := 0
	for i, epoch := range w.epochs {
		if epoch > minute-int64(len(w.epochs)) {
			sum += w.counts[i]
		}
	}
	return sum
}

func (w *rateWindow) add(minute int64) {
	i := minute % int64(len(w.epochs))
	if w.epochs[i] != minute {
		w.epochs[i], w.counts[i] = minute, 0
	}
	w.counts[i]++
}

func (w *rateWindow) record(now time.Time) int {
	minute := now.Unix() / 60

	w.mu.Lock()
	defer w.mu.Unlock()

	w.add(minute)
	return w.total(minute)
}

func (w *rateWindow) admit(now time.Time, limit int) bool {
	minute := now.Unix() / 60

	w.mu.Lock()
	defer w.mu.Unlock()

	if w.total(minute) >= limit {
		return false
	}
	w.add(minute)
	return true
}
