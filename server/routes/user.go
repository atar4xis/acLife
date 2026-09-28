package routes

import (
	"os"
	"time"

	"acLife/handlers"

	"github.com/gorilla/mux"
)

// User contains routes related to user accounts.
func User(r *mux.Router) {
	sr := r.PathPrefix("/user").Subrouter()

	sr.Use(handlers.AuthMiddleware())                    // must be logged in
	sr.Use(handlers.MaxBodySizeMiddleware(8 << 10))      // 8 KB
	sr.Use(handlers.RateLimitMiddleware(5, time.Second)) // 5 reqs/sec

	sr.HandleFunc("", handlers.UserInfo).Methods("GET")
	sr.HandleFunc("/challenge", handlers.UpdateChallenge).Methods("POST")
	sr.HandleFunc("/email", handlers.UpdateEmail).Methods("POST")
	sr.HandleFunc("/password", handlers.UpdatePassword).Methods("POST")
	sr.HandleFunc("/envelopes", handlers.SaveEnvelopes).Methods("POST")
	sr.HandleFunc("/sessions", handlers.ListSessions).Methods("GET")
	sr.HandleFunc("/sessions/{id}", handlers.RevokeSession).Methods("DELETE")
	sr.HandleFunc("/push/subscribe", handlers.PushSubscribe).Methods("POST")

	if os.Getenv("ENV") != "production" {
		sr.HandleFunc("/push/test", handlers.PushTest).Methods("GET")
	}
}
