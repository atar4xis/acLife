// Package handlers defines HTTP request handlers.
package handlers

import (
	"net/http"

	"acLife/constants"
	"acLife/types"
	"acLife/utils"
)

func Root(w http.ResponseWriter, r *http.Request) {
	utils.SendJSON(w, http.StatusOK, types.Reply[any]{
		Success: true,
		Message: "acLife API v" + constants.Version,
	})
}

func Metadata(w http.ResponseWriter, r *http.Request) {
	utils.SendJSON(w, http.StatusOK, types.Reply[types.ServerMetadata]{
		Success: true,
		Data:    constants.Metadata,
	})
}
