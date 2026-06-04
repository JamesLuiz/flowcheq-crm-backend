import { Router } from 'express';
import { asyncHandler } from '../middleware/auth';
import { getLinkAnalytics } from '../services/linkTrackingService';
import { CONTACT_TAG_OPTIONS } from '../constants/contactTags';

const router = Router();

router.get(
  '/link-clicks',
  asyncHandler(async (_req, res) => {
    const data = await getLinkAnalytics();
    res.json(data);
  })
);

router.get(
  '/contact-tags',
  asyncHandler(async (_req, res) => {
    res.json({ tags: CONTACT_TAG_OPTIONS });
  })
);

export default router;
