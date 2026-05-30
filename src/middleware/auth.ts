import { Router, type Request, type Response, type NextFunction } from 'express';
import { config } from '../config';

export function requireWebhookSecret(req: Request, res: Response, next: NextFunction) {
  const secret = config.webhooks.secret;
  if (!secret) return next();
  const key = req.headers['x-api-key'] || req.headers['x-webhook-secret'];
  if (key !== secret) {
    return res.status(401).json({ error: 'Unauthorized webhook' });
  }
  next();
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
