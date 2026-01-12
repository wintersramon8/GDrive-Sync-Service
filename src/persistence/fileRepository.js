const logger = require('../utils/logger');

class FileRepository {
  constructor(dbManager) {
    this.dbManager = dbManager;
  }

  upsert(file) {
    const now = new Date().toISOString();

    // check if exists
    const existing = this.dbManager.queryOne('SELECT id FROM files WHERE id = ?', [file.id]);

    if (existing) {
      this.dbManager.run(`
        UPDATE files SET
          name = ?, mime_type = ?, size = ?, parent_id = ?,
          modified_time = ?, md5_checksum = ?, synced_at = ?, raw_metadata = ?
        WHERE id = ?
      `, [
        file.name,
        file.mimeType || null,
        file.size || null,
        file.parents?.[0] || null,
        file.modifiedTime || null,
        file.md5Checksum || null,
        now,
        JSON.stringify(file),
        file.id
      ]);
    } else {
      this.dbManager.run(`
        INSERT INTO files (id, name, mime_type, size, parent_id, modified_time, created_time, md5_checksum, synced_at, raw_metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        file.id,
        file.name,
        file.mimeType || null,
        file.size || null,
        file.parents?.[0] || null,
        file.modifiedTime || null,
        file.createdTime || null,
        file.md5Checksum || null,
        now,
        JSON.stringify(file)
      ]);
    }
  }

  upsertBatch(files) {
    for (const file of files) {
      this.upsert(file);
    }
    logger.debug(`Upserted ${files.length} files`);
  }

  findById(id) {
    const row = this.dbManager.queryOne('SELECT * FROM files WHERE id = ?', [id]);
    return row ? this._mapRow(row) : null;
  }

  findByParentId(parentId) {
    const rows = this.dbManager.query('SELECT * FROM files WHERE parent_id = ?', [parentId]);
    return rows.map(r => this._mapRow(r));
  }

  getAll(limit = 1000, offset = 0) {
    const rows = this.dbManager.query(
      'SELECT * FROM files ORDER BY modified_time DESC LIMIT ? OFFSET ?',
      [limit, offset]
    );
    return rows.map(r => this._mapRow(r));
  }

  count() {
    const result = this.dbManager.queryOne('SELECT COUNT(*) as count FROM files', []);
    return result ? result.count : 0;
  }

  deleteById(id) {
    const before = this.count();
    this.dbManager.run('DELETE FROM files WHERE id = ?', [id]);
    const after = this.count();
    return before - after;
  }

  _mapRow(row) {
    return {
      id: row.id,
      name: row.name,
      mimeType: row.mime_type,
      size: row.size,
      parentId: row.parent_id,
      modifiedTime: row.modified_time,
      createdTime: row.created_time,
      md5Checksum: row.md5_checksum,
      syncedAt: row.synced_at,
      rawMetadata: row.raw_metadata ? JSON.parse(row.raw_metadata) : null
    };
  }
}

module.exports = FileRepository;
