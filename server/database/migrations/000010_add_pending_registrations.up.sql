CREATE TABLE IF NOT EXISTS pending_registrations (
    token_hash CHAR(64) NOT NULL PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    INDEX idx_pending_registrations_email (email, created_at)
);
