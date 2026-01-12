class TokenRepository {
  constructor(dbManager) {
    this.dbManager = dbManager;
  }

  save(userId, tokens) {
    const now = new Date().toISOString();

    const existing = this.dbManager.queryOne(
      'SELECT user_id FROM tokens WHERE user_id = ?',
      [userId]
    );

    if (existing) {
      this.dbManager.run(`
        UPDATE tokens SET
          access_token = ?,
          refresh_token = COALESCE(?, refresh_token),
          expiry_date = ?,
          updated_at = ?
        WHERE user_id = ?
      `, [
        tokens.access_token,
        tokens.refresh_token,
        tokens.expiry_date,
        now,
        userId
      ]);
    } else {
      this.dbManager.run(`
        INSERT INTO tokens (user_id, access_token, refresh_token, expiry_date, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `, [
        userId,
        tokens.access_token,
        tokens.refresh_token,
        tokens.expiry_date,
        now
      ]);
    }
  }

  findByUserId(userId) {
    const row = this.dbManager.queryOne(
      'SELECT * FROM tokens WHERE user_id = ?',
      [userId]
    );
    if (!row) return null;

    return {
      access_token: row.access_token,
      refresh_token: row.refresh_token,
      expiry_date: row.expiry_date
    };
  }

  delete(userId) {
    this.dbManager.run('DELETE FROM tokens WHERE user_id = ?', [userId]);
    return 1;
  }
}

module.exports = TokenRepository;
