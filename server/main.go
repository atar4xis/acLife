package main

import (
	"log"
	"net/http"
	"os"
	"strings"

	"acLife/constants"
	"acLife/database"
	"acLife/handlers"
	"acLife/routes"
	"acLife/session"

	"github.com/gorilla/mux"
	"github.com/gorilla/sessions"
	"github.com/rs/cors"
)

func main() {
	// Connect to the database
	if err := database.Connect(); err != nil {
		log.Fatalf("Database connection failed: %v", err)
	}

	// Setup database
	if err := database.Setup(); err != nil {
		log.Fatalf("Database setup failed: %v", err)
	}

	// Create cookie store
	sessionKey := os.Getenv("SESSION_KEY")
	if sessionKey == "" {
		log.Fatal("SESSION_KEY is not set")
	}

	if len(sessionKey) < 32 {
		log.Fatal("SESSION_KEY is too short, must be at least 32 characters")
	}

	session.Store = sessions.NewCookieStore([]byte(sessionKey))
	session.Store.Options = &sessions.Options{
		Path:     "/",
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteNoneMode,
	}

	// Setup API router
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

	// Register all routes
	routes.Auth(r)
	routes.User(r)
	routes.Stripe(r)
	routes.Calendar(r)

	// Setup CORS
	origins := strings.Split(os.Getenv("CORS_ALLOWED_ORIGINS"), ",")

	for i := range origins {
		origins[i] = strings.TrimSpace(origins[i])
	}

	c := cors.New(cors.Options{
		AllowedOrigins:   origins,
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		AllowCredentials: true,
	})

	handler := c.Handler(r)

	// Bind to port
	log.Print("Running on port " + os.Getenv("PORT"))
	log.Fatal(http.ListenAndServe(":"+os.Getenv("PORT"), handler))
}
