import {
  answerCall,
  humanForwardNumber,
  inboundForwardConfigured,
  transferCall,
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
    state?: string;
  };
}

function parseEvent(body: Record<string, unknown>): TelnyxVoiceEvent | null {
  const data = body.data as TelnyxVoiceEvent | undefined;
  if (!data?.event_type || !data.payload?.call_control_id) return null;
  return data;
}

/** Simple PSTN forward: answer inbound calls, then transfer to HUMAN_FORWARD_NUMBER. */
export async function handleInboundCallForward(body: Record<string, unknown>): Promise<void> {
  const event = parseEvent(body);
  if (!event?.payload?.call_control_id) return;

  const { event_type: eventType, payload } = event;
  const callControlId = payload!.call_control_id!;
  const direction = payload!.direction || '';
  const from = payload!.from || '';
  const sessionId = payload!.call_session_id || callControlId;

  if (eventType === 'call.initiated' && direction === 'incoming') {
    if (!inboundForwardConfigured()) {
      console.warn('[voice-forward] HUMAN_FORWARD_NUMBER not set — inbound call will not be forwarded');
      return;
    }

    await handleVoiceCallStarted({
      call_id: sessionId,
      caller_number: from,
      call_control_id: callControlId,
      direction: 'inbound',
    }).catch((e) => console.error('[voice-forward] call-started log failed:', e));

    await answerCall(callControlId);
    console.log(`[voice-forward] Answered inbound call from ${from}`);
    return;
  }

  if (eventType === 'call.answered' && direction === 'incoming') {
    const forwardTo = humanForwardNumber();
    if (!forwardTo) return;

    await transferCall(callControlId, forwardTo);
    console.log(`[voice-forward] Transferring ${from} → ${forwardTo}`);
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
    }).catch((e) => console.error('[voice-forward] call-completed log failed:', e));
  }
}
