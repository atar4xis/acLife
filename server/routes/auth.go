package routes

import (
	"time"

	"acLife/handlers"

	"github.com/gorilla/mux"
)

// Auth contains routes related to authentication.
func Auth(r *mux.Router) {
	sr := r.PathPrefix("/auth").Subrouter()

	sr.Use(handlers.MaxBodySizeMiddleware(16 << 10))      // 16 KB
	sr.Use(handlers.RateLimitMiddleware(30, time.Minute)) // 30 reqs/min

	sr.HandleFunc("/register", handlers.Register).Methods("POST")
	sr.HandleFunc("/login/start", handlers.LoginStart).Methods("POST")
	sr.HandleFunc("/login/verify", handlers.LoginVerify).Methods("POST")
	sr.HandleFunc("/logout", handlers.Logout).Methods("POST")
}
