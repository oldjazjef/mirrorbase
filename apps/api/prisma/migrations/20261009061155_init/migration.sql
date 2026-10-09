-- CreateTable
CREATE TABLE "connection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "plugin_id" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "secrets" TEXT NOT NULL DEFAULT '{}',
    "docker_name" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "last_used_at" DATETIME,
    CONSTRAINT "connection_name_check" CHECK (length("name") BETWEEN 1 AND 80 AND trim("name") <> ''),
    CONSTRAINT "connection_plugin_id_check" CHECK (trim("plugin_id") <> ''),
    CONSTRAINT "connection_config_check" CHECK (json_valid("config") AND json_type("config") = 'object'),
    CONSTRAINT "connection_secrets_check" CHECK (json_valid("secrets") AND json_type("secrets") = 'object')
);

-- CreateTable
CREATE TABLE "run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "source_connection_id" TEXT,
    "target_connection_id" TEXT,
    "source_name" TEXT NOT NULL,
    "target_name" TEXT NOT NULL,
    "source_plugin_id" TEXT NOT NULL,
    "target_plugin_id" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "replace_existing" BOOLEAN NOT NULL DEFAULT false,
    "databases" TEXT NOT NULL DEFAULT '[]',
    "error" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" DATETIME,
    "finished_at" DATETIME,
    CONSTRAINT "run_status_check" CHECK ("status" IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
    CONSTRAINT "run_strategy_check" CHECK ("strategy" IN ('native', 'interchange')),
    CONSTRAINT "run_databases_check" CHECK (json_valid("databases") AND json_type("databases") = 'array'),
    CONSTRAINT "run_source_connection_id_fkey" FOREIGN KEY ("source_connection_id") REFERENCES "connection" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "run_target_connection_id_fkey" FOREIGN KEY ("target_connection_id") REFERENCES "connection" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "log_entry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "run_id" TEXT,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "log_entry_level_check" CHECK ("level" IN ('debug', 'info', 'warn', 'error')),
    CONSTRAINT "log_entry_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "run" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "app_pin" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "pin_hash" TEXT NOT NULL,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" DATETIME,
    "auto_lock_minutes" INTEGER NOT NULL DEFAULT 15,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "app_pin_singleton_check" CHECK ("id" = 1),
    CONSTRAINT "app_pin_hash_check" CHECK ("pin_hash" LIKE 'scrypt$%'),
    CONSTRAINT "app_pin_counters_check" CHECK ("failed_attempts" >= 0),
    CONSTRAINT "app_pin_auto_lock_check" CHECK ("auto_lock_minutes" BETWEEN 1 AND 240)
);

-- CreateIndex
CREATE UNIQUE INDEX "connection_name_key" ON "connection"("name");

-- CreateIndex
CREATE INDEX "connection_plugin_id_idx" ON "connection"("plugin_id");

-- CreateIndex
CREATE INDEX "run_created_at_idx" ON "run"("created_at");

-- CreateIndex
CREATE INDEX "log_entry_run_id_id_idx" ON "log_entry"("run_id", "id");

-- CreateIndex
CREATE INDEX "log_entry_at_idx" ON "log_entry"("at");
