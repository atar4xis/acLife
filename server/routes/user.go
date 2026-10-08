package routes

import (
	"os"
	"time"

	"acLife/handlers"

	"github.com/gorilla/mux"
)

// User contains routes related to user accounts.
func User(r *mux.Router) {
	ur := r.PathPrefix("/user").Subrouter()

	ur.Use(handlers.RateLimitMiddleware(5, time.Second)) // 5 reqs/sec
	ur.Use(handlers.AuthMiddleware())                    // must be logged in

	ss := ur.PathPrefix("/settings").Subrouter()
	ss.Use(handlers.SubscriptionMiddleware())         // must have a valid subscription
	ss.Use(handlers.MaxBodySizeMiddleware(192 << 10)) // 192 KB
	ss.HandleFunc("", handlers.GetSettings).Methods("GET")
	ss.HandleFunc("", handlers.SaveSettings).Methods("POST")

	sr := ur.NewRoute().Subrouter()
	sr.Use(handlers.MaxBodySizeMiddleware(8 << 10)) // 8 KB

	sr.HandleFunc("", handlers.UserInfo).Methods("GET")
	sr.HandleFunc("/reauth/start", handlers.ReauthStart).Methods("POST")
	sr.HandleFunc("/email", handlers.UpdateEmail).Methods("POST")
	sr.HandleFunc("/password", handlers.UpdatePassword).Methods("POST")
	sr.HandleFunc("/sessions", handlers.ListSessions).Methods("GET")
	sr.HandleFunc("/sessions/{id}", handlers.RevokeSession).Methods("DELETE")
	sr.HandleFunc("/push/subscribe", handlers.PushSubscribe).Methods("POST")
	sr.HandleFunc("/push/unsubscribe", handlers.PushUnsubscribe).Methods("POST")
	sr.HandleFunc("/push/check", handlers.PushCheck).Methods("POST")

	if os.Getenv("ENV") != "production" {
		sr.HandleFunc("/push/test", handlers.PushTest).Methods("GET")
	}
}
