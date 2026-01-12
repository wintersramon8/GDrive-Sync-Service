const initSqlJs = require('sql.js');

async function createTestDb() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  db.run(`
    CREATE TABLE files (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER,
      parent_id TEXT,
      modified_time TEXT,
      created_time TEXT,
      md5_checksum TEXT,
      synced_at TEXT,
      raw_metadata TEXT
    )
  `);

  db.run(`
    CREATE TABLE sync_checkpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_id TEXT NOT NULL,
      page_token TEXT,
      files_processed INTEGER DEFAULT 0,
      status TEXT DEFAULT 'in_progress',
      started_at TEXT,
      updated_at TEXT,
      completed_at TEXT,
      error_message TEXT
    )
  `);

  db.run(`
    CREATE TABLE jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      payload TEXT,
      status TEXT DEFAULT 'pending',
      priority INTEGER DEFAULT 0,
      attempts INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 5,
      last_error TEXT,
      created_at TEXT,
      updated_at TEXT,
      scheduled_at TEXT,
      started_at TEXT,
      completed_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE dead_letter_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      job_type TEXT,
      payload TEXT,
      error_message TEXT,
      failed_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE tokens (
      user_id TEXT PRIMARY KEY,
      access_token TEXT,
      refresh_token TEXT,
      expiry_date INTEGER,
      updated_at TEXT
    )
  `);

  // create a mock dbManager that mimics the DatabaseManager interface
  const dbManager = {
    db,
    query(sql, params = []) {
      const stmt = db.prepare(sql);
      stmt.bind(params);
      const results = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      stmt.free();
      return results;
    },
    queryOne(sql, params = []) {
      const results = this.query(sql, params);
      return results.length > 0 ? results[0] : null;
    },
    run(sql, params = []) {
      db.run(sql, params);
    },
    close() {
      db.close();
    }
  };

  return dbManager;
}

module.exports = { createTestDb };
