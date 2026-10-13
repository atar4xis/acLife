package routes

import (
	"net/http"
	"time"

	"acLife/constants"
	"acLife/handlers"

	"github.com/gorilla/mux"
)

// Auth contains routes related to authentication.
func Auth(r *mux.Router) {
	sr := r.PathPrefix("/auth").Subrouter()

	sr.Use(handlers.MaxBodySizeMiddleware(16 << 10)) // 16 KB
	sr.Use(handlers.RateLimitMiddleware(constants.RateLimitAuth, time.Minute))

	sr.Handle("/register", handlers.RateLimitMiddleware(constants.RateLimitRegister, time.Minute)(http.HandlerFunc(handlers.Register))).Methods("POST")                    // stricter limit for registrations
	sr.Handle("/register/challenge", handlers.RateLimitMiddleware(constants.RateLimitRegister, time.Minute)(http.HandlerFunc(handlers.RegisterChallenge))).Methods("POST") // same limit as /register
	sr.Handle("/register/start", handlers.RateLimitMiddleware(constants.RateLimitRegister, time.Minute)(http.HandlerFunc(handlers.RegisterStart))).Methods("POST")
	sr.Handle("/register/complete", handlers.RateLimitMiddleware(constants.RateLimitRegister, time.Minute)(http.HandlerFunc(handlers.RegisterComplete))).Methods("POST")
	sr.HandleFunc("/login/start", handlers.LoginStart).Methods("POST")
	sr.HandleFunc("/login/verify", handlers.LoginVerify).Methods("POST")
	sr.HandleFunc("/logout", handlers.Logout).Methods("POST")
	sr.HandleFunc("/verify-email", handlers.VerifyEmail).Methods("GET")
	sr.HandleFunc("/verify-email", handlers.ConfirmEmailVerification).Methods("POST")
	sr.HandleFunc("/resend-verification", handlers.ResendVerification).Methods("POST")
}
