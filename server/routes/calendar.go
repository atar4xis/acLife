package routes

import (
	"net/http"
	"time"

	"acLife/handlers"

	"github.com/gorilla/mux"
)

// Calendar contains routes related to the calendar.
func Calendar(r *mux.Router) {
	sr := r.PathPrefix("/calendar").Subrouter()

	sr.Use(handlers.RateLimitMiddleware(20, time.Second)) // 20 reqs/sec
	sr.Use(handlers.AuthMiddleware())                     // must be logged in
	sr.Use(handlers.SubscriptionMiddleware())             // must have a valid subscription
	sr.Use(handlers.MaxBodySizeMiddleware(64 << 20))      // 64 MB

	sr.HandleFunc("/events/save", handlers.SaveCalendarEvents).Methods("POST")
	sr.Handle("/events/sync", handlers.MaxBodySizeMiddleware(4<<20)(http.HandlerFunc(handlers.SyncCalendarEvents))).Methods("POST") // 4 MB, fits MaxUserEvents cached events
}
