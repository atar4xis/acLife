CREATE TABLE IF NOT EXISTS user_keys (
    owner CHAR(36) NOT NULL PRIMARY KEY,
    public_key VARBINARY(128) NOT NULL,
    wrapped_private VARBINARY(512) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner) REFERENCES users(uuid) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS share_spaces (
    id CHAR(36) NOT NULL PRIMARY KEY,
    owner CHAR(36) NOT NULL,
    kind VARCHAR(8) NOT NULL,
    scope VARCHAR(10) NOT NULL,
    owner_key VARBINARY(256) NOT NULL,
    key_version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner) REFERENCES users(uuid) ON DELETE CASCADE,
    INDEX idx_owner (owner)
);

CREATE TABLE IF NOT EXISTS share_members (
    space CHAR(36) NOT NULL,
    user CHAR(36) NOT NULL,
    permission VARCHAR(5) NOT NULL,
    wrapped_key VARBINARY(256) NOT NULL,
    key_version INT NOT NULL DEFAULT 1,
    status VARCHAR(8) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (space, user),
    INDEX idx_user (user),
    FOREIGN KEY (space) REFERENCES share_spaces(id) ON DELETE CASCADE,
    FOREIGN KEY (user) REFERENCES users(uuid) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS share_records (
    space CHAR(36) NOT NULL,
    id CHAR(36) NOT NULL,
    data MEDIUMBLOB NOT NULL,
    updated_at TIMESTAMP(3) NOT NULL,
    PRIMARY KEY (space, id),
    INDEX idx_space_sync (space, id, updated_at),
    FOREIGN KEY (space) REFERENCES share_spaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS share_record_buckets (
    space CHAR(36) NOT NULL,
    record_id CHAR(36) NOT NULL,
    bucket_id BINARY(32) NOT NULL,
    PRIMARY KEY (space, record_id, bucket_id),
    INDEX idx_space_bucket (space, bucket_id),
    FOREIGN KEY (space, record_id) REFERENCES share_records(space, id) ON DELETE CASCADE
);

ALTER TABLE user_storage ADD COLUMN shared_bytes BIGINT NOT NULL DEFAULT 0;

SET @fk = (SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'calendar_event_buckets' AND COLUMN_NAME = 'event_id' AND REFERENCED_TABLE_NAME = 'calendar_events' LIMIT 1);
SET @drop = CONCAT('ALTER TABLE calendar_event_buckets DROP FOREIGN KEY ', @fk);
PREPARE drop_buckets_fk FROM @drop;
EXECUTE drop_buckets_fk;
DEALLOCATE PREPARE drop_buckets_fk;

SET @fk = (SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'scheduled_notifications' AND COLUMN_NAME = 'event_id' AND REFERENCED_TABLE_NAME = 'calendar_events' LIMIT 1);
SET @drop = CONCAT('ALTER TABLE scheduled_notifications DROP FOREIGN KEY ', @fk);
PREPARE drop_notifications_fk FROM @drop;
EXECUTE drop_notifications_fk;
DEALLOCATE PREPARE drop_notifications_fk;

ALTER TABLE calendar_events DROP PRIMARY KEY, ADD PRIMARY KEY (owner, id);
ALTER TABLE journal_items DROP PRIMARY KEY, ADD PRIMARY KEY (owner, id);

ALTER TABLE calendar_event_buckets ADD COLUMN owner CHAR(36) NULL FIRST;
UPDATE calendar_event_buckets ceb JOIN calendar_events ce ON ce.id = ceb.event_id SET ceb.owner = ce.owner;
ALTER TABLE calendar_event_buckets
    MODIFY owner CHAR(36) NOT NULL,
    DROP PRIMARY KEY,
    ADD PRIMARY KEY (owner, event_id, bucket_id),
    ADD CONSTRAINT calendar_event_buckets_owner_event_fk FOREIGN KEY (owner, event_id) REFERENCES calendar_events(owner, id) ON DELETE CASCADE;

ALTER TABLE scheduled_notifications
    ADD CONSTRAINT scheduled_notifications_owner_event_fk FOREIGN KEY (owner, event_id) REFERENCES calendar_events(owner, id) ON DELETE CASCADE;
