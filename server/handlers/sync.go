package handlers

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"slices"
	"sort"
	"strings"
	"time"

	"acLife/constants"
	"acLife/database"
	"acLife/session"
	"acLife/stream"
	"acLife/types"
	"acLife/utils"
)

var (
	errBadChanges   = errors.New("invalid changes")
	errStorageLimit = errors.New("storage limit reached")
	errBadSync      = errors.New("invalid sync request")
)

func placeholders(n int) string {
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}

// recordChanges decodes at most constants.MaxRequestRecords changes, so a huge array of tiny entries is rejected instead of expanded in memory.
type recordChanges[T types.Recorded] []types.RecordChange[T]

func (c *recordChanges[T]) UnmarshalJSON(data []byte) error {
	if string(data) == "null" {
		return nil
	}

	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if tok, err := dec.Token(); err != nil || tok != json.Delim('[') {
		return errBadChanges
	}

	changes := recordChanges[T]{}
	for dec.More() {
		if len(changes) == constants.MaxRequestRecords {
			return errBadChanges
		}

		var change types.RecordChange[T]
		if err := dec.Decode(&change); err != nil {
			return err
		}
		changes = append(changes, change)
	}

	*c = changes
	return nil
}

// replyChangesError answers a failed apply of changes.
func replyChangesError(w http.ResponseWriter, function string, err error) {
	switch {
	case errors.Is(err, errBadChanges):
		utils.SendBadRequest(w)
	case errors.Is(err, errNoSpace):
		utils.SendError(w, http.StatusNotFound, "share_not_found", "Share not found.")
	case errors.Is(err, errForbidden):
		utils.SendError(w, http.StatusForbidden, "share_forbidden", "You don't have permission to do that.")
	case errors.Is(err, errStorageLimit):
		utils.SendError(w, http.StatusRequestEntityTooLarge, "storage_limit_reached", "Storage limit reached.")
	default:
		utils.LogError(function, "apply", err)
		utils.SendInternalError(w)
	}
}

type applyFunc[T types.Recorded] func(ctx context.Context, tx *sql.Tx, owner string, changes []types.RecordChange[T]) ([]stream.Change, error)

func saveChanges[T types.Recorded](w http.ResponseWriter, r *http.Request, function string, apply applyFunc[T], message func(originClientID string, applied []stream.Change) stream.Message) {
	user := session.GetLoggedInUser(r)
	utils.Assert(user != nil) // ensured by AuthMiddleware

	saveScoped(w, r, function, user.UUID,
		func(ctx context.Context, tx *sql.Tx, changes []types.RecordChange[T]) ([]stream.Change, error) {
			return apply(ctx, tx, user.UUID, changes)
		},
		func(originClientID string, applied []stream.Change) {
			stream.Publish(user.UUID, message(originClientID, applied))
		},
	)
}

// requestClientID returns the client id sent as ?c=, empty unless it has the expected length.
func requestClientID(r *http.Request) string {
	id := r.URL.Query().Get("c")
	if len(id) != 6 {
		return ""
	}
	return id
}

// saveScoped is saveChanges under any lock key (the caller or a space), publish decides who gets the message.
func saveScoped[T types.Recorded](w http.ResponseWriter, r *http.Request, function, lockKey string, apply func(ctx context.Context, tx *sql.Tx, changes []types.RecordChange[T]) ([]stream.Change, error), publish func(originClientID string, applied []stream.Change)) {
	var changes recordChanges[T]
	if err := utils.ParseJSON(r.Body, &changes); err != nil {
		utils.SendBadRequest(w)
		return
	}

	if len(changes) == 0 {
		utils.SendJSON(w, http.StatusOK, types.Reply[any]{
			Success: true,
		})
		return
	}

	ctx := r.Context()
	err := database.RunTx(ctx, func(tx *sql.Tx) error {
		applied, err := apply(ctx, tx, changes)
		if err != nil {
			return err
		}

		// commit and publish together so other clients see changes in commit order
		unlock := stream.SerializeCommits(lockKey)
		defer unlock()
		if err := tx.Commit(); err != nil {
			return err
		}

		publish(requestClientID(r), applied)
		return nil
	})
	if err != nil {
		replyChangesError(w, function, err)
		return
	}

	utils.SendJSON(w, http.StatusOK, types.Reply[any]{
		Success: true,
	})
}

type collectedChanges[U any] struct {
	deleted []string
	upserts []U
	touched []any // deleted ids followed by upsert ids
}

// collectChanges validates a batch and keeps the last change listed per id (ids passed through normalize).
func collectChanges[T types.Recorded, U any](changes []types.RecordChange[T], normalize func(string) string, parse func(c types.RecordChange[T], id string) (U, error)) (collectedChanges[U], error) {
	deleted := make(map[string]struct{})
	upsertsByID := make(map[string]U)

	for _, c := range changes {
		switch c.Type {
		case "deleted":
			if !utils.IsUUID(c.ID) {
				return collectedChanges[U]{}, errBadChanges
			}

			id := normalize(c.ID)
			delete(upsertsByID, id)
			deleted[id] = struct{}{}

		case "added", "updated":
			record := c.Record.Base()
			if !utils.IsUUID(record.ID) || record.UpdatedAt < constants.MinRecordTimestampMs || record.UpdatedAt > constants.MaxRecordTimestampMs {
				return collectedChanges[U]{}, errBadChanges
			}

			id := normalize(record.ID)
			upsert, err := parse(c, id)
			if err != nil {
				return collectedChanges[U]{}, err
			}

			delete(deleted, id)
			upsertsByID[id] = upsert

		default:
			return collectedChanges[U]{}, errBadChanges
		}
	}

	collected := collectedChanges[U]{deleted: slices.Sorted(maps.Keys(deleted))}
	upsertIDs := slices.Sorted(maps.Keys(upsertsByID))
	collected.touched = make([]any, 0, len(collected.deleted)+len(upsertIDs))
	for _, id := range collected.deleted {
		collected.touched = append(collected.touched, id)
	}
	for _, id := range upsertIDs {
		collected.upserts = append(collected.upserts, upsertsByID[id])
		collected.touched = append(collected.touched, id)
	}
	return collected, nil
}

// bucketHash hashes the "uuid:updatedAtMillis" lines of a bucket, line order does not matter.
func bucketHash(lines []string) string {
	sorted := append([]string(nil), lines...)
	sort.Strings(sorted)
	sum := sha256.Sum256([]byte(strings.Join(sorted, "\n")))
	return base64.StdEncoding.EncodeToString(sum[:])
}

func hashLine(id string, updatedAt time.Time) string {
	return fmt.Sprintf("%s:%d", strings.ToLower(id), updatedAt.UnixMilli())
}

// syncParts answers each part of a batched sync with run, in request order.
func syncParts[P any](w http.ResponseWriter, r *http.Request, function, kind string, parts []P, spaceOf func(P) string, run func(ctx context.Context, space string, part P) (any, error)) {
	user := session.GetLoggedInUser(r)
	utils.Assert(user != nil) // ensured by AuthMiddleware

	if len(parts) == 0 || len(parts) > constants.MaxSyncParts {
		utils.SendBadRequest(w)
		return
	}

	seen := make(map[string]struct{}, len(parts))
	for _, part := range parts {
		space := strings.ToLower(spaceOf(part))
		if _, duplicate := seen[space]; duplicate {
			utils.SendBadRequest(w)
			return
		}
		seen[space] = struct{}{}
	}

	ctx := r.Context()
	reply := types.SyncReply{Parts: make([]types.Reply[any], len(parts))}
	for i, part := range parts {
		space := spaceOf(part)
		if space != "" {
			sp, err := spaceAccess(ctx, database.DB, space, user.UUID)
			if err == nil && sp.Kind != kind {
				err = errNoSpace
			}
			if errors.Is(err, errNoSpace) {
				reply.Parts[i] = types.Reply[any]{Code: "share_not_found", Message: "Share not found."}
				continue
			}
			if err != nil {
				utils.LogError(function, "spaceAccess", err)
				utils.SendInternalError(w)
				return
			}
			space = sp.ID
		}

		data, err := run(ctx, space, part)
		if errors.Is(err, errBadSync) {
			utils.SendBadRequest(w)
			return
		}
		if err != nil {
			utils.LogError(function, "run", err)
			utils.SendInternalError(w)
			return
		}
		reply.Parts[i] = types.Reply[any]{Success: true, Data: data}
	}

	utils.SendJSON(w, http.StatusOK, types.Reply[types.SyncReply]{Success: true, Data: reply})
}
