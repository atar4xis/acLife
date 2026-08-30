// Package mail provides a generic, queue-backed email sending system.
package mail

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strconv"
	"time"

	"acLife/constants"
	"acLife/database"
	"acLife/utils"

	gomail "github.com/wneessen/go-mail"
)

func init() {
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

// QueueMail adds an email to the send queue for the background worker to deliver.
func QueueMail(ctx context.Context, db Execer, to, subject, body string) error {
	_, err := db.ExecContext(ctx,
		"INSERT INTO email_queue (recipient, subject, body) VALUES (?, ?, ?)",
		to, subject, body,
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

// processQueue periodically sends queued emails, retrying ones that previously failed.
func processQueue() {
	ticker := time.NewTicker(constants.EmailQueuePollInterval)
	defer ticker.Stop()

	for range ticker.C {
		sendQueuedMails()
	}
}

func sendQueuedMails() {
	ctx := context.Background()

	rows, err := database.Query(ctx,
		`SELECT id, recipient, subject, body, status, updated_at, attempts
		FROM email_queue
		WHERE status IN ('pending', 'failed', 'retrying')`)
	if err != nil {
		utils.LogError("sendQueuedMails", "Query", err)
		return
	}

	type job struct {
		id        int
		recipient string
		subject   string
		body      string
		status    string
		updatedAt time.Time
		attempts  int
	}

	var jobs []job
	for rows.Next() {
		var j job
		if err := rows.Scan(&j.id, &j.recipient, &j.subject, &j.body, &j.status, &j.updatedAt, &j.attempts); err != nil {
			utils.LogError("sendQueuedMails", "Scan", err)
			continue
		}
		jobs = append(jobs, j)
	}
	rows.Close()

	now := time.Now()

	for _, j := range jobs {
		if j.attempts >= constants.EmailQueueMaxAttempts {
			if _, err := database.Exec(ctx, "DELETE FROM email_queue WHERE id = ?", j.id); err != nil {
				utils.LogError("sendQueuedMails", "database.Exec(delete)", err)
			}
			continue
		}

		if j.status == "retrying" && now.Sub(j.updatedAt) < constants.EmailQueueStaleThreshold {
			continue
		}

		if _, err := database.Exec(ctx, "UPDATE email_queue SET status = 'retrying' WHERE id = ?", j.id); err != nil {
			utils.LogError("sendQueuedMails", "database.Exec(retrying)", err)
			continue
		}

		if err := sendMail(j.recipient, j.subject, j.body); err != nil {
			if _, uerr := database.Exec(ctx, `
				UPDATE email_queue
				SET status = 'failed', attempts = attempts + 1, last_error = ?
				WHERE id = ?`,
				err.Error(), j.id,
			); uerr != nil {
				utils.LogError("sendQueuedMails", "database.Exec(failed)", uerr)
			}
			continue
		}

		if _, err := database.Exec(ctx, "DELETE FROM email_queue WHERE id = ?", j.id); err != nil {
			utils.LogError("sendQueuedMails", "database.Exec(delete)", err)
		}
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
