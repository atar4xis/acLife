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
	"acLife/mail"
	"acLife/routes"
	"acLife/session"
	"acLife/utils"

	"github.com/rs/cors"
)

func main() {
	constants.Load()

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

	session.Store = session.NewStore([]byte(sessionKey), cookieDomain)

	// Start background workers
	mail.StartWorker()
	handlers.StartWorkers()

	// Setup CORS
	origins := utils.GetAllowedOrigins()

	c := cors.New(cors.Options{
		AllowedOrigins:   origins,
		AllowedMethods:   []string{"GET", "POST", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		AllowCredentials: true,
	})

	if os.Getenv("IS_BEHIND_PROXY") != "" {
		log.Println("Proxy mode is enabled (IS_BEHIND_PROXY set). Make sure you're actually behind a trusted proxy that sets X-Real-IP correctly. If not, clients can spoof their IP address.")
	}

	// Register all routes
	handler := c.Handler(routes.New())

	// Bind to port
	fmt.Println("Running on port " + os.Getenv("PORT"))
	srv := &http.Server{
		Addr:              ":" + os.Getenv("PORT"),
		Handler:           handler,
		ReadHeaderTimeout: constants.ReadHeaderTimeout,
		IdleTimeout:       constants.IdleTimeout,
	}
	log.Fatal(srv.ListenAndServe())
}
