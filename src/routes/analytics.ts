import { Router } from 'express';
import { asyncHandler } from '../middleware/auth';
import { getLinkAnalytics } from '../services/linkTrackingService';
const router = Router();

router.get(
  '/link-clicks',
  asyncHandler(async (_req, res) => {
    const data = await getLinkAnalytics();
    res.json(data);
  })
);

export default router;
