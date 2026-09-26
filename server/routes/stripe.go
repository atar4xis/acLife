package routes

import (
	"time"

	"acLife/handlers"

	"github.com/gorilla/mux"
)

// Stripe contains routes related to stripe.
func Stripe(r *mux.Router) {
	sr := r.PathPrefix("/stripe").Subrouter()

	sr.Use(handlers.AuthMiddleware())                      // require login
	sr.Use(handlers.MaxBodySizeMiddleware(64 << 10))       // 64 KB
	sr.Use(handlers.RateLimitMiddleware(100, time.Second)) // 100 reqs/sec
	sr.Use(handlers.CSRFMiddleware())

	// The webhook doesn't have to be logged in and doesn't require CSRF protection
	r.HandleFunc("/stripe/webhook", handlers.StripeWebhook).Methods("POST")

	// Other routes are authenticated
	sr.HandleFunc("/pricing", handlers.Pricing).Methods("GET")
	sr.HandleFunc("/checkout", handlers.CreateCheckoutSession).Methods("POST")
	sr.HandleFunc("/manage", handlers.CreatePortalSession).Methods("GET")
}
