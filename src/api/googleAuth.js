const { google } = require('googleapis');
const config = require('../config');
const logger = require('../utils/logger');

class GoogleAuthClient {
  constructor(tokenRepository) {
    this.tokenRepo = tokenRepository;
    this.oauth2Client = new google.auth.OAuth2(
      config.google.clientId,
      config.google.clientSecret,
      config.google.redirectUri
    );

    this.oauth2Client.on('tokens', (tokens) => {
      if (tokens.refresh_token) {
        logger.debug('New refresh token received');
      }
    });
  }

  getAuthUrl(state = null) {
    const params = {
      access_type: 'offline',
      scope: config.google.scopes,
      prompt: 'consent'
    };
    if (state) {
      params.state = state;
    }
    return this.oauth2Client.generateAuthUrl(params);
  }

  async handleCallback(code, userId = 'default') {
    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);
    this.tokenRepo.save(userId, tokens);
    logger.info('User authenticated successfully', { userId });
    return tokens;
  }

  async loadCredentials(userId = 'default') {
    const tokens = this.tokenRepo.findByUserId(userId);
    if (!tokens) {
      return false;
    }

    this.oauth2Client.setCredentials(tokens);

    // check if token needs refresh
    if (this._isTokenExpired(tokens)) {
      try {
        const { credentials } = await this.oauth2Client.refreshAccessToken();
        this.tokenRepo.save(userId, credentials);
        logger.debug('Token refreshed', { userId });
      } catch (err) {
        logger.error('Failed to refresh token', { userId, error: err.message });
        return false;
      }
    }

    return true;
  }

  _isTokenExpired(tokens) {
    if (!tokens.expiry_date) return false;
    // refresh 5 min before expiry
    return Date.now() >= tokens.expiry_date - 300000;
  }

  getClient() {
    return this.oauth2Client;
  }

  isAuthenticated() {
    return !!this.oauth2Client.credentials?.access_token;
  }

  async revokeAccess(userId = 'default') {
    try {
      await this.oauth2Client.revokeCredentials();
      this.tokenRepo.delete(userId);
      logger.info('Access revoked', { userId });
    } catch (err) {
      logger.error('Failed to revoke access', { error: err.message });
      throw err;
    }
  }
}

module.exports = GoogleAuthClient;
