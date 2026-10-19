package handlers

import (
	"crypto/ecdh"
	"database/sql"
	"errors"
	"net/http"
	"strings"

	"acLife/constants"
	"acLife/database"
	"acLife/session"
	"acLife/types"
	"acLife/utils"
)

func StoreKeys(w http.ResponseWriter, r *http.Request) {
	user := session.GetLoggedInUser(r)
	utils.Assert(user != nil)

	var req types.UserKeys
	if err := utils.ParseJSON(r.Body, &req); err != nil ||
		len(req.WrappedPrivate) == 0 || len(req.WrappedPrivate) > constants.MaxWrappedPrivateLen {
		utils.SendBadRequest(w)
		return
	}
	if _, err := ecdh.P256().NewPublicKey(req.PublicKey); err != nil {
		utils.SendBadRequest(w)
		return
	}

	_, err := database.Exec(r.Context(),
		"INSERT INTO user_keys (owner, public_key, wrapped_private) VALUES (?, ?, ?)",
		user.UUID, req.PublicKey, req.WrappedPrivate,
	)
	if database.IsDuplicateEntry(err) {
		utils.SendError(w, http.StatusConflict, "keys_exist", "Keys already exist.")
		return
	}
	if err != nil {
		utils.LogError("StoreKeys", "Exec", err)
		utils.SendInternalError(w)
		return
	}

	utils.SendJSON(w, http.StatusOK, types.Reply[any]{Success: true})
}

func GetKeys(w http.ResponseWriter, r *http.Request) {
	user := session.GetLoggedInUser(r)
	utils.Assert(user != nil)

	var keys types.UserKeys
	err := database.QueryRow(r.Context(),
		"SELECT public_key, wrapped_private FROM user_keys WHERE owner = ?",
		user.UUID,
	).Scan(&keys.PublicKey, &keys.WrappedPrivate)
	if errors.Is(err, sql.ErrNoRows) {
		utils.SendJSON(w, http.StatusOK, types.Reply[*types.UserKeys]{Success: true})
		return
	}
	if err != nil {
		utils.LogError("GetKeys", "QueryRow", err)
		utils.SendInternalError(w)
		return
	}

	utils.SendJSON(w, http.StatusOK, types.Reply[*types.UserKeys]{Success: true, Data: &keys})
}

func LookupKey(w http.ResponseWriter, r *http.Request) {
	user := session.GetLoggedInUser(r)
	utils.Assert(user != nil)

	var req types.KeyLookupRequest
	if err := utils.ParseJSON(r.Body, &req); err != nil || len(req.Email) > constants.MaxEmailLen {
		utils.SendBadRequest(w)
		return
	}

	if strings.EqualFold(req.Email, user.Email) {
		utils.SendError(w, http.StatusBadRequest, "self", "Enter another person's email.")
		return
	}

	var found types.KeyLookupResponse
	err := database.QueryRow(r.Context(),
		`SELECT u.uuid, k.public_key FROM users u JOIN user_keys k ON k.owner = u.uuid WHERE u.email = ?`,
		req.Email,
	).Scan(&found.UUID, &found.PublicKey)
	if errors.Is(err, sql.ErrNoRows) {
		utils.SendError(w, http.StatusNotFound, "user_not_found", "User not found.")
		return
	}
	if err != nil {
		utils.LogError("LookupKey", "QueryRow", err)
		utils.SendInternalError(w)
		return
	}

	utils.SendJSON(w, http.StatusOK, types.Reply[types.KeyLookupResponse]{Success: true, Data: found})
}
