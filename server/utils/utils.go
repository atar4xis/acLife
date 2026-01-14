// Package utils provides helper functions and utilities shared across the application.
package utils

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/mail"
	"regexp"
	"runtime"
	"runtime/debug"
	"strings"

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
	})
}

// SendBadRequest sends a generic 400 JSON response.
func SendBadRequest(w http.ResponseWriter) {
	SendJSON(w, http.StatusBadRequest, types.Reply[any]{
		Success: false,
		Message: "Bad request.",
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
	log.Printf("[ERROR] in %s @ %s: %v", function, action, err)
}

// Assert panics if a condition is false.
func Assert(condition bool) {
	if !condition {
		_, file, line, _ := runtime.Caller(1)
		fmt.Printf("Assertion failed at %s:%d\n%s\n", file, line, debug.Stack())
		panic("assertion failed")
	}
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
