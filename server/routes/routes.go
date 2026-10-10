// Package routes provides Subrouters with registered routes
package routes

import (
	"net/http"

	"acLife/constants"
	"acLife/handlers"

	"github.com/gorilla/mux"
)

// New builds the API router with all routes and global middleware registered.
func New() *mux.Router {
	r := mux.NewRouter()

	// We always want to close the request body
	r.Use(handlers.BodyCloseMiddleware())

	// The stream is long-lived, so it must sit outside the timeout
	Stream(r)

	// Setup timeout
	tr := r.NewRoute().Subrouter()
	tr.Use(handlers.DeadlineMiddleware(constants.RequestDeadline))
	tr.Use(handlers.TimeoutMiddleware(constants.HTTPTimeout))

	// Routes consist of a path and a handler function
	tr.HandleFunc("/", handlers.Root).Methods("GET")
	tr.HandleFunc("/metadata", handlers.Metadata).Methods("GET")

	// Register error handlers
	r.NotFoundHandler = http.HandlerFunc(handlers.NotFound)
	r.MethodNotAllowedHandler = http.HandlerFunc(handlers.MethodNotAllowed)

	// Reject cross-origin requests (CSRF protection)
	csrfRouter := tr.NewRoute().Subrouter()
	csrfRouter.Use(handlers.CSRFMiddleware())

	// Register all routes (stripe webhook exempt from CSRF protection)
	Auth(csrfRouter)
	User(csrfRouter)
	Stripe(tr)
	Calendar(csrfRouter)
	Journal(csrfRouter)

	return r
}
