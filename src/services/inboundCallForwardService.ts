import {
  answerCall,
  dialLinkedCall,
  hangupCall,
  humanForwardNumber,
  inboundRingConfigured,
} from './telnyxCallControlService';
import { handleVoiceCallCompleted, handleVoiceCallStarted } from './voiceBridgeService';

interface TelnyxVoiceEvent {
  event_type?: string;
  payload?: {
    call_control_id?: string;
    call_session_id?: string;
    direction?: string;
    from?: string;
    to?: string;
    hangup_cause?: string;
    hangup_source?: string;
  };
}

function parseEvent(body: Record<string, unknown>): TelnyxVoiceEvent | null {
  const data = body.data as TelnyxVoiceEvent | undefined;
  if (!data?.event_type || !data.payload?.call_control_id) return null;
  return data;
}

/** Inbound PSTN → answer on initiated → dial mobile on answered (Telnyx two-step pattern). */
export async function handleInboundCallForward(body: Record<string, unknown>): Promise<void> {
  const event = parseEvent(body);
  if (!event?.payload?.call_control_id) return;

  const { event_type: eventType, payload } = event;
  const callControlId = payload!.call_control_id!;
  const direction = payload!.direction || '';
  const from = payload!.from || '';
  const sessionId = payload!.call_session_id || callControlId;

  console.log(`[voice] ${eventType} ${direction} from=${from} id=${callControlId.slice(0, 12)}…`);

  if (eventType === 'call.initiated' && direction === 'incoming') {
    const forwardTo = humanForwardNumber();
    if (!inboundRingConfigured() || !forwardTo) {
      console.error('[voice] HUMAN_FORWARD_NUMBER missing or invalid — cannot forward inbound call');
      return;
    }

    handleVoiceCallStarted({
      call_id: sessionId,
      caller_number: from,
      call_control_id: callControlId,
      direction: 'inbound',
    }).catch((e) => console.error('[voice] call-started log failed:', e));

    try {
      await answerCall(callControlId);
      console.log(`[voice] Answered inbound from ${from}, waiting for call.answered to dial ${forwardTo}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[voice] Answer failed: ${message}`);
      await hangupCall(callControlId).catch(() => {});
    }
    return;
  }

  if (eventType === 'call.answered' && direction === 'incoming') {
    const forwardTo = humanForwardNumber();
    if (!forwardTo) {
      console.error('[voice] HUMAN_FORWARD_NUMBER missing on call.answered');
      await hangupCall(callControlId).catch(() => {});
      return;
    }

    try {
      await dialLinkedCall(callControlId, forwardTo, 'inbound-forward');
      console.log(`[voice] Dialing ${forwardTo} linked to inbound from ${from}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[voice] Forward dial failed: ${message}`);
      await hangupCall(callControlId).catch(() => {});
    }
    return;
  }

  if (eventType === 'call.hangup' && direction === 'incoming') {
    await handleVoiceCallCompleted({
      call_id: sessionId,
      caller_number: from,
      direction: 'inbound',
      status: 'completed',
      duration: 0,
      handled_by: 'human',
    }).catch((e) => console.error('[voice] call-completed log failed:', e));
  }
}
