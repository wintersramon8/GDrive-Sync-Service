require('dotenv').config();

module.exports = {
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/callback',
    scopes: [
      'https://www.googleapis.com/auth/drive.metadata.readonly',
      'https://www.googleapis.com/auth/drive.readonly'
    ]
  },
  server: {
    port: parseInt(process.env.PORT, 10) || 3000,
    env: process.env.NODE_ENV || 'development'
  },
  sync: {
    concurrency: parseInt(process.env.SYNC_CONCURRENCY, 10) || 3,
    pageSize: parseInt(process.env.SYNC_PAGE_SIZE, 10) || 100,
    maxRetries: parseInt(process.env.MAX_RETRIES, 10) || 5,
    retryDelayMs: parseInt(process.env.RETRY_DELAY_MS, 10) || 1000
  },
  db: {
    path: process.env.DB_PATH || './data/sync.db'
  }
};
