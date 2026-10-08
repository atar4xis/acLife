CREATE TABLE IF NOT EXISTS user_storage (
    owner CHAR(36) NOT NULL PRIMARY KEY,
    event_bytes BIGINT NOT NULL DEFAULT -1,
    max_bytes BIGINT NULL,
    FOREIGN KEY (owner) REFERENCES users(uuid) ON DELETE CASCADE
);
