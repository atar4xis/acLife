package mail_test

import (
	"errors"
	"fmt"
	"log"
	"math"
	"os"
	"strings"
	"testing"
	"time"

	"acLife/constants"
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

	return insertKind(t, "account", status, updatedAtSQL)
}

func insertKind(t *testing.T, kind, status, updatedAtSQL string) int64 {
	t.Helper()

	res, err := database.DB.Exec("INSERT INTO email_queue (kind, recipient, subject, body, status) VALUES (?, 'a@example.com', 's', 'b', ?)", kind, status)
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

func TestSendNextMailLeavesFreshRetryingJobsAlone(t *testing.T) {
	testutil.RequireDB(t)
	id := insertQueued(t, "retrying", "")

	mail.SendNextMail()

	if got := state(t, id); got != (queued{"retrying", 0}) {
		t.Fatalf("got %+v", got)
	}
}

func TestSendNextMailRetriesStaleRetryingJobs(t *testing.T) {
	testutil.RequireDB(t)
	id := insertQueued(t, "retrying", "NOW() - INTERVAL 2 MINUTE")

	mail.SendNextMail()

	if got := state(t, id); got != (queued{"failed", 1}) {
		t.Fatalf("got %+v", got)
	}
}

func TestSendNextMailAttemptsPendingAndFailedJobs(t *testing.T) {
	testutil.RequireDB(t)
	pending := insertQueued(t, "pending", "")
	failed := insertQueued(t, "failed", "NOW() - INTERVAL 2 MINUTE")

	mail.SendNextMail()
	mail.SendNextMail()

	for _, id := range []int64{pending, failed} {
		if got := state(t, id); got.status != "failed" || got.attempts != 1 {
			t.Fatalf("job %d: %+v", id, got)
		}
	}
}

func TestSendNextMailDropsJobsOutOfAttempts(t *testing.T) {
	testutil.RequireDB(t)
	id := insertQueued(t, "failed", "")
	if _, err := database.DB.Exec("UPDATE email_queue SET attempts = 5 WHERE id = ?", id); err != nil {
		t.Fatal(err)
	}

	mail.SendNextMail()

	var n int
	if err := database.DB.QueryRow("SELECT COUNT(*) FROM email_queue WHERE id = ?", id).Scan(&n); err != nil || n != 0 {
		t.Fatalf("job remains: n=%d err=%v", n, err)
	}
}

func dispatch(t *testing.T, kind string, n int) {
	t.Helper()

	for range n {
		if _, err := database.DB.Exec("INSERT INTO sent_mail (kind, recipient_key, created_at, dispatched_at) VALUES (?, 'k', NOW(3), NOW(3))", kind); err != nil {
			t.Fatal(err)
		}
	}
}

func TestSendNextMailSendsOneMailPerCall(t *testing.T) {
	testutil.RequireDB(t)
	first := insertQueued(t, "pending", "")
	second := insertQueued(t, "pending", "")

	mail.SendNextMail()

	if got := state(t, first).attempts; got != 1 {
		t.Fatalf("first: %d", got)
	}
	if got := state(t, second).attempts; got != 0 {
		t.Fatalf("second: %d", got)
	}
}

func TestSendNextMailKeepsToTheBudgetOfEachKind(t *testing.T) {
	testutil.RequireDB(t)
	registration := insertKind(t, "registration", "pending", "")
	account := insertKind(t, "account", "pending", "")
	dispatch(t, "registration", (constants.MailHourlyLimit+1)/2)

	mail.SendNextMail()

	if got := state(t, registration).attempts; got != 0 {
		t.Fatalf("registration over budget was sent: %d", got)
	}
	if got := state(t, account).attempts; got != 1 {
		t.Fatalf("account: %d", got)
	}
}

func TestSendNextMailStopsAtTheHourlyLimit(t *testing.T) {
	testutil.RequireDB(t)
	registration := insertKind(t, "registration", "pending", "")
	account := insertKind(t, "account", "pending", "")
	dispatch(t, "registration", (constants.MailHourlyLimit+1)/2)
	dispatch(t, "account", constants.MailHourlyLimit/2)

	mail.SendNextMail()

	for _, id := range []int64{registration, account} {
		if got := state(t, id).attempts; got != 0 {
			t.Fatalf("job %d sent over the limit", id)
		}
	}
}

func TestSendNextMailPrefersTheKindWithMoreBudgetLeft(t *testing.T) {
	testutil.RequireDB(t)
	registration := insertKind(t, "registration", "pending", "")
	account := insertKind(t, "account", "pending", "")

	mail.SendNextMail()

	if got := state(t, registration).attempts; got != 0 {
		t.Fatalf("registration went first: %d", got)
	}
	if got := state(t, account).attempts; got != 1 {
		t.Fatalf("account: %d", got)
	}

	dispatch(t, "account", constants.MailHourlyLimit/2-1)

	mail.SendNextMail()

	if got := state(t, registration).attempts; got != 1 {
		t.Fatalf("registration: %d", got)
	}
}

func TestSendNextMailDeletesExpiredRegistrationsWhileOutOfBudget(t *testing.T) {
	testutil.RequireDB(t)
	expired := insertKind(t, "registration", "pending", "")
	if _, err := database.DB.Exec("UPDATE email_queue SET created_at = NOW() - INTERVAL 25 HOUR WHERE id = ?", expired); err != nil {
		t.Fatal(err)
	}
	dispatch(t, "registration", (constants.MailHourlyLimit+1)/2)
	dispatch(t, "account", constants.MailHourlyLimit/2)

	mail.SendNextMail()

	var n int
	if err := database.DB.QueryRow("SELECT COUNT(*) FROM email_queue WHERE id = ?", expired).Scan(&n); err != nil || n != 0 {
		t.Fatalf("job remains: n=%d err=%v", n, err)
	}
}

func TestSendNextMailIgnoresDispatchesOlderThanAnHour(t *testing.T) {
	testutil.RequireDB(t)
	id := insertKind(t, "registration", "pending", "")
	dispatch(t, "registration", (constants.MailHourlyLimit+1)/2)
	if _, err := database.DB.Exec("UPDATE sent_mail SET dispatched_at = NOW(3) - INTERVAL 61 MINUTE"); err != nil {
		t.Fatal(err)
	}

	mail.SendNextMail()

	if got := state(t, id).attempts; got != 1 {
		t.Fatalf("attempts: %d", got)
	}
}

func senderReturning(t *testing.T, err error) {
	t.Helper()

	mail.SetSender(func(to, subject, body string) error { return err })
	t.Cleanup(mail.ResetSender)
}

func dispatchedCount(t *testing.T) int {
	t.Helper()

	var n int
	if err := database.DB.QueryRow("SELECT COUNT(*) FROM sent_mail WHERE dispatched_at IS NOT NULL").Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestSendNextMailRecordsTheDispatchOfADeliveredMail(t *testing.T) {
	testutil.RequireDB(t)
	senderReturning(t, nil)
	if err := mail.QueueMail(t.Context(), database.DB, mail.KindRegistration, "b@example.com", "s", "b"); err != nil {
		t.Fatal(err)
	}

	mail.SendNextMail()

	if n := dispatchedCount(t); n != 1 {
		t.Fatalf("dispatched = %d", n)
	}
	var left int
	if err := database.DB.QueryRow("SELECT COUNT(*) FROM email_queue").Scan(&left); err != nil || left != 0 {
		t.Fatalf("queue left=%d err=%v", left, err)
	}
}

func TestSendNextMailDoesNotCountFailedAttemptsAgainstTheBudget(t *testing.T) {
	testutil.RequireDB(t)
	senderReturning(t, errors.New("smtp down"))
	if err := mail.QueueMail(t.Context(), database.DB, mail.KindRegistration, "b@example.com", "s", "b"); err != nil {
		t.Fatal(err)
	}

	mail.SendNextMail()

	if n := dispatchedCount(t); n != 0 {
		t.Fatalf("dispatched = %d", n)
	}
}

func TestSendNextMailCountsDeliveredMailsAgainstTheBudget(t *testing.T) {
	testutil.RequireDB(t)
	senderReturning(t, nil)
	budget := (constants.MailHourlyLimit + 1) / 2
	for i := range budget {
		if err := mail.QueueMail(t.Context(), database.DB, mail.KindRegistration, fmt.Sprintf("u%d@gmail.com", i), "s", "b"); err != nil {
			t.Fatal(err)
		}
	}
	extra := insertKind(t, "registration", "pending", "")

	for range budget + 1 {
		mail.SendNextMail()
	}

	if got := state(t, extra).attempts; got != 0 || dispatchedCount(t) != budget {
		t.Fatalf("attempts=%d dispatched=%d", got, dispatchedCount(t))
	}
}

func captureLog(t *testing.T) *strings.Builder {
	t.Helper()

	var out strings.Builder
	previous := log.Writer()
	log.SetOutput(&out)
	t.Cleanup(func() { log.SetOutput(previous) })
	return &out
}

func queueRegistration(t *testing.T) {
	t.Helper()

	if err := mail.QueueMail(t.Context(), database.DB, mail.KindRegistration, "w@example.com", "s", "b"); err != nil {
		t.Fatal(err)
	}
}

func TestSendNextMailWarnsWhenAKindBudgetFillsUp(t *testing.T) {
	testutil.RequireDB(t)
	senderReturning(t, nil)
	budget := (constants.MailHourlyLimit + 1) / 2
	threshold := int(math.Ceil(constants.MailBudgetWarnFraction * float64(budget)))
	dispatch(t, "registration", threshold-1)
	queueRegistration(t)
	out := captureLog(t)

	mail.SendNextMail()

	if want := fmt.Sprintf("mail budget registration at %d/%d", threshold, budget); !strings.Contains(out.String(), want) {
		t.Fatalf("log %q lacks %q", out.String(), want)
	}
}

func TestSendNextMailWarnsOnlyWhenCrossingTheThreshold(t *testing.T) {
	testutil.RequireDB(t)
	senderReturning(t, nil)
	budget := (constants.MailHourlyLimit + 1) / 2
	dispatch(t, "registration", int(math.Ceil(constants.MailBudgetWarnFraction*float64(budget))))
	queueRegistration(t)
	out := captureLog(t)

	mail.SendNextMail()

	if out.Len() != 0 {
		t.Fatalf("unexpected log %q", out.String())
	}
}

func TestSendNextMailWarnsWhenTheTotalFillsUp(t *testing.T) {
	testutil.RequireDB(t)
	senderReturning(t, nil)
	limit := constants.MailHourlyLimit
	threshold := int(math.Ceil(constants.MailBudgetWarnFraction * float64(limit)))
	registration := (limit+1)/2 - 1
	dispatch(t, "registration", registration)
	dispatch(t, "account", threshold-1-registration)
	queueRegistration(t)
	out := captureLog(t)

	mail.SendNextMail()

	if want := fmt.Sprintf("mail budget total at %d/%d", threshold, limit); !strings.Contains(out.String(), want) {
		t.Fatalf("log %q lacks %q", out.String(), want)
	}
}

func TestSendNextMailRetriesAFailedMailBeforeNewerOnes(t *testing.T) {
	testutil.RequireDB(t)
	failed := insertKind(t, "registration", "failed", "")
	if _, err := database.DB.Exec("UPDATE email_queue SET attempts = 1, updated_at = NOW() - INTERVAL 2 MINUTE WHERE id = ?", failed); err != nil {
		t.Fatal(err)
	}
	fresh := insertKind(t, "registration", "pending", "")

	mail.SendNextMail()

	if got := state(t, failed).attempts; got != 2 {
		t.Fatalf("failed: %d", got)
	}
	if got := state(t, fresh).attempts; got != 0 {
		t.Fatalf("fresh: %d", got)
	}
}

func TestSendNextMailWaitsBeforeRetryingAFailedMail(t *testing.T) {
	testutil.RequireDB(t)
	failed := insertKind(t, "registration", "failed", "")
	fresh := insertKind(t, "registration", "pending", "")

	mail.SendNextMail()

	if got := state(t, failed).attempts; got != 0 {
		t.Fatalf("failed: %d", got)
	}
	if got := state(t, fresh).attempts; got != 1 {
		t.Fatalf("fresh: %d", got)
	}
}

func TestSendNextMailCountsAMailWithoutAReservation(t *testing.T) {
	testutil.RequireDB(t)
	senderReturning(t, nil)
	insertKind(t, "account", "pending", "")

	mail.SendNextMail()

	var kind, recipientKey string
	if err := database.DB.QueryRow("SELECT kind, recipient_key FROM sent_mail WHERE dispatched_at > NOW(3) - INTERVAL 1 HOUR").Scan(&kind, &recipientKey); err != nil {
		t.Fatal(err)
	}
	if kind != "account" || recipientKey != mail.RecipientKey("a@example.com") {
		t.Fatalf("kind=%q recipientKey=%q", kind, recipientKey)
	}
}

func TestPurgeSentMailKeepsRecentDispatches(t *testing.T) {
	testutil.RequireDB(t)
	for _, dispatchedAt := range []string{"NOW(3) - INTERVAL 1 MINUTE", "NOW(3) - INTERVAL 2 HOUR", "NULL"} {
		if _, err := database.DB.Exec("INSERT INTO sent_mail (kind, recipient_key, created_at, dispatched_at) VALUES ('account', 'k', NOW(3) - INTERVAL 25 HOUR, " + dispatchedAt + ")"); err != nil {
			t.Fatal(err)
		}
	}

	mail.PurgeSentMail()

	if n := dispatchedCount(t); n != 1 {
		t.Fatalf("dispatched = %d", n)
	}
	if n := rowCount(t); n != 1 {
		t.Fatalf("rows = %d", n)
	}
}

func TestPurgeSentMailKeepsTheLastDay(t *testing.T) {
	testutil.RequireDB(t)
	for _, age := range []string{"23 HOUR", "25 HOUR"} {
		if _, err := database.DB.Exec("INSERT INTO sent_mail (kind, recipient_key, created_at) VALUES ('account', 'k', NOW(3) - INTERVAL " + age + ")"); err != nil {
			t.Fatal(err)
		}
	}

	mail.PurgeSentMail()

	var n int
	if err := database.DB.QueryRow("SELECT COUNT(*) FROM sent_mail").Scan(&n); err != nil || n != 1 {
		t.Fatalf("n=%d err=%v", n, err)
	}
}

func TestQueueMailLimitsTheMailsPerRecipient(t *testing.T) {
	testutil.RequireDB(t)

	queue := func(to string) error {
		return mail.QueueMail(t.Context(), database.DB, mail.KindAccount, to, "s", "b")
	}

	if err := queue("name@gmail.com"); err != nil {
		t.Fatal(err)
	}
	for _, alias := range []string{"name@gmail.com", "NAME@gmail.com", "n.a.m.e@gmail.com", "name+tag@gmail.com", "n.ame+x@googlemail.com"} {
		var limited *mail.LimitedError
		if err := queue(alias); !errors.As(err, &limited) || limited.Wait <= 0 || limited.Wait > time.Minute {
			t.Fatalf("%s: %v", alias, err)
		}
	}
	if err := queue("other@gmail.com"); err != nil {
		t.Fatal(err)
	}
	if err := queue("name@example.com"); err != nil {
		t.Fatal(err)
	}
	if err := queue("n.ame@example.com"); err != nil {
		t.Fatalf("dots are only ignored for gmail: %v", err)
	}
}

func TestSentMailStoresNoAddress(t *testing.T) {
	testutil.RequireDB(t)
	if err := mail.QueueMail(t.Context(), database.DB, mail.KindAccount, "secret@example.com", "s", "b"); err != nil {
		t.Fatal(err)
	}

	var key string
	if err := database.DB.QueryRow("SELECT recipient_key FROM sent_mail").Scan(&key); err != nil {
		t.Fatal(err)
	}
	if key == "" || strings.Contains(key, "secret") || key != mail.RecipientKey("secret@example.com") {
		t.Fatalf("key %q", key)
	}
}

func TestRecipientKeyFollowsTheProviderRules(t *testing.T) {
	same := [][]string{
		{"name@gmail.com", "N.a.M.e+x@googlemail.com"},
		{"name@icloud.com", "name+x@me.com", "NAME@mac.com"},
		{"na-me_.@proton.me", "name+y@pm.me", "n.ame@protonmail.com"},
		{"name@yahoo.com", "name-shop@ymail.com", "name@rocketmail.com"},
		{"name@outlook.com", "name+x@outlook.com"},
		{"name@example.com", "NAME+x@example.com"},
	}
	for _, group := range same {
		for _, addr := range group[1:] {
			if mail.RecipientKey(addr) != mail.RecipientKey(group[0]) {
				t.Errorf("%s and %s should share a key", group[0], addr)
			}
		}
	}

	different := [][2]string{
		{"name@outlook.com", "n.ame@outlook.com"},
		{"name@outlook.com", "name@hotmail.com"},
		{"name@example.com", "n.ame@example.com"},
		{"name@example.com", "name@example.org"},
		{"name@yahoo.com", "name+x@yahoo.com"},
		{"name@gmail.com", "name-x@gmail.com"},
		{"+a@example.com", "+b@example.com"},
	}
	for _, pair := range different {
		if mail.RecipientKey(pair[0]) == mail.RecipientKey(pair[1]) {
			t.Errorf("%s and %s should not share a key", pair[0], pair[1])
		}
	}
}

func TestQueueMailLimitsTheMailsPerSmallDomain(t *testing.T) {
	testutil.RequireDB(t)

	queue := func(to string) error {
		return mail.QueueMail(t.Context(), database.DB, mail.KindRegistration, to, "s", "b")
	}

	for i := range constants.MailDomainHourlyLimit {
		if err := queue(fmt.Sprintf("user%d@small.example", i)); err != nil {
			t.Fatal(err)
		}
	}

	var limited *mail.LimitedError
	if err := queue("another@small.example"); !errors.As(err, &limited) || limited.Wait <= 0 || limited.Wait > time.Hour {
		t.Fatalf("got %v", err)
	}
	if err := queue("another@other.example"); err != nil {
		t.Fatal(err)
	}

	if _, err := database.DB.Exec("UPDATE sent_mail SET created_at = NOW(3) - INTERVAL 61 MINUTE WHERE domain_key <> ''"); err != nil {
		t.Fatal(err)
	}
	if err := queue("another@small.example"); err != nil {
		t.Fatalf("hour passed: %v", err)
	}
}

func TestQueueMailDoesNotLimitTheDomainOfKnownProviders(t *testing.T) {
	testutil.RequireDB(t)

	for i := range constants.MailDomainHourlyLimit + 5 {
		if err := mail.QueueMail(t.Context(), database.DB, mail.KindRegistration, fmt.Sprintf("user%d@gmail.com", i), "s", "b"); err != nil {
			t.Fatal(err)
		}
	}

	var n int
	if err := database.DB.QueryRow("SELECT COUNT(*) FROM sent_mail WHERE domain_key <> ''").Scan(&n); err != nil || n != 0 {
		t.Fatalf("n=%d err=%v", n, err)
	}
}

func TestSendNextMailDropsRegistrationMailsOlderThanTheLinkLifetime(t *testing.T) {
	testutil.RequireDB(t)
	expired := insertKind(t, "registration", "pending", "")
	fresh := insertKind(t, "registration", "pending", "")
	account := insertKind(t, "account", "pending", "")
	for _, id := range []int64{expired, account} {
		if _, err := database.DB.Exec("UPDATE email_queue SET created_at = NOW() - INTERVAL 25 HOUR WHERE id = ?", id); err != nil {
			t.Fatal(err)
		}
	}
	dispatch(t, "account", constants.MailHourlyLimit/2)

	mail.SendNextMail()

	var n int
	if err := database.DB.QueryRow("SELECT COUNT(*) FROM email_queue WHERE id = ?", expired).Scan(&n); err != nil || n != 0 {
		t.Fatalf("expired kept: n=%d err=%v", n, err)
	}
	if got := state(t, fresh).attempts; got != 1 {
		t.Fatalf("fresh: %d", got)
	}
	if got := state(t, account).attempts; got != 0 {
		t.Fatalf("account: %d", got)
	}
}

func rowCount(t *testing.T) int {
	t.Helper()

	var n int
	if err := database.DB.QueryRow("SELECT COUNT(*) FROM sent_mail").Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}
