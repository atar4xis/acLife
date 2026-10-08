package routes

import (
	"net/http"
	"time"

	"acLife/handlers"

	"github.com/gorilla/mux"
)

// Stripe contains routes related to stripe.
func Stripe(r *mux.Router) {
	sr := r.PathPrefix("/stripe").Subrouter()

	sr.Use(handlers.RateLimitMiddleware(100, time.Second)) // 100 reqs/sec
	sr.Use(handlers.AuthMiddleware())                      // require login
	sr.Use(handlers.MaxBodySizeMiddleware(64 << 10))       // 64 KB
	sr.Use(handlers.CSRFMiddleware())

	// The webhook doesn't have to be logged in and doesn't require CSRF protection
	wr := r.PathPrefix("/stripe/webhook").Subrouter()
	wr.Use(handlers.MaxBodySizeMiddleware(64 << 10)) // 64 KB
	wr.HandleFunc("", handlers.StripeWebhook).Methods("POST")

	// Other routes are authenticated
	sr.HandleFunc("/pricing", handlers.Pricing).Methods("GET")
	// each of these calls Stripe, so a user gets only a few per minute
	perUser := handlers.UserRateLimitMiddleware(5, time.Minute)
	sr.Handle("/checkout", perUser(http.HandlerFunc(handlers.CreateCheckoutSession))).Methods("POST")
	sr.Handle("/manage", perUser(http.HandlerFunc(handlers.CreatePortalSession))).Methods("GET")
}
