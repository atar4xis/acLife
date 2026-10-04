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

	// Setup timeout
	r.Use(handlers.TimeoutMiddleware(constants.HTTPTimeout))

	// Routes consist of a path and a handler function
	r.HandleFunc("/", handlers.Root).Methods("GET")
	r.HandleFunc("/metadata", handlers.Metadata).Methods("GET")

	// Register error handlers
	r.NotFoundHandler = http.HandlerFunc(handlers.NotFound)
	r.MethodNotAllowedHandler = http.HandlerFunc(handlers.MethodNotAllowed)

	// Reject cross-origin requests (CSRF protection)
	csrfRouter := r.NewRoute().Subrouter()
	csrfRouter.Use(handlers.CSRFMiddleware())

	// Register all routes (stripe webhook exempt from CSRF protection)
	Auth(csrfRouter)
	User(csrfRouter)
	Stripe(r)
	Calendar(csrfRouter)

	return r
}
