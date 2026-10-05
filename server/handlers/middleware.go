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
	"acLife/stream"
	"acLife/types"
	"acLife/utils"

	"github.com/gorilla/mux"
)

type rateLimitEntry struct {
	timestamps []time.Time
	mu         sync.Mutex
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
					Code:    "too_many_requests",
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
					Code:    "not_logged_in",
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
					stream.CloseSession(accessToken)
				}
				_ = session.DestroySession(w, r)

				utils.SendJSON(w, http.StatusForbidden, types.Reply[types.EmailUnverifiedData]{
					Success: false,
					Message: "Email verification required.",
					Code:    "email_verification_required",
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

			if user.SubscriptionStatus == nil ||
				(*user.SubscriptionStatus != "active" && *user.SubscriptionStatus != "trialing") {
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
					Code:    "missing_origin",
				})
				return
			}

			if _, allowed := originMap[origin]; !allowed {
				utils.SendJSON(w, http.StatusForbidden, types.Reply[any]{
					Success: false,
					Message: "Invalid Origin.",
					Code:    "invalid_origin",
				})
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

/* -------------------- Helpers -------------------- */

func denySubscription(w http.ResponseWriter) {
	utils.SendJSON(w, http.StatusPaymentRequired, types.Reply[any]{
		Success: false,
		Message: "Invalid subscription.",
		Code:    "invalid_subscription",
	})
}

func getClientIP(r *http.Request) string {
	if os.Getenv("IS_BEHIND_PROXY") != "" {
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
