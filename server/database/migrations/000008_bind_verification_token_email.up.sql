ALTER TABLE email_verification_tokens ADD COLUMN email VARCHAR(255) NULL;

UPDATE email_verification_tokens t JOIN users u ON u.uuid = t.owner SET t.email = u.email;

ALTER TABLE email_verification_tokens MODIFY COLUMN email VARCHAR(255) NOT NULL;
