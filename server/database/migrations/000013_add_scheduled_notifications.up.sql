SET @owner_collation = (SELECT collation_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'uuid');
SET @event_collation = (SELECT collation_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'calendar_events' AND column_name = 'id');
SET @ddl = CONCAT('CREATE TABLE IF NOT EXISTS scheduled_notifications (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    owner CHAR(36) CHARACTER SET utf8mb4 COLLATE ', @owner_collation, ' NOT NULL,
    event_id CHAR(36) CHARACTER SET utf8mb4 COLLATE ', @event_collation, ' NOT NULL,
    subscription_id INT NULL,
    fire_at BIGINT NOT NULL,
    FOREIGN KEY (owner) REFERENCES users(uuid) ON DELETE CASCADE,
    FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE CASCADE,
    FOREIGN KEY (subscription_id) REFERENCES push_subscriptions(id) ON DELETE CASCADE,
    INDEX idx_fire_at (fire_at),
    INDEX idx_owner_event (owner, event_id)
)');
PREPARE ddl FROM @ddl;
EXECUTE ddl;
DEALLOCATE PREPARE ddl;
