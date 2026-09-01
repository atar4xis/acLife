package main

import (
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"

	"acLife/constants"
	"acLife/database"
	"acLife/handlers"
	"acLife/routes"
	"acLife/session"
	"acLife/utils"

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

	// Make sure SMTP is configured if email verification is required
	if constants.Metadata.Registration.Email.VerificationRequired {
		check := func(envVar string) {
			if os.Getenv(envVar) == "" {
				log.Fatalf("%s is required for email verification but is not set. Set it or set DISABLE_EMAIL_VERIFICATION=true to disable email verification.", envVar)
			}
		}

		check("SMTP_HOST")
		check("SMTP_PORT")
		check("SMTP_USERNAME")
		check("SMTP_PASSWORD")
	}

	if os.Getenv("EMAIL_DOMAIN_BLACKLIST") != "" && os.Getenv("EMAIL_DOMAIN_WHITELIST") != "" {
		log.Fatal("EMAIL_DOMAIN_BLACKLIST and EMAIL_DOMAIN_WHITELIST cannot be set at the same time")
	}

	// Create cookie store
	sessionKey := os.Getenv("SESSION_KEY")
	if sessionKey == "" {
		log.Fatal("SESSION_KEY is not set")
	}

	if len(sessionKey) < 32 {
		log.Fatal("SESSION_KEY is too short, must be at least 32 characters")
	}

	serverURL, err := url.Parse(os.Getenv("SERVER_URL"))
	if err != nil {
		log.Fatal("SERVER_URL is invalid")
	}

	// Figure out the cookie domain from the SERVER_URL
	cookieDomain := serverURL.Hostname()

	if cookieDomain == "localhost" || net.ParseIP(cookieDomain) != nil {
		cookieDomain = "" // omit localhost or IPs
	}

	session.Store = sessions.NewCookieStore([]byte(sessionKey))
	session.Store.Options = &sessions.Options{
		Domain:   cookieDomain,
		Path:     "/",
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteNoneMode,
		MaxAge:   int(constants.AccessTokenExpiry.Seconds()),
	}

	// Setup API router
	r := mux.NewRouter()

	// We always want to close the request body
	r.Use(handlers.BodyCloseMiddleware())

	// Setup timeout
	r.Use(handlers.TimeoutMiddleware(constants.HTTPTimeout))

	// Reject cross-origin requests (CSRF protection)
	r.Use(handlers.CSRFMiddleware())

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
	origins := utils.GetAllowedOrigins();

	c := cors.New(cors.Options{
		AllowedOrigins:   origins,
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		AllowCredentials: true,
	})

	handler := c.Handler(r)

	// Bind to port
	fmt.Println("Running on port " + os.Getenv("PORT"))
	log.Fatal(http.ListenAndServe(":"+os.Getenv("PORT"), handler))
}
