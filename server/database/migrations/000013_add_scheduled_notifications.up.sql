CREATE TABLE IF NOT EXISTS scheduled_notifications (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    owner CHAR(36) NOT NULL,
    event_id CHAR(36) NOT NULL,
    subscription_id INT NULL,
    fire_at BIGINT NOT NULL,
    FOREIGN KEY (owner) REFERENCES users(uuid) ON DELETE CASCADE,
    FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE CASCADE,
    FOREIGN KEY (subscription_id) REFERENCES push_subscriptions(id) ON DELETE CASCADE,
    INDEX idx_fire_at (fire_at),
    INDEX idx_owner_event (owner, event_id)
);
