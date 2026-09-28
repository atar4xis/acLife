ALTER TABLE account_sessions ADD COLUMN public_id CHAR(36) NULL;

UPDATE account_sessions SET public_id = UUID() WHERE public_id IS NULL;

ALTER TABLE account_sessions MODIFY COLUMN public_id CHAR(36) NOT NULL DEFAULT UUID();

ALTER TABLE account_sessions ADD UNIQUE INDEX idx_public_id (public_id);
