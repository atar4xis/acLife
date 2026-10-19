package routes

import (
	"os"
	"time"

	"acLife/constants"
	"acLife/handlers"

	"github.com/gorilla/mux"
)

// User contains routes related to user accounts.
func User(r *mux.Router) {
	ur := r.PathPrefix("/user").Subrouter()

	ur.Use(handlers.RateLimitMiddleware(constants.RateLimitUser, time.Second))
	ur.Use(handlers.AuthMiddleware()) // must be logged in

	ss := ur.PathPrefix("/settings").Subrouter()
	ss.Use(handlers.SubscriptionMiddleware())         // must have a valid subscription
	ss.Use(handlers.MaxBodySizeMiddleware(192 << 10)) // 192 KB
	ss.HandleFunc("", handlers.GetSettings).Methods("GET")
	ss.HandleFunc("", handlers.SaveSettings).Methods("POST")

	kr := ur.PathPrefix("/keys").Subrouter()
	kr.Use(handlers.SubscriptionMiddleware())
	kr.Use(handlers.MaxBodySizeMiddleware(8 << 10))
	kr.HandleFunc("", handlers.GetKeys).Methods("GET")
	kr.HandleFunc("", handlers.StoreKeys).Methods("POST")
	lr := kr.PathPrefix("/lookup").Subrouter()
	lr.Use(handlers.UserRateLimitMiddleware(constants.KeyLookupsPerMinute, time.Minute))
	lr.HandleFunc("", handlers.LookupKey).Methods("POST")

	sr := ur.NewRoute().Subrouter()
	sr.Use(handlers.MaxBodySizeMiddleware(8 << 10)) // 8 KB

	sr.HandleFunc("", handlers.UserInfo).Methods("GET")
	sr.HandleFunc("/quota", handlers.GetQuota).Methods("GET")
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
