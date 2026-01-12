const { google } = require('googleapis');
const logger = require('../utils/logger');
const config = require('../config');

class RateLimitError extends Error {
  constructor(retryAfter) {
    super('Rate limit exceeded');
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

class DriveClient {
  constructor(authClient) {
    this.auth = authClient;
    this.drive = google.drive({ version: 'v3', auth: authClient.getClient() });
    this.requestCount = 0;
    this.lastRequestTime = 0;
  }

  async listFiles(options = {}) {
    const params = {
      pageSize: options.pageSize || config.sync.pageSize,
      fields: 'nextPageToken, files(id, name, mimeType, size, parents, modifiedTime, createdTime, md5Checksum, trashed)',
      orderBy: 'modifiedTime desc',
      q: options.query || "trashed = false"
    };

    if (options.pageToken) {
      params.pageToken = options.pageToken;
    }

    return this._executeWithRetry(() => this.drive.files.list(params));
  }

  async getFile(fileId, fields = 'id, name, mimeType, size, parents, modifiedTime') {
    return this._executeWithRetry(() =>
      this.drive.files.get({ fileId, fields })
    );
  }

  async downloadFile(fileId) {
    return this._executeWithRetry(() =>
      this.drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'stream' }
      )
    );
  }

  async getChanges(pageToken, options = {}) {
    const params = {
      pageToken,
      pageSize: options.pageSize || config.sync.pageSize,
      fields: 'nextPageToken, newStartPageToken, changes(fileId, removed, file(id, name, mimeType, size, parents, modifiedTime, trashed))'
    };

    return this._executeWithRetry(() => this.drive.changes.list(params));
  }

  async getStartPageToken() {
    const res = await this._executeWithRetry(() =>
      this.drive.changes.getStartPageToken({})
    );
    return res.data.startPageToken;
  }

  async _executeWithRetry(fn, maxRetries = config.sync.maxRetries) {
    let lastError;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await this._throttle();
        const result = await fn();
        return result;
      } catch (err) {
        lastError = err;

        if (err.code === 429 || err.code === 403) {
          const retryAfter = this._parseRetryAfter(err);
          logger.warn('Rate limited, backing off', {
            attempt: attempt + 1,
            retryAfter
          });

          if (attempt < maxRetries - 1) {
            await this._sleep(retryAfter);
            continue;
          }
          throw new RateLimitError(retryAfter);
        }

        if (err.code >= 500 && attempt < maxRetries - 1) {
          const delay = this._calculateBackoff(attempt);
          logger.warn('Server error, retrying', { attempt: attempt + 1, delay });
          await this._sleep(delay);
          continue;
        }

        throw err;
      }
    }

    throw lastError;
  }

  _parseRetryAfter(err) {
    // try to get retry-after from response headers
    const retryHeader = err.response?.headers?.['retry-after'];
    if (retryHeader) {
      const seconds = parseInt(retryHeader, 10);
      if (!isNaN(seconds)) {
        return seconds * 1000;
      }
    }
    // default exponential backoff
    return config.sync.retryDelayMs * 2;
  }

  _calculateBackoff(attempt) {
    const base = config.sync.retryDelayMs;
    const maxDelay = 60000;
    const delay = Math.min(base * Math.pow(2, attempt), maxDelay);
    // add some jitter
    return delay + Math.random() * 1000;
  }

  async _throttle() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    const minInterval = 100; // minimum 100ms between requests

    if (timeSinceLastRequest < minInterval) {
      await this._sleep(minInterval - timeSinceLastRequest);
    }

    this.lastRequestTime = Date.now();
    this.requestCount++;
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getRequestCount() {
    return this.requestCount;
  }
}

module.exports = { DriveClient, RateLimitError };
