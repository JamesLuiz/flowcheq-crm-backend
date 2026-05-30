import { Router, type Request } from 'express';
import { db } from '../store/db';
import { asyncHandler, requireWebhookSecret } from '../middleware/auth';
import { TelnyxVoiceService } from '../services/telnyxVoiceService';
import {
  handleVoiceCallCompleted,
  handleVoiceCallStarted,
  handleVoiceEscalation,
  handleVoiceCallAnswered,
} from '../services/voiceBridgeService';
import type { VoiceCallCompletedPayload } from '../types';

function paramId(req: Request): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] : id;
}

const router = Router();

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const list = (await db.getCalls()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    const populated = await Promise.all(
      list.map(async (call) => ({ ...call, contact: await db.getContactById(call.contactId) }))
    );
    res.json(populated);
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { contactId, direction, status, duration, providerCallId, handledBy, summary, notes } = req.body;
    if (!contactId || !direction || !status) {
      res.status(400).json({ error: 'contactId, direction, and status are required.' });
      return;
    }
    const record = await db.createCall({
      contactId,
      direction,
      status,
      duration: Number(duration) || 0,
      providerCallId,
      handledBy,
      summary,
      notes,
    });
    res.status(201).json(record);
  })
);

router.post(
  '/outbound',
  asyncHandler(async (req, res) => {
    const { contactId } = req.body;
    if (!contactId) {
      res.status(400).json({ error: 'contactId is required.' });
      return;
    }
    const contact = await db.getContactById(contactId);
    if (!contact) {
      res.status(404).json({ error: 'Contact not found.' });
      return;
    }

    const telnyxResult = await TelnyxVoiceService.makeOutboundCall(contact.phoneNumber);

    const record = await db.createCall({
      contactId: contact._id,
      direction: 'outbound',
      status: 'in-progress',
      duration: 0,
      providerCallId: telnyxResult.callSessionId,
      handledBy: 'human',
    });

    await db.createNotification({
      type: 'call',
      message: `Outbound call started to ${contact.name}`,
      read: false,
    });

    res.status(201).json({
      call: record,
      telnyx: {
        callControlId: telnyxResult.callControlId,
        callSessionId: telnyxResult.callSessionId,
      },
    });
  })
);

router.put(
  '/:id/notes',
  asyncHandler(async (req, res) => {
    const updated = await db.updateCallNotes(paramId(req), req.body.notes || '');
    if (!updated) {
      res.status(404).json({ error: 'Call record not found.' });
      return;
    }
    res.json(updated);
  })
);

router.get(
  '/:id/transcript',
  asyncHandler(async (req, res) => {
    const calls = await db.getCalls();
    const call = calls.find((c) => c._id === paramId(req));
    if (!call) {
      res.status(404).json({ error: 'Call not found.' });
      return;
    }
    res.json({
      callId: call._id,
      providerCallId: call.providerCallId,
      transcript: call.transcript || '',
      summary: call.summary || '',
      leadScore: call.leadScore,
    });
  })
);

const voiceWebhookRouter = Router();

voiceWebhookRouter.post(
  '/escalation',
  requireWebhookSecret,
  asyncHandler(async (req, res) => {
    const { call_id, caller_number, reason } = req.body;
    if (!call_id || !caller_number) {
      res.status(400).json({ error: 'call_id and caller_number required' });
      return;
    }
    const result = await handleVoiceEscalation({ call_id, caller_number, reason });
    res.status(201).json(result);
  })
);

voiceWebhookRouter.post(
  '/call-answered',
  requireWebhookSecret,
  asyncHandler(async (req, res) => {
    const { call_id, caller_number, answered_by } = req.body;
    const result = await handleVoiceCallAnswered({ call_id, caller_number, answered_by });
    res.json(result);
  })
);

voiceWebhookRouter.post(
  '/call-started',
  requireWebhookSecret,
  asyncHandler(async (req, res) => {
    const { call_id, caller_number, call_control_id, direction } = req.body;
    if (!call_id || !caller_number) {
      res.status(400).json({ error: 'call_id and caller_number required' });
      return;
    }
    const result = await handleVoiceCallStarted({ call_id, caller_number, call_control_id, direction });
    res.status(201).json(result);
  })
);

voiceWebhookRouter.post(
  '/call-completed',
  requireWebhookSecret,
  asyncHandler(async (req, res) => {
    const payload = req.body as VoiceCallCompletedPayload;
    if (!payload.call_id || !payload.caller_number) {
      res.status(400).json({ error: 'call_id and caller_number required' });
      return;
    }
    const result = await handleVoiceCallCompleted(payload);
    res.status(201).json(result);
  })
);

export { voiceWebhookRouter };
export default router;
