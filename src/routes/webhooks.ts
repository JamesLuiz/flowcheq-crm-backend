import { Router } from 'express';
import { asyncHandler } from '../middleware/auth';
import { SMSService } from '../services/smsService';
import { handleInboundSMS } from '../services/inboundSmsService';

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

export default router;
