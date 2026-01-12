const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

class DatabaseManager {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
    this.SQL = null;
  }

  async init() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.SQL = await initSqlJs();

    // load existing database if it exists
    if (fs.existsSync(this.dbPath)) {
      const buffer = fs.readFileSync(this.dbPath);
      this.db = new this.SQL.Database(buffer);
    } else {
      this.db = new this.SQL.Database();
    }

    this._createTables();
    logger.info('Database initialized', { path: this.dbPath });
  }

  _createTables() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS files (
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

    this.db.run(`
      CREATE TABLE IF NOT EXISTS sync_checkpoints (
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

    this.db.run(`
      CREATE TABLE IF NOT EXISTS jobs (
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

    this.db.run(`
      CREATE TABLE IF NOT EXISTS dead_letter_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        job_type TEXT,
        payload TEXT,
        error_message TEXT,
        failed_at TEXT
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS tokens (
        user_id TEXT PRIMARY KEY,
        access_token TEXT,
        refresh_token TEXT,
        expiry_date INTEGER,
        updated_at TEXT
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_jobs_scheduled ON jobs(scheduled_at)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_files_parent ON files(parent_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_sync_checkpoints_sync_id ON sync_checkpoints(sync_id)`);
  }

  save() {
    const data = this.db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(this.dbPath, buffer);
  }

  close() {
    if (this.db) {
      this.save();
      this.db.close();
      logger.info('Database connection closed');
    }
  }

  getDb() {
    return this.db;
  }

  // helper for running queries that return results
  query(sql, params = []) {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }

  // helper for running queries that return a single row
  queryOne(sql, params = []) {
    const results = this.query(sql, params);
    return results.length > 0 ? results[0] : null;
  }

  // run a statement
  run(sql, params = []) {
    this.db.run(sql, params);
    this.save();
  }
}

let instance = null;

async function getDatabase(dbPath) {
  if (!instance) {
    instance = new DatabaseManager(dbPath);
    await instance.init();
  }
  return instance;
}

function closeDatabase() {
  if (instance) {
    instance.close();
    instance = null;
  }
}

module.exports = { getDatabase, closeDatabase, DatabaseManager };
