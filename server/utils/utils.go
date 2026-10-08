// Package utils provides helper functions and utilities shared across the application.
package utils

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/mail"
	"os"
	"path"
	"regexp"
	"runtime"
	"runtime/debug"
	"slices"
	"strconv"
	"strings"
	"time"

	"acLife/types"
)

// SendJSON writes the given value as a JSON response with the specified status code.
func SendJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)

	err := json.NewEncoder(w).Encode(v)
	if err != nil {
		log.Printf("JSON encode error: %v", err)
		http.Error(w, `{"success":false,"message":"Internal server error"}`, http.StatusInternalServerError)
	}
}

// SendInternalError sends a standard 500 JSON response.
func SendInternalError(w http.ResponseWriter) {
	SendJSON(w, http.StatusInternalServerError, types.Reply[any]{
		Success: false,
		Message: "An unexpected error occurred.",
		Code:    "internal_error",
	})
}

// SendBadRequest sends a generic 400 JSON response.
func SendBadRequest(w http.ResponseWriter) {
	SendJSON(w, http.StatusBadRequest, types.Reply[any]{
		Success: false,
		Message: "Bad request.",
		Code:    "bad_request",
	})
}

// ParseJSON reads JSON from the body and decodes it into dest.
func ParseJSON(body io.ReadCloser, dest any) error {
	defer func() { _ = body.Close() }()

	decoder := json.NewDecoder(body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dest); err != nil {
		return err
	}

	return nil
}

// RandomToken generates a secure random hex string of length n bytes.
func RandomToken(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err) // should never fail
	}
	return fmt.Sprintf("%x", b)
}

// ValidateEmail returns true if the email is valid.
func ValidateEmail(email string) bool {
	if len(email) > 254 {
		return false
	}

	_, err := mail.ParseAddress(email)
	if err != nil {
		return false
	}

	re := regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)
	return re.MatchString(email)
}

// LogError logs an error in a particular format.
func LogError(function, action string, err error) {
	// a cancelled request context means the client left, which is not a server error
	if errors.Is(err, context.Canceled) {
		return
	}
	log.Printf("[ERROR] in %s @ %s: %v", function, action, err)
}

// LogInfo prints a timestamped informational line to stdout, errors and warnings go to stderr through LogError and the log package.
func LogInfo(format string, args ...any) {
	_, _ = fmt.Fprintf(os.Stdout, "%s %s\n", time.Now().Format(time.DateTime), fmt.Sprintf(format, args...))
}

// Assert panics if a condition is false.
func Assert(condition bool) {
	if !condition {
		_, file, line, _ := runtime.Caller(1)
		fmt.Printf("Assertion failed at %s:%d\n%s\n", file, line, debug.Stack())
		panic("assertion failed")
	}
}

var uuidPattern = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// IsUUID reports whether s is a hyphenated uuid.
func IsUUID(s string) bool {
	return uuidPattern.MatchString(s)
}

func Base64ToUUID(b64 string) (string, error) {
	bytes, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return "", err
	}
	if len(bytes) != 16 {
		return "", fmt.Errorf("invalid UUID length")
	}

	hexStr := hex.EncodeToString(bytes)

	uuid := fmt.Sprintf("%s-%s-%s-%s-%s",
		hexStr[0:8],
		hexStr[8:12],
		hexStr[12:16],
		hexStr[16:20],
		hexStr[20:32],
	)

	return strings.ToLower(uuid), nil
}

// GetAllowedOrigins returns the list of allowed origins from the CORS_ALLOWED_ORIGINS environment variable.
func GetAllowedOrigins() []string {
	origins := strings.Split(os.Getenv("CORS_ALLOWED_ORIGINS"), ",")

	for i := range origins {
		origins[i] = strings.TrimSpace(origins[i])
	}

	return origins
}

// IsEmailDomainAllowed checks the email's domain against the blacklist or whitelist environment variables, if set.
func IsEmailDomainAllowed(email string) bool {
	i := strings.LastIndex(email, "@")
	if i == -1 {
		return false
	}
	domain := strings.ToLower(email[i+1:])

	if blacklist := os.Getenv("EMAIL_DOMAIN_BLACKLIST"); blacklist != "" {
		for pattern := range strings.SplitSeq(blacklist, ",") {
			if matched, _ := path.Match(strings.ToLower(strings.TrimSpace(pattern)), domain); matched {
				return false
			}
		}
		return true
	}

	if whitelist := os.Getenv("EMAIL_DOMAIN_WHITELIST"); whitelist != "" {
		for pattern := range strings.SplitSeq(whitelist, ",") {
			if matched, _ := path.Match(strings.ToLower(strings.TrimSpace(pattern)), domain); matched {
				return true
			}
		}
		return false
	}

	return true
}

// PreferredLanguage picks the best match for the request's Accept-Language header from supported (base language codes), falling back to "en".
func PreferredLanguage(r *http.Request, supported []string) string {
	best, bestQ := "en", 0.0
	for part := range strings.SplitSeq(r.Header.Get("Accept-Language"), ",") {
		tag, params, _ := strings.Cut(strings.TrimSpace(part), ";")
		q := 1.0
		if v, ok := strings.CutPrefix(strings.TrimSpace(params), "q="); ok {
			parsed, err := strconv.ParseFloat(v, 64)
			if err != nil {
				continue
			}
			q = parsed
		}

		base, _, _ := strings.Cut(strings.ToLower(strings.TrimSpace(tag)), "-")
		if q > bestQ && slices.Contains(supported, base) {
			best, bestQ = base, q
		}
	}
	return best
}
