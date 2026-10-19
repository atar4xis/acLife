package handlers

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"slices"
	"strings"

	"acLife/constants"
	"acLife/database"
	"acLife/session"
	"acLife/stream"
	"acLife/types"
	"acLife/utils"

	"github.com/gorilla/mux"
)

const (
	permissionRead  = "read"
	permissionWrite = "write"
	scopeItem       = "item"
	scopeCollection = "collection"
	kindCalendar    = "calendar"
	kindJournal     = "journal"
)

var (
	errNoSpace    = errors.New("no such space")
	errSpaceLimit = errors.New("share limit reached")
	errNoSuchUser = errors.New("no such user")
	errMemberDup  = errors.New("already a member")
)

type spaceRow struct {
	ID    string
	Owner string
	Kind  string
	Scope string
}

type access struct {
	spaceRow
	isOwner    bool
	permission string
}

func (a access) canWrite() bool { return a.isOwner || a.permission == permissionWrite }

// spaceAccess returns the user's access to a space, errNoSpace if they don't own it or aren't an accepted member.
func spaceAccess(ctx context.Context, q rowQuerier, id, user string) (access, error) {
	if !utils.IsUUID(id) {
		return access{}, errNoSpace
	}

	var acc access
	err := q.QueryRowContext(ctx,
		`SELECT sp.id, sp.owner, sp.kind, sp.scope, COALESCE(m.permission, '')
		FROM share_spaces sp
		LEFT JOIN share_members m ON m.space = sp.id AND m.user = ? AND m.status = 'accepted'
		WHERE sp.id = ?`,
		user, id,
	).Scan(&acc.ID, &acc.Owner, &acc.Kind, &acc.Scope, &acc.permission)
	if errors.Is(err, sql.ErrNoRows) {
		return access{}, errNoSpace
	}
	if err != nil {
		return access{}, err
	}

	acc.isOwner = acc.Owner == user
	if !acc.isOwner && acc.permission == "" {
		return access{}, errNoSpace
	}
	return acc, nil
}

func replyShareError(w http.ResponseWriter, function string, err error) {
	switch {
	case errors.Is(err, errNoSpace):
		utils.SendError(w, http.StatusNotFound, "share_not_found", "Share not found.")
	case errors.Is(err, errNoSuchUser):
		utils.SendError(w, http.StatusNotFound, "user_not_found", "User not found.")
	case errors.Is(err, errMemberDup):
		utils.SendError(w, http.StatusConflict, "already_member", "This person already has access.")
	case errors.Is(err, errSpaceLimit):
		utils.SendError(w, http.StatusConflict, "share_limit_reached", "Sharing limit reached.")
	case errors.Is(err, errBadChanges):
		utils.SendBadRequest(w)
	default:
		utils.LogError(function, "apply", err)
		utils.SendInternalError(w)
	}
}

func validPermission(p string) bool { return p == permissionRead || p == permissionWrite }

func validMember(m types.NewMember) bool {
	return utils.IsUUID(m.User) && validPermission(m.Permission) && len(m.WrappedKey) > 0 && len(m.WrappedKey) <= constants.MaxWrappedKeyLen
}

func queryAll[T any](ctx context.Context, scan func(*sql.Rows) (T, error), query string, args ...any) ([]T, error) {
	rows, err := database.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	all := []T{}
	for rows.Next() {
		item, err := scan(rows)
		if err != nil {
			return nil, err
		}
		all = append(all, item)
	}
	return all, rows.Err()
}

type memberRow struct {
	space  string
	member types.ShareMember
}

func ListShares(w http.ResponseWriter, r *http.Request) {
	user := session.GetLoggedInUser(r)
	utils.Assert(user != nil)

	ctx := r.Context()
	owned, err := queryAll(ctx, func(rows *sql.Rows) (types.OwnedShare, error) {
		share := types.OwnedShare{Members: []types.ShareMember{}}
		err := rows.Scan(&share.ID, &share.Kind, &share.Scope, &share.OwnerKey, &share.KeyVersion)
		return share, err
	}, "SELECT id, kind, scope, owner_key, key_version FROM share_spaces WHERE owner = ? ORDER BY created_at, id", user.UUID)
	if err != nil {
		utils.LogError("ListShares", "owned", err)
		utils.SendInternalError(w)
		return
	}

	members, err := queryAll(ctx, func(rows *sql.Rows) (memberRow, error) {
		var row memberRow
		err := rows.Scan(&row.space, &row.member.User, &row.member.Email, &row.member.PublicKey, &row.member.Permission, &row.member.Status)
		return row, err
	}, `SELECT m.space, m.user, u.email, COALESCE(k.public_key, ''), m.permission, m.status
		FROM share_members m
		JOIN share_spaces sp ON sp.id = m.space
		JOIN users u ON u.uuid = m.user
		LEFT JOIN user_keys k ON k.owner = m.user
		WHERE sp.owner = ? ORDER BY m.created_at, m.user`, user.UUID)
	if err != nil {
		utils.LogError("ListShares", "members", err)
		utils.SendInternalError(w)
		return
	}

	received, err := queryAll(ctx, func(rows *sql.Rows) (types.ReceivedShare, error) {
		var share types.ReceivedShare
		err := rows.Scan(&share.ID, &share.Owner, &share.OwnerEmail, &share.OwnerPublicKey, &share.Kind, &share.Scope, &share.Permission, &share.Status, &share.WrappedKey, &share.KeyVersion)
		return share, err
	}, `SELECT sp.id, sp.owner, u.email, COALESCE(k.public_key, ''), sp.kind, sp.scope, m.permission, m.status, m.wrapped_key, m.key_version
		FROM share_members m
		JOIN share_spaces sp ON sp.id = m.space
		JOIN users u ON u.uuid = sp.owner
		LEFT JOIN user_keys k ON k.owner = sp.owner
		WHERE m.user = ? ORDER BY m.created_at, sp.id`, user.UUID)
	if err != nil {
		utils.LogError("ListShares", "received", err)
		utils.SendInternalError(w)
		return
	}

	index := make(map[string]int, len(owned))
	for i, share := range owned {
		index[share.ID] = i
	}
	for _, row := range members {
		if i, known := index[row.space]; known {
			owned[i].Members = append(owned[i].Members, row.member)
		}
	}

	utils.SendJSON(w, http.StatusOK, types.Reply[types.ShareList]{Success: true, Data: types.ShareList{Owned: owned, Received: received}})
}

// lockOwner serializes changes to one owner's spaces until tx ends.
func lockOwner(ctx context.Context, tx *sql.Tx, owner string) error {
	var lockedOwner string
	return tx.QueryRowContext(ctx, "SELECT uuid FROM users WHERE uuid = ? FOR UPDATE", owner).Scan(&lockedOwner)
}

// lockSpaceOwner finds the owner of a space and locks them, errNoSpace if the space does not exist.
func lockSpaceOwner(ctx context.Context, tx *sql.Tx, spaceID string) (string, error) {
	var owner string
	err := tx.QueryRowContext(ctx, "SELECT owner FROM share_spaces WHERE id = ?", spaceID).Scan(&owner)
	if errors.Is(err, sql.ErrNoRows) {
		return "", errNoSpace
	}
	if err != nil {
		return "", err
	}
	return owner, lockOwner(ctx, tx, owner)
}

func insertMember(ctx context.Context, tx *sql.Tx, owner, spaceID string, m types.NewMember) error {
	if m.User == owner {
		return errBadChanges
	}

	var hasKeys bool
	if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM user_keys WHERE owner = ?)", m.User).Scan(&hasKeys); err != nil {
		return err
	}
	if !hasKeys {
		return errNoSuchUser
	}

	var received int
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM share_members WHERE user = ? AND status = 'pending'", m.User).Scan(&received); err != nil {
		return err
	}
	if received >= constants.MaxPendingReceived {
		return errNoSuchUser
	}

	var fromOwner int
	if err := tx.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM share_members m JOIN share_spaces sp ON sp.id = m.space WHERE sp.owner = ? AND m.user = ? AND m.status = 'pending'",
		owner, m.User,
	).Scan(&fromOwner); err != nil {
		return err
	}
	if fromOwner >= constants.MaxPendingPerPair {
		return errSpaceLimit
	}

	var inSpace, pending int
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM share_members WHERE space = ?", spaceID).Scan(&inSpace); err != nil {
		return err
	}
	if err := tx.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM share_members m JOIN share_spaces sp ON sp.id = m.space WHERE sp.owner = ? AND m.status = 'pending'",
		owner,
	).Scan(&pending); err != nil {
		return err
	}
	if inSpace >= constants.MaxMembersPerSpace || pending >= constants.MaxPendingInvites {
		return errSpaceLimit
	}

	_, err := tx.ExecContext(ctx,
		"INSERT INTO share_members (space, user, permission, wrapped_key) VALUES (?, ?, ?, ?)",
		spaceID, m.User, m.Permission, m.WrappedKey,
	)
	if database.IsDuplicateEntry(err) {
		return errMemberDup
	}
	if database.IsForeignKeyViolation(err) {
		return errNoSpace
	}
	return err
}

func CreateSpace(w http.ResponseWriter, r *http.Request) {
	user := session.GetLoggedInUser(r)
	utils.Assert(user != nil)

	var req types.CreateSpaceRequest
	if err := utils.ParseJSON(r.Body, &req); err != nil ||
		!utils.IsUUID(req.ID) ||
		(req.Kind != kindCalendar && req.Kind != kindJournal) ||
		(req.Scope != scopeItem && req.Scope != scopeCollection) ||
		len(req.OwnerKey) == 0 || len(req.OwnerKey) > constants.MaxWrappedKeyLen ||
		len(req.Members) == 0 || len(req.Members) > constants.MaxMembersPerSpace ||
		slices.ContainsFunc(req.Members, func(m types.NewMember) bool { return !validMember(m) }) {
		utils.SendBadRequest(w)
		return
	}
	req.ID = strings.ToLower(req.ID)
	for i := range req.Members {
		req.Members[i].User = strings.ToLower(req.Members[i].User)
	}

	err := database.RunTx(r.Context(), func(tx *sql.Tx) error {
		if err := lockOwner(r.Context(), tx, user.UUID); err != nil {
			return err
		}

		var owned int
		if err := tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM share_spaces WHERE owner = ?", user.UUID).Scan(&owned); err != nil {
			return err
		}
		if owned >= constants.MaxSharesPerOwner {
			return errSpaceLimit
		}

		if _, err := tx.ExecContext(r.Context(),
			"INSERT INTO share_spaces (id, owner, kind, scope, owner_key) VALUES (?, ?, ?, ?, ?)",
			req.ID, user.UUID, req.Kind, req.Scope, req.OwnerKey,
		); err != nil {
			if database.IsDuplicateEntry(err) {
				return errBadChanges
			}
			return err
		}
		for _, m := range req.Members {
			if err := insertMember(r.Context(), tx, user.UUID, req.ID, m); err != nil {
				return err
			}
		}
		return tx.Commit()
	})
	if err != nil {
		replyShareError(w, "CreateSpace", err)
		return
	}

	users := []string{user.UUID}
	for _, m := range req.Members {
		users = append(users, m.User)
	}
	stream.PublishTo(users, stream.SpacesChanged(requestClientID(r)))

	utils.SendJSON(w, http.StatusOK, types.Reply[types.SpaceCreated]{Success: true, Data: types.SpaceCreated{ID: req.ID}})
}

func ownerAndUsers(ctx context.Context, tx *sql.Tx, owner, query string, args ...any) ([]string, error) {
	users := []string{owner}
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	for rows.Next() {
		var userID string
		if err := rows.Scan(&userID); err != nil {
			return nil, err
		}
		users = append(users, userID)
	}
	return users, rows.Err()
}

func spaceUsers(ctx context.Context, tx *sql.Tx, id, owner string) ([]string, error) {
	return ownerAndUsers(ctx, tx, owner, "SELECT user FROM share_members WHERE space = ?", id)
}

func modifyAsOwner(w http.ResponseWriter, r *http.Request, function, spaceID string, extra []string, write func(ctx context.Context, tx *sql.Tx, sp access) error) {
	user := session.GetLoggedInUser(r)
	utils.Assert(user != nil)

	var users []string
	err := database.RunTx(r.Context(), func(tx *sql.Tx) error {
		if err := lockOwner(r.Context(), tx, user.UUID); err != nil {
			return err
		}

		sp, err := spaceAccess(r.Context(), tx, spaceID, user.UUID)
		if err != nil {
			return err
		}
		if !sp.isOwner {
			return errNoSpace
		}

		if users, err = spaceUsers(r.Context(), tx, sp.ID, sp.Owner); err != nil {
			return err
		}
		if err := write(r.Context(), tx, sp); err != nil {
			return err
		}
		return tx.Commit()
	})
	if err != nil {
		replyShareError(w, function, err)
		return
	}

	stream.PublishTo(append(users, extra...), stream.SpacesChanged(requestClientID(r)))
	utils.SendJSON(w, http.StatusOK, types.Reply[any]{Success: true})
}

func AddMember(w http.ResponseWriter, r *http.Request) {
	var req types.AddMemberRequest
	if err := utils.ParseJSON(r.Body, &req); err != nil || !validMember(req.NewMember) {
		utils.SendBadRequest(w)
		return
	}
	req.User = strings.ToLower(req.User)

	modifyAsOwner(w, r, "AddMember", req.Space, []string{req.User}, func(ctx context.Context, tx *sql.Tx, sp access) error {
		return insertMember(ctx, tx, sp.Owner, sp.ID, req.NewMember)
	})
}

func SetPermission(w http.ResponseWriter, r *http.Request) {
	var req types.PermissionRequest
	if err := utils.ParseJSON(r.Body, &req); err != nil || !validPermission(req.Permission) || !utils.IsUUID(req.User) {
		utils.SendBadRequest(w)
		return
	}
	req.User = strings.ToLower(req.User)

	modifyAsOwner(w, r, "SetPermission", req.Space, nil, func(ctx context.Context, tx *sql.Tx, sp access) error {
		res, err := tx.ExecContext(ctx, "UPDATE share_members SET permission = ? WHERE space = ? AND user = ?", req.Permission, sp.ID, req.User)
		if err != nil {
			return err
		}
		if matched, _ := res.RowsAffected(); matched == 0 {
			var exists bool
			if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM share_members WHERE space = ? AND user = ?)", sp.ID, req.User).Scan(&exists); err != nil {
				return err
			}
			if !exists {
				return errNoSuchUser
			}
		}
		return nil
	})
}

func modifyAsMember(w http.ResponseWriter, r *http.Request, function string, write func(ctx context.Context, tx *sql.Tx, spaceID, owner, user string) (int64, error)) {
	user := session.GetLoggedInUser(r)
	utils.Assert(user != nil)

	var req types.SpaceRequest
	if err := utils.ParseJSON(r.Body, &req); err != nil || !utils.IsUUID(req.Space) {
		utils.SendBadRequest(w)
		return
	}

	var owner string
	err := database.RunTx(r.Context(), func(tx *sql.Tx) error {
		var err error
		if owner, err = lockSpaceOwner(r.Context(), tx, req.Space); err != nil {
			return err
		}

		changed, err := write(r.Context(), tx, req.Space, owner, user.UUID)
		if err != nil {
			return err
		}
		if changed == 0 {
			return errNoSpace
		}
		return tx.Commit()
	})
	if err != nil {
		replyShareError(w, function, err)
		return
	}

	stream.PublishTo([]string{owner, user.UUID}, stream.SpacesChanged(requestClientID(r)))
	utils.SendJSON(w, http.StatusOK, types.Reply[any]{Success: true})
}

func AcceptShare(w http.ResponseWriter, r *http.Request) {
	modifyAsMember(w, r, "AcceptShare", func(ctx context.Context, tx *sql.Tx, spaceID, _, user string) (int64, error) {
		res, err := tx.ExecContext(ctx, "UPDATE share_members SET status = 'accepted' WHERE space = ? AND user = ? AND status = 'pending'", spaceID, user)
		if err != nil {
			return 0, err
		}
		return res.RowsAffected()
	})
}

func DeclineShare(w http.ResponseWriter, r *http.Request) {
	modifyAsMember(w, r, "DeclineShare", func(ctx context.Context, tx *sql.Tx, spaceID, owner, user string) (int64, error) {
		res, err := tx.ExecContext(ctx, "DELETE FROM share_members WHERE space = ? AND user = ? AND status = 'pending'", spaceID, user)
		if err != nil {
			return 0, err
		}
		declined, err := res.RowsAffected()
		if err != nil || declined == 0 {
			return declined, err
		}
		return declined, dropIfEmpty(ctx, tx, spaceID, owner)
	})
}

func RemoveMember(w http.ResponseWriter, r *http.Request) {
	user := session.GetLoggedInUser(r)
	utils.Assert(user != nil)

	vars := mux.Vars(r)
	spaceID, member := vars["space"], vars["user"]
	if !utils.IsUUID(spaceID) || !utils.IsUUID(member) {
		utils.SendBadRequest(w)
		return
	}
	member = strings.ToLower(member)

	var users []string
	err := database.RunTx(r.Context(), func(tx *sql.Tx) error {
		_, err := lockSpaceOwner(r.Context(), tx, spaceID)
		if err != nil {
			return err
		}

		sp, err := spaceAccess(r.Context(), tx, spaceID, user.UUID)
		if errors.Is(err, errNoSpace) && member == user.UUID {
			sp, err = spaceAccessPending(r.Context(), tx, spaceID, user.UUID)
		}
		if err != nil {
			return err
		}
		if !sp.isOwner && member != user.UUID {
			return errNoSpace
		}
		if users, err = spaceUsers(r.Context(), tx, sp.ID, sp.Owner); err != nil {
			return err
		}
		res, err := tx.ExecContext(r.Context(), "DELETE FROM share_members WHERE space = ? AND user = ?", sp.ID, member)
		if err != nil {
			return err
		}
		if removed, _ := res.RowsAffected(); removed == 0 {
			return errNoSuchUser
		}
		if err := dropIfEmpty(r.Context(), tx, sp.ID, sp.Owner); err != nil {
			return err
		}
		return tx.Commit()
	})
	if err != nil {
		replyShareError(w, "RemoveMember", err)
		return
	}

	stream.PublishTo(users, stream.SpacesChanged(requestClientID(r)))
	utils.SendJSON(w, http.StatusOK, types.Reply[any]{Success: true})
}

// spaceAccessPending is spaceAccess for an invitee who has not accepted yet, so they can decline or leave.
func spaceAccessPending(ctx context.Context, q rowQuerier, id, user string) (access, error) {
	acc := access{permission: permissionRead}
	err := q.QueryRowContext(ctx,
		`SELECT sp.id, sp.owner, sp.kind, sp.scope FROM share_spaces sp JOIN share_members m ON m.space = sp.id AND m.user = ? WHERE sp.id = ?`,
		user, id,
	).Scan(&acc.ID, &acc.Owner, &acc.Kind, &acc.Scope)
	if errors.Is(err, sql.ErrNoRows) {
		return access{}, errNoSpace
	}
	return acc, err
}

func DeleteSpace(w http.ResponseWriter, r *http.Request) {
	user := session.GetLoggedInUser(r)
	utils.Assert(user != nil)

	spaceID := mux.Vars(r)["id"]
	var users []string
	err := database.RunTx(r.Context(), func(tx *sql.Tx) error {
		ctx := r.Context()
		if err := lockOwner(ctx, tx, user.UUID); err != nil {
			return err
		}

		sp, err := spaceAccess(ctx, tx, spaceID, user.UUID)
		if err != nil {
			return err
		}
		if !sp.isOwner {
			return errNoSpace
		}

		if users, err = spaceUsers(ctx, tx, sp.ID, sp.Owner); err != nil {
			return err
		}
		if err := dropSpace(ctx, tx, sp.ID, sp.Owner); err != nil {
			return err
		}
		return tx.Commit()
	})
	if err != nil {
		replyShareError(w, "DeleteSpace", err)
		return
	}

	stream.PublishTo(users, stream.SpacesChanged(requestClientID(r)))
	utils.SendJSON(w, http.StatusOK, types.Reply[any]{Success: true})
}

// dropSpace deletes a space and returns its bytes to the owner's shared quota.
func dropSpace(ctx context.Context, tx *sql.Tx, spaceID, owner string) error {
	used, _, err := lockStorage(ctx, tx, owner, sharedBytes)
	if err != nil {
		return err
	}
	freed, err := spaceBytes(ctx, tx, spaceID)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM share_spaces WHERE id = ?", spaceID); err != nil {
		return err
	}
	return saveStorage(ctx, tx, owner, sharedBytes, max(used-freed, 0))
}

// dropIfEmpty deletes the space once it has no members left.
func dropIfEmpty(ctx context.Context, tx *sql.Tx, spaceID, owner string) error {
	var members int
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM share_members WHERE space = ?", spaceID).Scan(&members); err != nil {
		return err
	}
	if members > 0 {
		return nil
	}
	return dropSpace(ctx, tx, spaceID, owner)
}

func spaceBytes(ctx context.Context, q rowQuerier, spaceID string) (int64, error) {
	var used int64
	err := q.QueryRowContext(ctx,
		`SELECT (SELECT COALESCE(SUM(OCTET_LENGTH(data)), 0) FROM share_records WHERE space = ?)
			+ (SELECT COUNT(*) * ? FROM share_record_buckets WHERE space = ?)`,
		spaceID, constants.BucketRowBytes, spaceID,
	).Scan(&used)
	return used, err
}
