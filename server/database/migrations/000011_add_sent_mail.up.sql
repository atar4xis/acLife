CREATE TABLE IF NOT EXISTS sent_mail (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    kind ENUM('registration', 'account') NOT NULL,
    recipient_key CHAR(64) NOT NULL,
    domain_key CHAR(64) NOT NULL DEFAULT '',
    created_at DATETIME(3) NOT NULL,
    dispatched_at DATETIME(3) NULL,
    INDEX idx_sent_mail_recipient (recipient_key, created_at),
    INDEX idx_sent_mail_domain (domain_key, created_at),
    INDEX idx_sent_mail_dispatched (dispatched_at, kind)
);

ALTER TABLE email_queue
    ADD COLUMN kind ENUM('registration', 'account') NOT NULL DEFAULT 'account',
    ADD COLUMN sent_mail_id BIGINT NOT NULL DEFAULT 0,
    ADD INDEX idx_kind_status (kind, status);
