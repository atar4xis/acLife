package routes

import (
	"net/http"
	"time"

	"acLife/handlers"

	"github.com/gorilla/mux"
)

// Auth contains routes related to authentication.
func Auth(r *mux.Router) {
	sr := r.PathPrefix("/auth").Subrouter()

	sr.Use(handlers.MaxBodySizeMiddleware(16 << 10))      // 16 KB
	sr.Use(handlers.RateLimitMiddleware(30, time.Minute)) // 30 reqs/min

	sr.Handle("/register", handlers.RateLimitMiddleware(3, time.Minute)(http.HandlerFunc(handlers.Register))).Methods("POST")                     // Stricter 3 req/min for registrations
	sr.Handle("/register/challenge", handlers.RateLimitMiddleware(3, time.Minute)(http.HandlerFunc(handlers.RegisterChallenge))).Methods("POST") // Same limit as /register
	sr.HandleFunc("/login/start", handlers.LoginStart).Methods("POST")
	sr.HandleFunc("/login/verify", handlers.LoginVerify).Methods("POST")
	sr.HandleFunc("/logout", handlers.Logout).Methods("POST")
	sr.HandleFunc("/verify-email", handlers.VerifyEmail).Methods("GET")
	sr.HandleFunc("/verify-email", handlers.ConfirmEmailVerification).Methods("POST")
	sr.HandleFunc("/resend-verification", handlers.ResendVerification).Methods("POST")
}