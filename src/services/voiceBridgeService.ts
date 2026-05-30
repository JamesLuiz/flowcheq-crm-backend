import { db } from '../store/db';
import { resolveOrCreateContactByPhone } from './inboundSmsService';
import type { VoiceCallCompletedPayload } from '../types';

export async function handleVoiceCallStarted(payload: {
  call_id: string;
  caller_number: string;
  call_control_id?: string;
  direction?: 'inbound' | 'outbound';
}) {
  const contact = await resolveOrCreateContactByPhone(payload.caller_number);
  const call = await db.upsertCallByProvider(payload.call_id, {
    contactId: contact._id,
    direction: payload.direction || 'inbound',
    status: 'ringing',
    duration: 0,
    telnyxCallControlId: payload.call_control_id,
  });

  await db.createNotification({
    type: 'call',
    message: `Incoming call from ${contact.name} (${payload.caller_number})`,
    read: false,
  });

  return { contact, call, ring_in_app: true };
}

export async function handleVoiceCallCompleted(payload: VoiceCallCompletedPayload) {
  const contact = await resolveOrCreateContactByPhone(
    payload.caller_number,
    payload.structured_fields?.caller_name as string | undefined
  );

  const transcriptText =
    payload.transcript ||
    (Array.isArray(payload.structured_fields?.transcript)
      ? (payload.structured_fields!.transcript as { speaker: string; text: string }[])
          .map((t) => `${t.speaker}: ${t.text}`)
          .join('\n')
      : undefined);

  const notesParts = [
    payload.summary ? `Summary: ${payload.summary}` : null,
    payload.lead_score != null ? `Lead score: ${payload.lead_score}` : null,
    payload.handled_by ? `Handled by: ${payload.handled_by}` : null,
  ].filter(Boolean);

  const call = await db.upsertCallByProvider(payload.call_id, {
    contactId: contact._id,
    direction: payload.direction || 'inbound',
    status: payload.status || 'completed',
    duration: payload.duration ?? 0,
    handledBy: payload.handled_by,
    summary: payload.summary,
    leadScore: payload.lead_score,
    transcript: transcriptText,
    notes: notesParts.join('\n'),
  });

  await db.createNotification({
    type: 'call',
    message: `Call completed with ${contact.name}${payload.summary ? `: ${payload.summary.substring(0, 60)}...` : ''}`,
    read: false,
  });

  return { contact, call };
}

export async function handleVoiceEscalation(payload: {
  call_id: string;
  caller_number: string;
  reason?: string;
}) {
  const contact = await resolveOrCreateContactByPhone(payload.caller_number);

  await db.upsertCallByProvider(payload.call_id, {
    contactId: contact._id,
    direction: 'inbound',
    status: 'ringing',
    duration: 0,
    handledBy: 'human',
    notes: payload.reason ? `Escalated: ${payload.reason}` : 'Escalated to human',
  });

  await db.createNotification({
    type: 'call',
    message: `ESCALATION: ${contact.name} (${payload.caller_number}) needs a human — ${payload.reason || 'transfer requested'}`,
    read: false,
  });

  return { contact, ring_in_app: true };
}

function normalizePhone(phone: string): string {
  return phone.replace(/\s/g, '');
}

export async function handleVoiceCallAnswered(payload: {
  call_id?: string;
  caller_number?: string;
  answered_by?: 'human' | 'ai';
}) {
  let call = payload.call_id ? await db.findCallByProviderId(payload.call_id) : null;

  if (!call && payload.caller_number) {
    const normalized = normalizePhone(payload.caller_number);
    const calls = await db.getCalls();
    for (const c of calls) {
      if (c.status !== 'ringing') continue;
      const contact = await db.getContactById(c.contactId);
      if (contact && normalizePhone(contact.phoneNumber) === normalized) {
        call = c;
        break;
      }
    }
  }

  if (!call || call.status !== 'ringing') {
    return { call: call || null, dismissed: false };
  }

  const updated = await db.updateCall(call._id, {
    status: 'in-progress',
    handledBy: payload.answered_by === 'ai' ? 'ai' : 'human',
  });

  return { call: updated, dismissed: true };
}
