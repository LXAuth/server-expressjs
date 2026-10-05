import express, { type Express } from 'express';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFoundHandler, requestId } from './middleware/error-handler.js';
import { registerRoutes } from './routes/index.js';

/**
 * Builds the Express application.
 *
 * Kept separate from `server.ts` so tests can mount the app with supertest
 * without opening a port. `createApp()` has no side effects beyond building the
 * router — nothing here listens, and nothing here touches the database.
 */
export function createApp(): Express {
  const app = express();

  // Behind a proxy, req.ip and req.protocol read the forwarded values only when
  // this is set. Without it every client is the proxy's address.
  app.set('trust proxy', true);
  app.disable('x-powered-by');

  app.use(requestId);
  app.use(express.json({ limit: '1mb' }));

  // Baseline hardening. The API returns JSON and takes no cookie input, so the
  // CSP is about not letting a browser be talked into interpreting a response
  // as a document.
  app.use((_req, res, next) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      env: config.env,
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });

  app.use('/api/v1', registerRoutes());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
