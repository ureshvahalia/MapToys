import type { Database } from './connection';

export function initDb(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS collections (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      description TEXT    NOT NULL DEFAULT '',
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      artifact_type       TEXT    NOT NULL,
      latitude            REAL    NOT NULL,
      longitude           REAL    NOT NULL,
      timestamp           TEXT    NOT NULL,
      timestamp_precision TEXT    NOT NULL DEFAULT 'second',
      title               TEXT    NOT NULL DEFAULT '',
      description         TEXT    NOT NULL DEFAULT '',
      tags                TEXT    NOT NULL DEFAULT '[]',
      collection_id       INTEGER REFERENCES collections(id)
    );

    CREATE TABLE IF NOT EXISTS photos (
      artifact_id    INTEGER PRIMARY KEY REFERENCES artifacts(id) ON DELETE CASCADE,
      file_path      TEXT    NOT NULL,
      thumbnail_path TEXT,
      width          INTEGER,
      height         INTEGER,
      camera_make    TEXT,
      camera_model   TEXT,
      exif_json      TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_artifacts_latlon
      ON artifacts (latitude, longitude);
    CREATE INDEX IF NOT EXISTS idx_artifacts_timestamp
      ON artifacts (timestamp);
    CREATE INDEX IF NOT EXISTS idx_artifacts_collection
      ON artifacts (collection_id);
  `);
}
