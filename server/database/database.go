// Package database provides database connection and management functions.
package database

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"strings"

	"acLife/constants"
	"acLife/utils"

	_ "github.com/go-sql-driver/mysql"
	"github.com/jmoiron/sqlx"
)

var DB *sqlx.DB

func Connect() error {
	user := os.Getenv("DB_USER")
	password := os.Getenv("DB_PASSWORD")
	host := os.Getenv("DB_HOST")
	port := os.Getenv("DB_PORT")
	name := os.Getenv("DB_NAME")

	dsn := fmt.Sprintf(
		"%s:%s@tcp(%s:%s)/%s?parseTime=true&charset=utf8mb4",
		user,
		password,
		host,
		port,
		name,
	)

	db, err := sqlx.Open("mysql", dsn)
	if err != nil {
		return err
	}

	if err := db.Ping(); err != nil {
		return err
	}

	DB = db

	DB.SetMaxOpenConns(constants.DBMaxOpenConns)
	DB.SetMaxIdleConns(constants.DBMaxIdleConns)
	DB.SetConnMaxLifetime(constants.DBConnMaxLifetime)

	return nil
}

func Setup() error {
	ctx, cancel := context.WithTimeout(context.Background(), constants.DBTimeout)
	defer cancel()

	// Create users table
	userTable := `
	CREATE TABLE IF NOT EXISTS users (
		id INT AUTO_INCREMENT PRIMARY KEY,
		uuid CHAR(36) NOT NULL DEFAULT UUID() UNIQUE,
		email VARCHAR(255) NOT NULL UNIQUE,
		salt BINARY(16) NOT NULL,
		srp_salt BINARY(16) NOT NULL,
		verifier VARBINARY(512) NOT NULL,
		challenge VARBINARY(64) NOT NULL,
		stripe_customer_id VARCHAR(255),
		stripe_subscription_id VARCHAR(255) UNIQUE,
		subscription_status VARCHAR(50)
	);`

	if _, err := Exec(ctx, userTable); err != nil {
		utils.LogError("Setup", "Exec(users)", err)
		return err
	}

	// Create account_sessions table
	sessionsTable := `
	CREATE TABLE IF NOT EXISTS account_sessions (
		id INT AUTO_INCREMENT PRIMARY KEY,
		owner CHAR(36) NOT NULL,
		access_token VARCHAR(64) NOT NULL UNIQUE,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		expires_at DATETIME NOT NULL,
		FOREIGN KEY (owner) REFERENCES users(uuid) ON DELETE CASCADE,
		INDEX idx_access_token (access_token)
	);`

	if _, err := Exec(ctx, sessionsTable); err != nil {
		utils.LogError("Setup", "Exec(account_sessions)", err)
		return err
	}

	// Create push_subscriptions table
	pushTable := `
	CREATE TABLE IF NOT EXISTS push_subscriptions (
		id INT AUTO_INCREMENT PRIMARY KEY,
		owner CHAR(36) NOT NULL,
		endpoint VARCHAR(1024) NOT NULL UNIQUE,
		p256dh VARCHAR(255) NOT NULL,
		auth VARCHAR(255) NOT NULL,
		FOREIGN KEY (owner) REFERENCES users(uuid) ON DELETE CASCADE
	);`

	if _, err := Exec(ctx, pushTable); err != nil {
		utils.LogError("Setup", "Exec(push_subscriptions)", err)
		return err
	}

	// Create calendar_events table
	calendarTable := `
	CREATE TABLE IF NOT EXISTS calendar_events (
		id CHAR(36) NOT NULL PRIMARY KEY,
		owner CHAR(36) NOT NULL,
		data BLOB NOT NULL,
		updated_at TIMESTAMP(3) NOT NULL,
		FOREIGN KEY (owner) REFERENCES users(uuid) ON DELETE CASCADE,
		INDEX idx_owner (owner)
	);`

	if _, err := Exec(ctx, calendarTable); err != nil {
		utils.LogError("Setup", "Exec(calendar_events)", err)
		return err
	}

	return nil
}

func Exec(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return DB.ExecContext(ctx, query, args...)
}

func QueryRow(ctx context.Context, query string, args ...any) *sql.Row {
	return DB.QueryRowContext(ctx, query, args...)
}

func Query(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return DB.QueryContext(ctx, query, args...)
}

func Rebind(query string) string {
	return DB.Rebind(query)
}

func In(query string, args ...any) (string, []any, error) {
	return sqlx.In(query, args...)
}

// IsDuplicateEntry checks if the error is a SQL unique constraint violation.
func IsDuplicateEntry(err error) bool {
	if err == nil {
		return false
	}

	if errors.Is(err, sql.ErrNoRows) {
		return false
	}

	msg := err.Error()
	return strings.Contains(msg, "Duplicate entry")
}
