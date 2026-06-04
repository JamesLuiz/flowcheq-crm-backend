import { Router, type Request, type Response } from 'express';
import { recordClick } from '../services/linkTrackingService';

const router = Router();

router.get('/:slug', async (req: Request, res: Response) => {
  const slug = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;
  if (!slug) {
    res.status(404).send('Link not found');
    return;
  }

  const outcome = await recordClick(slug, {
    userAgent: req.headers['user-agent'] as string | undefined,
    referer: req.headers.referer,
    ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress,
  });

  if (!outcome) {
    res.status(404).send('Link not found');
    return;
  }

  res.redirect(302, outcome.link.originalUrl);
});

export default router;
