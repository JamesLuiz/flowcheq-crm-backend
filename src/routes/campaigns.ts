import { Router } from 'express';
import { asyncHandler } from '../middleware/auth';
import { bulkSendCampaign } from '../services/campaignService';
import { config } from '../config';

const router = Router();

router.post(
  '/bulk-send',
  asyncHandler(async (req, res) => {
    const { contactIds, messageTemplate, useAiMessages } = req.body as {
      contactIds?: string[];
      messageTemplate?: string;
      useAiMessages?: boolean;
    };

    const result = await bulkSendCampaign({
      contactIds,
      messageTemplate,
      useAiMessages: useAiMessages !== false,
    });

    res.json({
      ...result,
      trackLinksEnabled: true,
      consultationUrl: config.campaign.consultationUrl,
    });
  })
);

export default router;
