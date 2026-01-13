package handlers

import (
	"context"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"acLife/constants"
	"acLife/database"
	"acLife/session"
	"acLife/types"
	"acLife/utils"

	"github.com/gorilla/mux"
)

var (
	isBehindProxy = os.Getenv("IS_BEHIND_PROXY") != ""

	rateLimitStore = sync.Map{} // map[string]*rateLimitEntry
	subCache       = sync.Map{} // map[string]subCacheEntry
)

type rateLimitEntry struct {
	timestamps []time.Time
	mu         sync.Mutex
}

type subCacheEntry struct {
	status    string
	expiresAt time.Time
}

func init() {
	go cleanupRateLimits(constants.RateLimitCacheTTL)
	go cleanupSubCache(constants.SubCacheTTL)
}

/* -------------------- Cleanup -------------------- */

func cleanupRateLimits(ttl time.Duration) {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		now := time.Now()

		rateLimitStore.Range(func(key, value any) bool {
			entry := value.(*rateLimitEntry)

			entry.mu.Lock()
			filtered := make([]time.Time, 0, len(entry.timestamps))
			for _, ts := range entry.timestamps {
				if now.Sub(ts) <= ttl {
					filtered = append(filtered, ts)
				}
			}
			entry.timestamps = filtered
			empty := len(filtered) == 0
			entry.mu.Unlock()

			if empty {
				rateLimitStore.Delete(key)
			}
			return true
		})
	}
}

func cleanupSubCache(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for range ticker.C {
		now := time.Now()
		subCache.Range(func(key, value any) bool {
			entry := value.(subCacheEntry)
			if now.After(entry.expiresAt) {
				subCache.Delete(key)
			}
			return true
		})
	}
}

/* -------------------- Middleware -------------------- */

// MaxBodySizeMiddleware restricts the size of the request body to a specified amount.
func MaxBodySizeMiddleware(limit int64) mux.MiddlewareFunc {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			r.Body = http.MaxBytesReader(w, r.Body, limit)
			next.ServeHTTP(w, r)
		})
	}
}

// BodyCloseMiddleware closes the request Body handle at the end of the request.
func BodyCloseMiddleware() mux.MiddlewareFunc {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() { _ = r.Body.Close() }()
			next.ServeHTTP(w, r)
		})
	}
}

// RateLimitMiddleware limits the number of requests made by the user in a specified period of time.
func RateLimitMiddleware(maxRequests int, window time.Duration) mux.MiddlewareFunc {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := getClientIP(r)
			now := time.Now()

			val, _ := rateLimitStore.LoadOrStore(ip, &rateLimitEntry{})
			entry := val.(*rateLimitEntry)

			entry.mu.Lock()
			filtered := make([]time.Time, 0, len(entry.timestamps))
			for _, ts := range entry.timestamps {
				if now.Sub(ts) <= window {
					filtered = append(filtered, ts)
				}
			}

			if len(filtered) >= maxRequests {
				entry.timestamps = filtered
				entry.mu.Unlock()

				utils.SendJSON(w, http.StatusTooManyRequests, types.Reply[any]{
					Success: false,
					Message: "Too many requests.",
				})
				return
			}

			entry.timestamps = append(filtered, now)
			entry.mu.Unlock()

			next.ServeHTTP(w, r)
		})
	}
}

// AuthMiddleware requires the user to be logged in at the time of the request.
func AuthMiddleware() mux.MiddlewareFunc {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user := session.GetLoggedInUser(r)
			if user == nil {
				utils.SendJSON(w, http.StatusUnauthorized, types.Reply[any]{
					Success: false,
					Message: "You are not logged in.",
				})
				return
			}

			ctx := context.WithValue(r.Context(), session.UserContextKey, user)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// SubscriptionMiddleware enforces a valid subscription at the time of the request.
func SubscriptionMiddleware() mux.MiddlewareFunc {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !constants.Metadata.Registration.SubscriptionRequired {
				next.ServeHTTP(w, r)
				return
			}

			user := session.GetLoggedInUser(r)
			utils.Assert(user != nil) // should be ensured by AuthMiddleware

			if user.StripeSubscriptionID == nil || *user.StripeSubscriptionID == "" {
				denySubscription(w)
				return
			}

			subID := *user.StripeSubscriptionID

			status, ok := getSubStatus(subID)
			if !ok {
				if err := database.UpdateSubscriptionStatus(subID); err != nil {
					utils.LogError("SubscriptionMiddleware", "UpdateSubscriptionStatus", err)
					utils.SendInternalError(w)
					return
				}

				user = session.GetLoggedInUser(r, true) // force refetch
				utils.Assert(user != nil)

				if user.SubscriptionStatus == nil {
					denySubscription(w)
					return
				}

				status = *user.SubscriptionStatus
				setSubStatus(subID, status)
			}

			if status != "active" {
				denySubscription(w)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// TimeoutMiddleware sets a timeout for the request.
func TimeoutMiddleware(d time.Duration) mux.MiddlewareFunc {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithTimeout(r.Context(), d)
			defer cancel()

			done := make(chan struct{})
			go func() {
				next.ServeHTTP(w, r.WithContext(ctx))
				close(done)
			}()

			select {
			case <-done:
				return
			case <-ctx.Done():
				if ctx.Err() == context.DeadlineExceeded {
					Timeout(w, r)
				}
			}
		})
	}
}

/* -------------------- Helpers -------------------- */

func getSubStatus(subID string) (string, bool) {
	val, ok := subCache.Load(subID)
	if !ok {
		return "", false
	}

	entry := val.(subCacheEntry)
	if time.Now().After(entry.expiresAt) {
		subCache.Delete(subID)
		return "", false
	}

	return entry.status, true
}

func setSubStatus(subID, status string) {
	subCache.Store(subID, subCacheEntry{
		status:    status,
		expiresAt: time.Now().Add(constants.SubCacheTTL),
	})
}

func denySubscription(w http.ResponseWriter) {
	utils.SendJSON(w, http.StatusPaymentRequired, types.Reply[any]{
		Success: false,
		Message: "Invalid subscription.",
	})
}

func getClientIP(r *http.Request) string {
	if isBehindProxy {
		ip := strings.TrimSpace(r.Header.Get("X-Real-IP"))
		if ip != "" && net.ParseIP(ip) != nil {
			return ip
		}
	}

	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
