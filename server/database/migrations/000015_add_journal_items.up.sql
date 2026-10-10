CREATE TABLE IF NOT EXISTS journal_items (
    id CHAR(36) NOT NULL PRIMARY KEY,
    owner CHAR(36) NOT NULL,
    data MEDIUMBLOB NOT NULL,
    updated_at TIMESTAMP(3) NOT NULL,
    FOREIGN KEY (owner) REFERENCES users(uuid) ON DELETE CASCADE,
    INDEX idx_owner_sync (owner, id, updated_at)
);
