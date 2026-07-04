CREATE TABLE IF NOT EXISTS users (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(30) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  nickname      VARCHAR(30) NOT NULL,
  birth_year    SMALLINT NULL,
  gender        ENUM('m','f') NULL,
  height_cm     DECIMAL(4,1) NULL,
  goal_weight   DECIMAL(4,1) NULL,
  goal_text     VARCHAR(100) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  token      CHAR(64) PRIMARY KEY,
  user_id    BIGINT NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sessions_user (user_id)
);

CREATE TABLE IF NOT EXISTS workout_sets (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT NOT NULL,
  date       CHAR(10) NOT NULL,
  exercise   VARCHAR(50) NOT NULL,
  weight     DECIMAL(5,1) NOT NULL DEFAULT 0,
  reps       SMALLINT NOT NULL,
  set_no     SMALLINT NOT NULL,
  client_id  VARCHAR(40) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sets_client (user_id, client_id),
  INDEX idx_sets_user_date (user_id, date)
);

CREATE TABLE IF NOT EXISTS body_metrics (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id      BIGINT NOT NULL,
  date         CHAR(10) NOT NULL,
  weight       DECIMAL(4,1) NULL,
  body_fat_pct DECIMAL(3,1) NULL,
  muscle_mass  DECIMAL(4,1) NULL,
  UNIQUE KEY uq_body_user_date (user_id, date)
);
