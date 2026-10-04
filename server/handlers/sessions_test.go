package handlers_test

import (
	"net/http"
	"testing"
	"time"

	"acLife/database"
	"acLife/internal/testutil"
	"acLife/types"
)

func listSessions(t *testing.T, c *testutil.Client) []types.Session {
	t.Helper()

	status, reply := testutil.Call[[]types.Session](c, "GET", "/user/sessions", nil)
	if status != http.StatusOK {
		t.Fatalf("list sessions: %d", status)
	}
	return reply.Data
}

func sessionIDs(t *testing.T, owner string) []string {
	t.Helper()

	var ids []string
	rows, err := database.DB.Query("SELECT public_id FROM account_sessions WHERE owner = ?", owner)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return ids
}

func TestListSessionsOnlyReturnsOwnAndMarksCurrent(t *testing.T) {
	testutil.RequireDB(t)
	srv := testutil.NewClient(t)
	user, other := testutil.NewUser(t), testutil.NewUser(t)

	testutil.NewSession(t, other, time.Now().Add(time.Hour))
	testutil.NewSession(t, user, time.Now().Add(time.Hour))
	current := srv.As(user)

	got := listSessions(t, current)
	if len(got) != 2 {
		t.Fatalf("got %d sessions", len(got))
	}
	currentCount := 0
	for _, s := range got {
		if s.Current {
			currentCount++
		}
	}
	if currentCount != 1 {
		t.Fatalf("%d sessions marked current", currentCount)
	}
}

func TestRevokeSession(t *testing.T) {
	testutil.RequireDB(t)

	t.Run("removes another own session", func(t *testing.T) {
		srv := testutil.NewClient(t)
		user := testutil.NewUser(t)
		testutil.NewSession(t, user, time.Now().Add(time.Hour))
		current := srv.As(user)

		var target string
		for _, s := range listSessions(t, current) {
			if !s.Current {
				target = s.ID
			}
		}

		status, _ := testutil.Call[any](current, "DELETE", "/user/sessions/"+target, nil)
		if status != http.StatusOK {
			t.Fatalf("got %d", status)
		}
		if len(listSessions(t, current)) != 1 {
			t.Fatal("session not removed")
		}
	})

	t.Run("refuses the current session", func(t *testing.T) {
		srv := testutil.NewClient(t)
		current := srv.As(testutil.NewUser(t))

		var id string
		for _, s := range listSessions(t, current) {
			id = s.ID
		}

		status, reply := testutil.Call[any](current, "DELETE", "/user/sessions/"+id, nil)
		if status != http.StatusBadRequest || reply.Code != "cannot_end_current_session" {
			t.Fatalf("got %d %+v", status, reply)
		}
	})

	t.Run("cannot remove another users session", func(t *testing.T) {
		srv := testutil.NewClient(t)
		victim, attacker := testutil.NewUser(t), testutil.NewUser(t)
		testutil.NewSession(t, victim, time.Now().Add(time.Hour))
		ids := sessionIDs(t, victim.UUID)

		status, reply := testutil.Call[any](srv.As(attacker), "DELETE", "/user/sessions/"+ids[0], nil)
		if status != http.StatusNotFound || reply.Code != "session_not_found" {
			t.Fatalf("got %d %+v", status, reply)
		}
		if got := sessionIDs(t, victim.UUID); len(got) != 1 {
			t.Fatalf("victim sessions: %v", got)
		}
	})

	t.Run("unknown id", func(t *testing.T) {
		current := testutil.NewClient(t).As(testutil.NewUser(t))

		status, _ := testutil.Call[any](current, "DELETE", "/user/sessions/"+testutil.NewUUID(), nil)
		if status != http.StatusNotFound {
			t.Fatalf("got %d", status)
		}
	})
}

func TestRevokedSessionStopsWorking(t *testing.T) {
	testutil.RequireDB(t)
	srv := testutil.NewClient(t)
	user := testutil.NewUser(t)
	victimCookie := testutil.NewSession(t, user, time.Now().Add(time.Hour))
	current := srv.As(user)

	for _, s := range listSessions(t, current) {
		if !s.Current {
			testutil.Call[any](current, "DELETE", "/user/sessions/"+s.ID, nil)
		}
	}

	status, _ := testutil.Call[any](srv.WithCookie(victimCookie), "GET", "/user", nil)
	if status != http.StatusUnauthorized {
		t.Fatalf("got %d", status)
	}
}
