package routes

import (
	"net/http"
	"time"

	"acLife/constants"
	"acLife/handlers"

	"github.com/gorilla/mux"
)

// Calendar contains routes related to the calendar.
func Calendar(r *mux.Router) {
	sr := r.PathPrefix("/calendar").Subrouter()

	sr.Use(handlers.RateLimitMiddleware(20, time.Second)) // 20 reqs/sec
	sr.Use(handlers.AuthMiddleware())                     // must be logged in
	sr.Use(handlers.SubscriptionMiddleware())             // must have a valid subscription
	sr.Use(handlers.MaxBodySizeMiddleware(constants.MaxSaveBodyBytes))

	sr.HandleFunc("/events/save", handlers.SaveCalendarEvents).Methods("POST")
	sr.Handle("/notifications/sync", handlers.MaxBodySizeMiddleware(constants.NotificationSyncBody)(http.HandlerFunc(handlers.SyncNotifications))).Methods("POST")
	sr.Handle("/events/sync", handlers.MaxBodySizeMiddleware(constants.MaxSyncBodyBytes)(http.HandlerFunc(handlers.SyncCalendarEvents))).Methods("POST") // fits MaxUserEvents cached events
}
