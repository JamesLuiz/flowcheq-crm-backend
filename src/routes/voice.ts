import { Router } from 'express';
import { db } from '../store/db';
import { asyncHandler } from '../middleware/auth';
import { TelnyxWebRTCService } from '../services/telnyxWebRTCService';
import { handleVoiceCallAnswered } from '../services/voiceBridgeService';

const router = Router();

router.get(
  '/webrtc/status',
  asyncHandler(async (_req, res) => {
    res.json({
      enabled: TelnyxWebRTCService.isConfigured(),
      callerId: process.env.TELNYX_PHONE_NUMBER || '',
    });
  })
);

router.get(
  '/webrtc/token',
  asyncHandler(async (_req, res) => {
    if (!TelnyxWebRTCService.isConfigured()) {
      res.status(503).json({
        error: 'WebRTC not configured. Set TELNYX_API_KEY and TELNYX_WEBRTC_CONNECTION_ID in backend/.env',
      });
      return;
    }
    try {
      const token = await TelnyxWebRTCService.getLoginToken();
      res.json(token);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'WebRTC token failed';
      console.error('[WebRTC] token error:', message);
      res.status(502).json({ error: message });
    }
  })
);

router.post(
  '/webrtc/accept',
  asyncHandler(async (req, res) => {
    const { providerCallId, callerNumber } = req.body;
    if (!providerCallId && !callerNumber) {
      res.status(400).json({ error: 'providerCallId or callerNumber required' });
      return;
    }

    let call = providerCallId ? await db.findCallByProviderId(providerCallId) : null;
    if (!call && callerNumber) {
      const calls = await db.getCalls();
      for (const c of calls) {
        if (c.status !== 'ringing') continue;
        const contact = await db.getContactById(c.contactId);
        if (contact?.phoneNumber.replace(/\s/g, '') === callerNumber.replace(/\s/g, '')) {
          call = c;
          break;
        }
      }
    }

    const callControlId = call?.telnyxCallControlId || req.body.callControlId;
    if (!callControlId) {
      res.status(404).json({ error: 'No active call control ID found. Ensure n8n sends call_control_id.' });
      return;
    }

    const { sip_username } = await TelnyxWebRTCService.getLoginToken();
    await TelnyxWebRTCService.transferToWebRTC(callControlId, sip_username);

    if (call) {
      await handleVoiceCallAnswered({
        call_id: call.providerCallId,
        caller_number: callerNumber,
        answered_by: 'human',
      });
    } else if (callerNumber) {
      await handleVoiceCallAnswered({ caller_number: callerNumber, answered_by: 'human' });
    }

    res.json({ success: true, callControlId, sip_username });
  })
);

router.post(
  '/webrtc/call-answered',
  asyncHandler(async (req, res) => {
    const { providerCallId, callerNumber, contactId } = req.body;
    const contact = contactId ? await db.getContactById(contactId) : null;
    const result = await handleVoiceCallAnswered({
      call_id: providerCallId,
      caller_number: callerNumber || contact?.phoneNumber,
      answered_by: 'human',
    });
    res.json(result);
  })
);

router.post(
  '/webrtc/outbound-started',
  asyncHandler(async (req, res) => {
    const { contactId, providerCallId } = req.body;
    if (!contactId) {
      res.status(400).json({ error: 'contactId required' });
      return;
    }
    const contact = await db.getContactById(contactId);
    if (!contact) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }
    const record = await db.createCall({
      contactId,
      direction: 'outbound',
      status: 'in-progress',
      duration: 0,
      providerCallId: providerCallId || `webrtc_${Date.now()}`,
      handledBy: 'human',
    });
    await db.createNotification({
      type: 'call',
      message: `Outbound WebRTC call to ${contact.name}`,
      read: false,
    });
    res.status(201).json(record);
  })
);

router.post(
  '/webrtc/call-ended',
  asyncHandler(async (req, res) => {
    const { contactId, duration, providerCallId } = req.body;
    let call = providerCallId ? await db.findCallByProviderId(providerCallId) : null;
    if (!call && contactId) {
      const calls = await db.getCalls();
      call = calls.find((c) => c.contactId === contactId && c.status === 'in-progress') || null;
    }
    if (call) {
      await db.updateCall(call._id, {
        status: (duration || 0) > 0 ? 'completed' : 'missed',
        duration: Number(duration) || 0,
      });
    }
    res.json({ success: true });
  })
);

export default router;
