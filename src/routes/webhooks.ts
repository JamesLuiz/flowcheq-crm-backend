import { Router } from 'express';
import { asyncHandler, requireWebhookSecret } from '../middleware/auth';
import { SMSService } from '../services/smsService';
import { handleInboundSMS } from '../services/inboundSmsService';
import { markInsightFailed, saveInsightFromWebhook } from '../services/insightService';

const router = Router();

async function inboundSmsHandler(req: Parameters<Parameters<typeof asyncHandler>[0]>[0], res: Parameters<Parameters<typeof asyncHandler>[0]>[1]) {
  console.log('[webhook] Inbound:', JSON.stringify(req.body).substring(0, 200));

  const body = req.body as Record<string, unknown>;
  let provider: 'twilio' | 'telnyx' | 'generic' = 'generic';

  if (body.AccountSid && body.MessageSid) {
    provider = 'twilio';
  } else if (body.data && (body.data as { event_type?: string }).event_type) {
    const eventType = (body.data as { event_type: string }).event_type;
    if (eventType.startsWith('call.')) {
      res.status(200).json({ success: true, skipped: 'call event — handled by n8n voice workflow' });
      return;
    }
    if (eventType === 'message.received') {
      provider = 'telnyx';
    } else {
      res.status(200).json({ success: true, skipped: eventType });
      return;
    }
  }

  const normalized = SMSService.normalizeInbound(body, provider);
  if (!normalized.from || !normalized.text) {
    res.status(400).json({ error: 'Incomplete webhook body.' });
    return;
  }

  const isHTML = normalized.text.includes('<') && normalized.text.includes('>');
  const outcome = await handleInboundSMS(normalized, isHTML ? 'html' : 'text');
  res.status(200).json({ success: true, messageId: outcome.message._id });
}

router.post('/inbound', asyncHandler(inboundSmsHandler));

router.post(
  '/insights',
  requireWebhookSecret,
  asyncHandler(async (req, res) => {
    const { contact_id, contactId, status, error } = req.body as Record<string, unknown>;
    const id = String(contact_id || contactId || '');
    if (!id) {
      res.status(400).json({ error: 'contact_id required' });
      return;
    }
    if (status === 'failed' || error) {
      await markInsightFailed(id, String(error || 'Enrichment failed'));
      res.json({ success: true });
      return;
    }
    const insight = await saveInsightFromWebhook(id, req.body as Record<string, unknown>);
    res.json({ success: true, insight });
  })
);

export default router;
