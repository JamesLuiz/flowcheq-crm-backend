import { Router } from 'express';
import { asyncHandler, requireWebhookSecret } from '../middleware/auth';
import { SMSService } from '../services/smsService';
import { handleInboundSMS } from '../services/inboundSmsService';
import { markInsightFailed, saveInsightFromWebhook } from '../services/insightService';
import { handleInboundCallForward } from '../services/inboundCallForwardService';
import { inboundRingConfigured } from '../services/telnyxCallControlService';

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
      if (inboundRingConfigured()) {
        res.status(200).json({ ok: true });
        handleInboundCallForward(body).catch((err) => {
          console.error('[voice-forward] inbound webhook failed:', err instanceof Error ? err.message : err);
        });
        return;
      }
      res.status(200).json({ success: true, skipped: 'call event — voice forward not configured' });
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

/** Inbound Call Control events — forward to HUMAN_FORWARD_NUMBER (no n8n required). */
router.post(
  '/telnyx/voice',
  asyncHandler(async (req, res) => {
    res.status(200).json({ ok: true });
    handleInboundCallForward(req.body as Record<string, unknown>).catch((err) => {
      console.error('[voice-forward] webhook handler failed:', err instanceof Error ? err.message : err);
    });
  })
);

router.get(
  '/telnyx/voice/status',
  asyncHandler(async (_req, res) => {
    const { telnyxVoiceWebhookUrl } = await import('../config');
    res.json({
      forwardConfigured: inboundRingConfigured(),
      webhookUrl: telnyxVoiceWebhookUrl(),
    });
  })
);

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
