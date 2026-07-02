import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import passport from 'passport';
import { config } from './config';
import { configurePassport, requireAuth } from './middleware/jwtAuth';
import apiRoutes from './routes/api';
import authRoutes from './routes/auth';
import messageRoutes from './routes/messages';
import callRoutes, { voiceWebhookRouter } from './routes/calls';
import voiceRoutes from './routes/voice';
import webhookRoutes from './routes/webhooks';
import analyticsRoutes from './routes/analytics';
import redirectRoutes from './routes/redirect';
import insightRoutes from './routes/insights';
import campaignRoutes from './routes/campaigns';
import uploadRoutes from './routes/upload';

configurePassport();

export function createApp(): Express {
  const app = express();
  app.use(passport.initialize());

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && config.cors.allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, x-webhook-secret');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.json());
  // Twilio webhooks post application/x-www-form-urlencoded
  app.use(express.urlencoded({ extended: false }));

  app.use((req, _res, next) => {
    console.log(`[API] ${req.method} ${req.url}`);
    next();
  });

  app.get('/api/health', async (_req, res) => {
    const mongoose = await import('mongoose');
    const { telnyxConfigured, twilioConfigured, telnyxSmsWebhookUrl, telnyxVoiceWebhookUrl } = await import('./config');
    const { inboundRingConfigured } = await import('./services/telnyxCallControlService');
    res.json({
      status: 'ok',
      serverTime: new Date().toISOString(),
      db: mongoose.default.connection.readyState === 1 ? 'connected' : 'disconnected',
      telnyxSms: telnyxConfigured(),
      twilioSms: twilioConfigured(),
      inboundWebhook: telnyxSmsWebhookUrl(),
      voiceForward: inboundRingConfigured(),
      voiceWebhook: telnyxVoiceWebhookUrl(),
    });
  });

  app.use('/r', redirectRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/webhook', webhookRoutes);
  app.use('/webhook', webhookRoutes);

  app.use('/api', requireAuth);
  app.use('/api', uploadRoutes);
  app.use('/api', insightRoutes);
  app.use('/api/campaigns', campaignRoutes);
  app.use('/api', apiRoutes);
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api/messages', messageRoutes);
  app.use('/api/calls', callRoutes);
  app.use('/api/voice', voiceRoutes);
  app.use('/api/webhook/voice', voiceWebhookRouter);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[API] Unhandled error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    if (!res.headersSent) {
      res.status(500).json({ error: message });
    }
  });

  return app;
}
