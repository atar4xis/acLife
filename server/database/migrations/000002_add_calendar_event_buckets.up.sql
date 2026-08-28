CREATE TABLE IF NOT EXISTS calendar_event_buckets (
    event_id CHAR(36) NOT NULL,
    bucket_id BINARY(32) NOT NULL,
    PRIMARY KEY (event_id, bucket_id),
    INDEX idx_bucket_id (bucket_id),
    FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE CASCADE
);
