import express, { type Express } from 'express';
import { config } from './config';
import apiRoutes from './routes/api';
import messageRoutes from './routes/messages';
import callRoutes, { voiceWebhookRouter } from './routes/calls';
import voiceRoutes from './routes/voice';
import webhookRoutes from './routes/webhooks';

export function createApp(): Express {
  const app = express();

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && config.cors.allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.json());

  app.use((req, _res, next) => {
    console.log(`[API] ${req.method} ${req.url}`);
    next();
  });

  app.get('/api/health', async (_req, res) => {
    const mongoose = await import('mongoose');
    const { telnyxConfigured, telnyxSmsWebhookUrl } = await import('./config');
    res.json({
      status: 'ok',
      serverTime: new Date().toISOString(),
      db: mongoose.default.connection.readyState === 1 ? 'connected' : 'disconnected',
      telnyxSms: telnyxConfigured(),
      inboundWebhook: telnyxSmsWebhookUrl(),
    });
  });

  app.use('/api', apiRoutes);
  app.use('/api/messages', messageRoutes);
  app.use('/api/calls', callRoutes);
  app.use('/api/voice', voiceRoutes);
  app.use('/api/webhook/voice', voiceWebhookRouter);
  app.use('/api/webhook', webhookRoutes);
  app.use('/webhook', webhookRoutes);

  return app;
}
