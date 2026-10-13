package routes

import (
	"time"

	"acLife/constants"
	"acLife/handlers"

	"github.com/gorilla/mux"
)

// Stream contains the realtime sync stream.
func Stream(r *mux.Router) {
	sr := r.PathPrefix("/stream").Subrouter()

	sr.Use(handlers.RateLimitMiddleware(constants.RateLimitStream, time.Minute))
	sr.Use(handlers.AuthMiddleware())         // must be logged in
	sr.Use(handlers.SubscriptionMiddleware()) // must have a valid subscription
	sr.Use(handlers.CSRFMiddleware())

	sr.HandleFunc("", handlers.Stream).Methods("GET")
}
