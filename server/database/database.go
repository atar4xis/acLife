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
	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/mysql"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/jmoiron/sqlx"
)

var (
	DB *sqlx.DB

	dbUser     = os.Getenv("DB_USER")
	dbPassword = os.Getenv("DB_PASSWORD")
	dbHost     = os.Getenv("DB_HOST")
	dbPort     = os.Getenv("DB_PORT")
	dbName     = os.Getenv("DB_NAME")
)

func Connect() error {
	dsn := fmt.Sprintf(
		"%s:%s@tcp(%s:%s)/%s?parseTime=true&charset=utf8mb4",
		dbUser,
		dbPassword,
		dbHost,
		dbPort,
		dbName,
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
		dbUser,
		dbPassword,
		dbHost,
		dbPort,
		dbName,
	)

	// Run database migrations
	m, err := migrate.New("file://database/migrations", migrationDSN)
	if err != nil {
		utils.LogError("Setup", "migrate.New", err)
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
