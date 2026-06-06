import { Router } from 'express';
import { asyncHandler } from '../middleware/auth';
import {
  bulkSendCampaign,
  countCampaignTargets,
  previewCampaignMessage,
} from '../services/campaignService';
import { config } from '../config';
import { consultationUrl } from '../utils/campaignMessage';

const router = Router();

router.get(
  '/config',
  asyncHandler(async (_req, res) => {
    res.json({
      consultationUrl: consultationUrl(),
      defaultTemplate: `Hi {{name}}, Flowcheq helps {{businessName}} turn conversations into booked consultations. Visit {{consultationUrl}} for a free consult.`,
    });
  })
);

router.post(
  '/preview',
  asyncHandler(async (req, res) => {
    const preview = await previewCampaignMessage(req.body);
    if (!preview) {
      res.status(404).json({ error: 'No contacts available for preview.' });
      return;
    }
    res.json(preview);
  })
);

router.post(
  '/target-count',
  asyncHandler(async (req, res) => {
    const { contactIds, tagFilter } = req.body as {
      contactIds?: string[];
      tagFilter?: string[];
    };
    const count = await countCampaignTargets({ contactIds, tagFilter });
    res.json({ count, consultationUrl: config.campaign.consultationUrl });
  })
);

router.post(
  '/bulk-send',
  asyncHandler(async (req, res) => {
    const {
      contactIds,
      tagFilter,
      messageTemplate,
      useAiMessages,
      personalizeTemplate,
      trackLinks,
      includeConsultationUrl,
    } = req.body as {
      contactIds?: string[];
      tagFilter?: string[];
      messageTemplate?: string;
      useAiMessages?: boolean;
      personalizeTemplate?: boolean;
      trackLinks?: boolean;
      includeConsultationUrl?: boolean;
    };

    const result = await bulkSendCampaign({
      contactIds,
      tagFilter,
      messageTemplate,
      useAiMessages,
      personalizeTemplate,
      trackLinks,
      includeConsultationUrl,
    });

    res.json({
      ...result,
      trackLinksEnabled: trackLinks !== false,
      includeConsultationUrl: includeConsultationUrl !== false,
      consultationUrl: config.campaign.consultationUrl,
    });
  })
);

export default router;
