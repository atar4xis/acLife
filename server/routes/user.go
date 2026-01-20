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
	sr.Use(handlers.MaxBodySizeMiddleware(1 << 10))      // 1 KB
	sr.Use(handlers.RateLimitMiddleware(5, time.Second)) // 5 reqs/sec

	sr.HandleFunc("", handlers.UserInfo).Methods("GET")
	sr.HandleFunc("/push/subscribe", handlers.PushSubscribe).Methods("POST")

	if os.Getenv("ENV") != "production" {
		sr.HandleFunc("/push/test", handlers.PushTest).Methods("GET")
	}
}
