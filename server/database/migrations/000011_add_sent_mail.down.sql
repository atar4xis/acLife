ALTER TABLE email_queue
    DROP INDEX idx_kind_status,
    DROP COLUMN sent_mail_id,
    DROP COLUMN kind;

DROP TABLE IF EXISTS sent_mail;
