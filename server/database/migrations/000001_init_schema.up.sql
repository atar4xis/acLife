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
);

CREATE TABLE IF NOT EXISTS account_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    owner CHAR(36) NOT NULL,
    access_token VARCHAR(64) NOT NULL UNIQUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    FOREIGN KEY (owner) REFERENCES users(uuid) ON DELETE CASCADE,
    INDEX idx_access_token (access_token)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    owner CHAR(36) NOT NULL,
    endpoint VARCHAR(1024) NOT NULL UNIQUE,
    p256dh VARCHAR(255) NOT NULL,
    auth VARCHAR(255) NOT NULL,
    FOREIGN KEY (owner) REFERENCES users(uuid) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS calendar_events (
    id CHAR(36) NOT NULL PRIMARY KEY,
    owner CHAR(36) NOT NULL,
    data BLOB NOT NULL,
    updated_at TIMESTAMP(3) NOT NULL,
    FOREIGN KEY (owner) REFERENCES users(uuid) ON DELETE CASCADE,
    INDEX idx_owner (owner)
);
