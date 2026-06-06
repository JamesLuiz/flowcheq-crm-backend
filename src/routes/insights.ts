import { Router, type Request } from 'express';
import { asyncHandler } from '../middleware/auth';
import { db } from '../store/db';
import {
  enrichContact,
  getGoogleMapsLinkForContact,
  getInsightByContactId,
  getOrCreateFollowUp,
} from '../services/insightService';
import { getContactPhoneLookup } from '../services/phoneLookupService';

const router = Router();

function paramId(req: Request): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] : id;
}

router.get(
  '/contacts/:id/insights',
  asyncHandler(async (req, res) => {
    const contact = await db.getContactById(paramId(req));
    if (!contact) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }
    const insight = await getInsightByContactId(contact._id);
    res.json({ insight, contact });
  })
);

router.post(
  '/contacts/:id/enrich',
  asyncHandler(async (req, res) => {
    const contact = await db.getContactById(paramId(req));
    if (!contact) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }
    const insight = await enrichContact(contact);
    res.json({ insight, triggered: true });
  })
);

router.get(
  '/contacts/:id/google-maps',
  asyncHandler(async (req, res) => {
    const contact = await db.getContactById(paramId(req));
    if (!contact) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }
    const resolved = await getGoogleMapsLinkForContact(contact._id);
    if (!resolved) {
      res.json({ url: null, source: null, label: null });
      return;
    }
    res.json(resolved);
  })
);

router.get(
  '/contacts/:id/phone-lookup',
  asyncHandler(async (req, res) => {
    const contactId = paramId(req);
    const contact = await db.getContactById(contactId);
    if (!contact) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const result = await getContactPhoneLookup(contactId, { refresh });
    if (!result) {
      res.json({
        lineType: 'unknown',
        smsCapable: null,
        carrierName: '',
        phoneLookupAt: null,
        cached: false,
        source: 'unknown',
      });
      return;
    }
    res.json(result.lookup);
  })
);

router.get(
  '/contacts/:id/follow-up',
  asyncHandler(async (req, res) => {
    const contactId = paramId(req);
    const contact = await db.getContactById(contactId);
    if (!contact) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }
    const message = await getOrCreateFollowUp(contactId);
    res.json({ message, consultationUrl: process.env.CONSULTATION_URL || 'https://flowcheq.com/consultation' });
  })
);

export default router;
