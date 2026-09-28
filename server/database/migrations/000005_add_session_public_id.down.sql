ALTER TABLE account_sessions DROP INDEX idx_public_id;

ALTER TABLE account_sessions DROP COLUMN public_id;
