// Package mail provides a generic, queue-backed email sending system.
package mail

import (
	"cmp"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"log"
	"math"
	"os"
	"slices"
	"strconv"
	"sync"
	"time"

	"acLife/constants"
	"acLife/database"
	"acLife/utils"

	gomail "github.com/wneessen/go-mail"
)

type Kind string

const (
	KindRegistration Kind = "registration"
	KindAccount      Kind = "account"
)

type LimitedError struct {
	Wait time.Duration
}

func (e *LimitedError) Error() string {
	return fmt.Sprintf("mail limited for %s", e.Wait)
}

type limit struct {
	n      int
	window time.Duration
}

var recipientLimits = []limit{
	{constants.MailsPerRecipientPerMinute, time.Minute},
	{constants.MailsPerRecipientPerHour, time.Hour},
	{constants.MailsPerRecipientPerDay, constants.Day},
}

var reserveMu sync.Mutex

var send = sendMail

// StartWorker launches the background email queue worker.
func StartWorker() {
	go processQueue()
}

// Execer is satisfied by both database.DB and a *sql.Tx, letting callers run queue mutations either standalone or as part of a larger transaction.
type Execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// Queryer is satisfied by both database.DB and a *sql.Tx.
type Queryer interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func hashKey(purpose, value string) string {
	mac := hmac.New(sha256.New, []byte(os.Getenv("SESSION_KEY")))
	mac.Write([]byte(purpose + "|" + value))
	return hex.EncodeToString(mac.Sum(nil))
}

func RecipientKey(to string) string {
	recipient, _ := keys(to)
	return recipient
}

func keys(to string) (recipient, domain string) {
	local, canonical, known := normalize(to)
	recipient = hashKey("mail-recipient", local+"@"+canonical)
	if !known {
		domain = hashKey("mail-domain", canonical)
	}
	return recipient, domain
}

func sentTimes(ctx context.Context, query string, args ...any) ([]time.Time, error) {
	rows, err := database.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var sent []time.Time
	for rows.Next() {
		var createdAt time.Time
		if err := rows.Scan(&createdAt); err != nil {
			return nil, err
		}
		sent = append(sent, createdAt)
	}
	return sent, rows.Err()
}

func waitFor(sent []time.Time, limits []limit, now time.Time) time.Duration {
	var wait time.Duration
	for _, l := range limits {
		if len(sent) >= l.n && now.Sub(sent[l.n-1]) < l.window {
			wait = max(wait, sent[l.n-1].Add(l.window).Sub(now))
		}
	}
	return wait
}

func reserve(ctx context.Context, kind Kind, to string) (int64, error) {
	recipient, domainKey := keys(to)
	now := time.Now()

	reserveMu.Lock()
	defer reserveMu.Unlock()

	sent, err := sentTimes(ctx,
		"SELECT created_at FROM sent_mail WHERE recipient_key = ? AND created_at > ? ORDER BY created_at DESC",
		recipient, now.Add(-constants.Day),
	)
	if err != nil {
		return 0, err
	}
	wait := waitFor(sent, recipientLimits, now)

	if domainKey != "" {
		sent, err := sentTimes(ctx,
			"SELECT created_at FROM sent_mail WHERE domain_key = ? AND created_at > ? ORDER BY created_at DESC LIMIT ?",
			domainKey, now.Add(-time.Hour), constants.MailDomainHourlyLimit,
		)
		if err != nil {
			return 0, err
		}
		wait = max(wait, waitFor(sent, []limit{{constants.MailDomainHourlyLimit, time.Hour}}, now))
	}

	if wait > 0 {
		return 0, &LimitedError{Wait: wait}
	}

	res, err := database.Exec(ctx,
		"INSERT INTO sent_mail (kind, recipient_key, domain_key, created_at) VALUES (?, ?, ?, ?)",
		kind, recipient, domainKey, now,
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// QueueMail adds an email to the send queue for the background worker to deliver, unless the recipient reached its limits.
func QueueMail(ctx context.Context, db Execer, kind Kind, to, subject, body string) error {
	id, err := reserve(ctx, kind, to)
	if err != nil {
		return err
	}

	_, err = db.ExecContext(ctx,
		"INSERT INTO email_queue (kind, recipient, subject, body, sent_mail_id) VALUES (?, ?, ?, ?, ?)",
		kind, to, subject, body, id,
	)
	return err
}

// HasQueuedMails reports whether any email is currently queued (not yet delivered) for the given recipient.
func HasQueuedMails(ctx context.Context, db Queryer, to string) (bool, error) {
	var exists bool
	err := db.QueryRowContext(ctx,
		"SELECT EXISTS(SELECT 1 FROM email_queue WHERE recipient = ?)",
		to,
	).Scan(&exists)
	return exists, err
}

// CancelQueuedMails removes any queued emails for the given recipient that no longer need to be sent.
func CancelQueuedMails(ctx context.Context, db Execer, to string) error {
	_, err := db.ExecContext(ctx, "DELETE FROM email_queue WHERE recipient = ? AND status IN ('pending', 'failed')", to)
	return err
}

func Budget(kind Kind) int {
	if kind == KindRegistration {
		return (constants.MailHourlyLimit + 1) / 2
	}
	return constants.MailHourlyLimit / 2
}

// processQueue sends at most one queued mail per tick, within the hourly budgets.
func processQueue() {
	sendTick := time.NewTicker(time.Hour / time.Duration(constants.MailHourlyLimit))
	purgeTick := time.NewTicker(time.Hour)
	defer sendTick.Stop()
	defer purgeTick.Stop()

	purgeSentMail()

	for {
		select {
		case <-sendTick.C:
			sendNextMail()
		case <-purgeTick.C:
			purgeSentMail()
		}
	}
}

func purgeSentMail() {
	now := time.Now()
	if _, err := database.Exec(context.Background(),
		"DELETE FROM sent_mail WHERE created_at < ? AND (dispatched_at IS NULL OR dispatched_at < ?)",
		now.Add(-constants.Day), now.Add(-time.Hour),
	); err != nil {
		utils.LogError("purgeSentMail", "database.Exec", err)
	}
}

func recordDispatch(ctx context.Context, sentMailID int64, kind Kind, recipient string, now time.Time) error {
	res, err := database.Exec(ctx, "UPDATE sent_mail SET dispatched_at = ? WHERE id = ?", now, sentMailID)
	if err != nil {
		return err
	}
	if updated, err := res.RowsAffected(); err != nil || updated > 0 {
		return err
	}

	recipientKey, domainKey := keys(recipient)
	_, err = database.Exec(ctx,
		"INSERT INTO sent_mail (kind, recipient_key, domain_key, created_at, dispatched_at) VALUES (?, ?, ?, ?, ?)",
		kind, recipientKey, domainKey, now, now,
	)
	return err
}

func dispatchedLastHour(ctx context.Context, now time.Time) (map[Kind]int, error) {
	rows, err := database.Query(ctx,
		"SELECT kind, COUNT(*) FROM sent_mail WHERE dispatched_at > ? GROUP BY kind",
		now.Add(-time.Hour),
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	used := map[Kind]int{}
	for rows.Next() {
		var kind Kind
		var n int
		if err := rows.Scan(&kind, &n); err != nil {
			return nil, err
		}
		used[kind] = n
	}
	return used, rows.Err()
}

func warnBudget(name string, before, after, limit int) {
	threshold := int(math.Ceil(constants.MailBudgetWarnFraction * float64(limit)))
	if before < threshold && after >= threshold {
		log.Printf("[WARN] mail budget %s at %d/%d in the last hour", name, after, limit)
	}
}

func nextKinds(used map[Kind]int) []Kind {
	var kinds []Kind
	for _, kind := range []Kind{KindAccount, KindRegistration} {
		if used[kind] < Budget(kind) {
			kinds = append(kinds, kind)
		}
	}

	slices.SortStableFunc(kinds, func(a, b Kind) int {
		return cmp.Compare(float64(used[a])/float64(Budget(a)), float64(used[b])/float64(Budget(b)))
	})
	return kinds
}

func sendNextMail() {
	ctx := context.Background()
	now := time.Now()

	if _, err := database.Exec(ctx, "DELETE FROM email_queue WHERE attempts >= ?", constants.EmailQueueMaxAttempts); err != nil {
		utils.LogError("sendNextMail", "database.Exec(delete)", err)
	}

	if _, err := database.Exec(ctx,
		"DELETE FROM email_queue WHERE kind = ? AND created_at < ?",
		KindRegistration, now.Add(-constants.PendingRegistrationTTL),
	); err != nil {
		utils.LogError("sendNextMail", "database.Exec(expired)", err)
	}

	used, err := dispatchedLastHour(ctx, now)
	if err != nil {
		utils.LogError("sendNextMail", "dispatchedLastHour", err)
		return
	}

	var (
		id         int
		kind       Kind
		recipient  string
		subject    string
		body       string
		sentMailID int64
	)
	for _, k := range nextKinds(used) {
		err = database.QueryRow(ctx,
			`SELECT id, recipient, subject, body, sent_mail_id
			FROM email_queue
			WHERE kind = ? AND (status = 'pending' OR (status IN ('failed', 'retrying') AND updated_at < ?))
			ORDER BY id
			LIMIT 1`,
			k, now.Add(-constants.EmailQueueStaleThreshold),
		).Scan(&id, &recipient, &subject, &body, &sentMailID)
		if err != sql.ErrNoRows {
			kind = k
			break
		}
	}
	if kind == "" {
		return
	}
	if err != nil {
		utils.LogError("sendNextMail", "QueryRow", err)
		return
	}

	if _, err := database.Exec(ctx, "UPDATE email_queue SET status = 'retrying' WHERE id = ?", id); err != nil {
		utils.LogError("sendNextMail", "database.Exec(retrying)", err)
		return
	}

	if err := send(recipient, subject, body); err != nil {
		if _, uerr := database.Exec(ctx, `
			UPDATE email_queue
			SET status = 'failed', attempts = attempts + 1, last_error = ?
			WHERE id = ?`,
			err.Error(), id,
		); uerr != nil {
			utils.LogError("sendNextMail", "database.Exec(failed)", uerr)
		}
		return
	}

	if err := recordDispatch(ctx, sentMailID, kind, recipient, now); err != nil {
		utils.LogError("sendNextMail", "recordDispatch", err)
	}

	total := 0
	for _, n := range used {
		total += n
	}
	warnBudget(string(kind), used[kind], used[kind]+1, Budget(kind))
	warnBudget("total", total, total+1, constants.MailHourlyLimit)

	if _, err := database.Exec(ctx, "DELETE FROM email_queue WHERE id = ?", id); err != nil {
		utils.LogError("sendNextMail", "database.Exec(delete)", err)
	}
}

// sendMail delivers a single email over SMTP using the configured credentials.
func sendMail(to, subject, body string, contentTypes ...gomail.ContentType) error {
	contentType := gomail.TypeTextPlain
	if len(contentTypes) > 0 {
		contentType = contentTypes[0]
	}

	host := os.Getenv("SMTP_HOST")
	if host == "" {
		return fmt.Errorf("SMTP is not configured")
	}

	port, err := strconv.Atoi(os.Getenv("SMTP_PORT"))
	if err != nil {
		port = gomail.DefaultPort
	}

	username := os.Getenv("SMTP_USERNAME")
	password := os.Getenv("SMTP_PASSWORD")

	from := os.Getenv("SMTP_FROM")
	if from == "" {
		from = username
	}

	msg := gomail.NewMsg()
	if err := msg.From(from); err != nil {
		return err
	}
	if err := msg.To(to); err != nil {
		return err
	}
	msg.Subject(subject)
	msg.SetBodyString(contentType, body)

	opts := []gomail.Option{
		gomail.WithPort(port),
		gomail.WithTLSPolicy(gomail.TLSOpportunistic),
		gomail.WithTimeout(constants.SMTPTimeout),
	}
	if username != "" {
		opts = append(opts,
			gomail.WithSMTPAuth(gomail.SMTPAuthPlain),
			gomail.WithUsername(username),
			gomail.WithPassword(password),
		)
	}

	client, err := gomail.NewClient(host, opts...)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), constants.SMTPTimeout)
	defer cancel()

	return client.DialAndSendWithContext(ctx, msg)
}
