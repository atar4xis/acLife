package mail_test

import (
	"os"
	"testing"

	"acLife/database"
	"acLife/internal/testutil"
	"acLife/mail"
)

func TestMain(m *testing.M) {
	os.Exit(testutil.Main(m))
}

type queued struct {
	status   string
	attempts int
}

func insertQueued(t *testing.T, status, updatedAtSQL string) int64 {
	t.Helper()

	res, err := database.DB.Exec("INSERT INTO email_queue (recipient, subject, body, status) VALUES ('a@example.com', 's', 'b', ?)", status)
	if err != nil {
		t.Fatal(err)
	}
	id, _ := res.LastInsertId()

	if updatedAtSQL != "" {
		if _, err := database.DB.Exec("UPDATE email_queue SET updated_at = "+updatedAtSQL+" WHERE id = ?", id); err != nil {
			t.Fatal(err)
		}
	}
	return id
}

func state(t *testing.T, id int64) queued {
	t.Helper()

	var q queued
	if err := database.DB.QueryRow("SELECT status, attempts FROM email_queue WHERE id = ?", id).Scan(&q.status, &q.attempts); err != nil {
		t.Fatal(err)
	}
	return q
}

func TestSendQueuedMailsLeavesFreshRetryingJobsAlone(t *testing.T) {
	testutil.RequireDB(t)
	id := insertQueued(t, "retrying", "")

	mail.SendQueuedMails()

	if got := state(t, id); got != (queued{"retrying", 0}) {
		t.Fatalf("got %+v", got)
	}
}

func TestSendQueuedMailsRetriesStaleRetryingJobs(t *testing.T) {
	testutil.RequireDB(t)
	id := insertQueued(t, "retrying", "NOW() - INTERVAL 2 MINUTE")

	mail.SendQueuedMails()

	if got := state(t, id); got != (queued{"failed", 1}) {
		t.Fatalf("got %+v", got)
	}
}

func TestSendQueuedMailsAttemptsPendingAndFailedJobs(t *testing.T) {
	testutil.RequireDB(t)
	pending := insertQueued(t, "pending", "")
	failed := insertQueued(t, "failed", "")

	mail.SendQueuedMails()

	for _, id := range []int64{pending, failed} {
		if got := state(t, id); got.status != "failed" || got.attempts != 1 {
			t.Fatalf("job %d: %+v", id, got)
		}
	}
}

func TestSendQueuedMailsDropsJobsOutOfAttempts(t *testing.T) {
	testutil.RequireDB(t)
	id := insertQueued(t, "failed", "")
	if _, err := database.DB.Exec("UPDATE email_queue SET attempts = 5 WHERE id = ?", id); err != nil {
		t.Fatal(err)
	}

	mail.SendQueuedMails()

	var n int
	if err := database.DB.QueryRow("SELECT COUNT(*) FROM email_queue WHERE id = ?", id).Scan(&n); err != nil || n != 0 {
		t.Fatalf("job remains: n=%d err=%v", n, err)
	}
}
