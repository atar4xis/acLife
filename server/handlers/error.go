package handlers

import (
	"net/http"

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
