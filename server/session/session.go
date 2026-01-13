// Package session provides a wrapper for managing a session across the application.
package session

import (
	"net/http"

	"acLife/constants"

	"github.com/gorilla/sessions"
)

var Store *sessions.CookieStore

// GetSession returns the session or creates a new one
func GetSession(r *http.Request) (*sessions.Session, error) {
	return Store.Get(r, constants.SessionName)
}

// Set a value and save the session
func Set(w http.ResponseWriter, r *http.Request, key string, value any) error {
	sess, err := GetSession(r)
	if err != nil {
		return err
	}
	sess.Values[key] = value
	return sess.Save(r, w)
}

// Get returns a value of type T from the session
func Get[T any](r *http.Request, key string) T {
	var zero T

	sess, err := GetSession(r)
	if err != nil {
		return zero
	}

	val, ok := sess.Values[key].(T)
	if !ok {
		return zero
	}

	return val
}

// DestroySession clears all session data and removes the session cookie
func DestroySession(w http.ResponseWriter, r *http.Request) error {
	sess, err := GetSession(r)
	if err != nil {
		return err
	}

	for k := range sess.Values {
		delete(sess.Values, k)
	}

	sess.Options.MaxAge = -1

	return sess.Save(r, w)
}
