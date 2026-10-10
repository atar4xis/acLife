package routes

import (
	"net/http"
	"time"

	"acLife/constants"
	"acLife/handlers"

	"github.com/gorilla/mux"
)

// Journal contains routes related to the journal.
func Journal(r *mux.Router) {
	sr := r.PathPrefix("/journal").Subrouter()

	sr.Use(handlers.RateLimitMiddleware(20, time.Second)) // 20 reqs/sec
	sr.Use(handlers.AuthMiddleware())                     // must be logged in
	sr.Use(handlers.SubscriptionMiddleware())             // must have a valid subscription
	sr.Use(handlers.MaxBodySizeMiddleware(constants.MaxSaveBodyBytes))

	sr.HandleFunc("/save", handlers.SaveJournal).Methods("POST")
	sr.Handle("/sync", handlers.MaxBodySizeMiddleware(constants.MaxSyncBodyBytes)(http.HandlerFunc(handlers.SyncJournal))).Methods("POST")
}
