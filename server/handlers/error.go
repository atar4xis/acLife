package handlers

import (
	"errors"
	"fmt"
	"net/http"
	"time"

	"acLife/mail"
	"acLife/types"
	"acLife/utils"
)

func NotFound(w http.ResponseWriter, r *http.Request) {
	utils.SendJSON(w, http.StatusNotFound, types.Reply[any]{
		Success: false,
		Message: "Unknown route.",
		Code:    "unknown_route",
	})
}

func MethodNotAllowed(w http.ResponseWriter, r *http.Request) {
	utils.SendJSON(w, http.StatusMethodNotAllowed, types.Reply[any]{
		Success: false,
		Message: "Method not allowed.",
		Code:    "method_not_allowed",
	})
}

func Timeout(w http.ResponseWriter, r *http.Request) {
	utils.SendJSON(w, http.StatusRequestTimeout, types.Reply[any]{
		Success: false,
		Message: "Request timed out.",
		Code:    "request_timeout",
	})
}

func replyMailError(w http.ResponseWriter, function, action string, err error) {
	if limited, ok := errors.AsType[*mail.LimitedError](err); ok {
		replyTooManyAttempts(w, limited.Wait)
		return
	}

	if errors.Is(err, errRegistrationBusy) {
		utils.SendJSON(w, http.StatusTooManyRequests, types.Reply[any]{
			Success: false,
			Message: "Registration is currently busy. Please try again later.",
			Code:    "registration_busy",
		})
		return
	}

	utils.LogError(function, action, err)
	utils.SendInternalError(w)
}

func replyTooManyAttempts(w http.ResponseWriter, wait time.Duration) {
	if wait <= time.Minute {
		seconds := int(wait.Seconds()) + 1
		utils.SendJSON(w, http.StatusTooManyRequests, types.Reply[any]{
			Success: false,
			Message: fmt.Sprintf("Too many attempts. Try again in %d seconds.", seconds),
			Code:    "too_many_attempts_seconds",
			Params:  map[string]any{"count": seconds},
		})
		return
	}

	replyLocked(w, wait)
}
