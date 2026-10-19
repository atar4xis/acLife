ALTER TABLE scheduled_notifications DROP FOREIGN KEY scheduled_notifications_owner_event_fk;
ALTER TABLE calendar_event_buckets DROP FOREIGN KEY calendar_event_buckets_owner_event_fk;

ALTER TABLE calendar_events DROP PRIMARY KEY, ADD PRIMARY KEY (id);
ALTER TABLE journal_items DROP PRIMARY KEY, ADD PRIMARY KEY (id);

ALTER TABLE calendar_event_buckets
    DROP PRIMARY KEY,
    ADD PRIMARY KEY (event_id, bucket_id),
    DROP COLUMN owner,
    ADD CONSTRAINT calendar_event_buckets_ibfk_1 FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE CASCADE;

ALTER TABLE scheduled_notifications
    ADD CONSTRAINT scheduled_notifications_ibfk_2 FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE CASCADE;

ALTER TABLE user_storage DROP COLUMN shared_bytes;
DROP TABLE IF EXISTS share_record_buckets;
DROP TABLE IF EXISTS share_records;
DROP TABLE IF EXISTS share_members;
DROP TABLE IF EXISTS share_spaces;
DROP TABLE IF EXISTS user_keys;
