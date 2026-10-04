// Package database provides database connection and management functions.
package database

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"

	"acLife/constants"
	"acLife/utils"

	_ "github.com/go-sql-driver/mysql"
	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/mysql"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/jmoiron/sqlx"
)

//go:embed migrations/*.sql
var migrations embed.FS

var DB *sqlx.DB

func Connect() error {
	// time_zone pins every connection to UTC: the driver reads and writes UTC wall times, so DB-side defaults like CURRENT_TIMESTAMP must agree
	dsn := fmt.Sprintf(
		"%s:%s@tcp(%s:%s)/%s?parseTime=true&charset=utf8mb4&time_zone=%%27%%2B00%%3A00%%27",
		os.Getenv("DB_USER"),
		os.Getenv("DB_PASSWORD"),
		os.Getenv("DB_HOST"),
		os.Getenv("DB_PORT"),
		os.Getenv("DB_NAME"),
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
	migrationDSN := fmt.Sprintf(
		"mysql://%s:%s@tcp(%s:%s)/%s",
		url.QueryEscape(os.Getenv("DB_USER")),
		url.QueryEscape(os.Getenv("DB_PASSWORD")),
		os.Getenv("DB_HOST"),
		os.Getenv("DB_PORT"),
		os.Getenv("DB_NAME"),
	)

	src, err := iofs.New(migrations, "migrations")
	if err != nil {
		utils.LogError("Setup", "iofs.New", err)
		return err
	}

	m, err := migrate.NewWithSourceInstance("iofs", src, migrationDSN)
	if err != nil {
		utils.LogError("Setup", "migrate.NewWithSourceInstance", err)
		return err
	}
	defer m.Close()

	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		utils.LogError("Setup", "migrate.Up", err)
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
