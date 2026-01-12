const express = require('express');
const logger = require('../utils/logger');

function createAuthRouter(authClient) {
  const router = express.Router();

  router.get('/login', (req, res) => {
    const url = authClient.getAuthUrl();
    res.redirect(url);
  });

  router.get('/callback', async (req, res) => {
    const { code, error } = req.query;

    if (error) {
      logger.error('OAuth error', { error });
      return res.status(400).json({ error: 'Authentication failed', details: error });
    }

    if (!code) {
      return res.status(400).json({ error: 'Missing authorization code' });
    }

    try {
      await authClient.handleCallback(code);
      res.json({ message: 'Authentication successful' });
    } catch (err) {
      logger.error('Failed to exchange code', { error: err.message });
      res.status(500).json({ error: 'Failed to complete authentication' });
    }
  });

  router.get('/status', (req, res) => {
    res.json({
      authenticated: authClient.isAuthenticated()
    });
  });

  router.post('/logout', async (req, res) => {
    try {
      await authClient.revokeAccess();
      res.json({ message: 'Logged out successfully' });
    } catch (err) {
      res.status(500).json({ error: 'Failed to logout' });
    }
  });

  return router;
}

module.exports = createAuthRouter;
