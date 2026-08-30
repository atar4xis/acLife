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

	subCache = sync.Map{} // map[string]subCacheEntry
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
	go cleanupSubCache(constants.SubCacheTTL)
}

/* -------------------- Cleanup -------------------- */

// cleanupRateLimits periodically evicts stale entries from a rate limiter's own store.
func cleanupRateLimits(store *sync.Map, ttl time.Duration) {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		now := time.Now()

		store.Range(func(key, value any) bool {
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
				store.Delete(key)
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
// Each call gets its own isolated store, so independently configured limiters never share state.
func RateLimitMiddleware(maxRequests int, window time.Duration) mux.MiddlewareFunc {
	store := &sync.Map{} // map[string]*rateLimitEntry

	go cleanupRateLimits(store, constants.RateLimitCacheTTL)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := getClientIP(r)
			now := time.Now()

			val, _ := store.LoadOrStore(ip, &rateLimitEntry{})
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

			// Log out sessions that predate the account's email verification
			if constants.Metadata.Registration.Email.VerificationRequired && !user.EmailVerified {
				accessToken := session.Get[string](r, "access_token")
				if accessToken != "" {
					_, _ = database.Exec(r.Context(),
						"DELETE FROM account_sessions WHERE access_token = ?",
						accessToken)
				}
				_ = session.DestroySession(w, r)

				utils.SendJSON(w, http.StatusForbidden, types.Reply[types.EmailUnverifiedData]{
					Success: false,
					Message: "Email verification required.",
					Data: types.EmailUnverifiedData{
						Email:                user.Email,
						RequiresVerification: true,
					},
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
				newStatus, err := database.UpdateSubscriptionStatus(subID)
				if err != nil {
					utils.LogError("SubscriptionMiddleware", "UpdateSubscriptionStatus", err)
					utils.SendInternalError(w)
					return
				}

				user.SubscriptionStatus = &newStatus

				if *user.SubscriptionStatus == "" {
					denySubscription(w)
					return
				}

				status = *user.SubscriptionStatus
				setSubStatus(subID, status)
			}

			if status != "active" && status != "trialing" {
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
		return http.TimeoutHandler(
			next,
			d,
			"request timed out",
		)
	}
}

// CSRFMiddleware rejects requests that don't originate from a trusted client.
func CSRFMiddleware() mux.MiddlewareFunc {
	allowedOrigins := utils.GetAllowedOrigins()

	originMap := make(map[string]struct{}, len(allowedOrigins))
	for _, origin := range allowedOrigins {
		originMap[origin] = struct{}{}
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Allow GET, HEAD, and OPTIONS requests without Origin header
			if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
				next.ServeHTTP(w, r)
				return
			}

			origin := r.Header.Get("Origin")

			if origin == "" {
				utils.SendJSON(w, http.StatusForbidden, types.Reply[any]{
					Success: false,
					Message: "Missing Origin.",
				})
				return
			}

			if _, allowed := originMap[origin]; !allowed {
				utils.SendJSON(w, http.StatusForbidden, types.Reply[any]{
					Success: false,
					Message: "Invalid Origin.",
				})
				return
			}

			next.ServeHTTP(w, r)
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
