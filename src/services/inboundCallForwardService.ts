import { TelnyxWebRTCService } from './telnyxWebRTCService';
import {
  answerCall,
  dialLinkedCall,
  hangupCall,
  humanForwardNumber,
  inboundRingConfigured,
} from './telnyxCallControlService';
import {
  clearRingSession,
  createRingSession,
  encodeClientState,
  getRingSessionByControlId,
  markRingSessionSettled,
  parseClientState,
  registerRingLeg,
  type RingSession,
} from './ringSessionStore';
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
    client_state?: string;
  };
}

function parseEvent(body: Record<string, unknown>): TelnyxVoiceEvent | null {
  const data = body.data as TelnyxVoiceEvent | undefined;
  if (!data?.event_type || !data.payload?.call_control_id) return null;
  return data;
}

async function startSimultaneousRing(
  inboundControlId: string,
  callSessionId: string,
  callerNumber: string
): Promise<void> {
  const session = createRingSession({
    sessionId: callSessionId,
    callSessionId,
    inboundControlId,
    callerNumber,
  });

  await handleVoiceCallStarted({
    call_id: callSessionId,
    caller_number: callerNumber,
    call_control_id: inboundControlId,
    direction: 'inbound',
  }).catch((e) => console.error('[voice-ring] call-started log failed:', e));

  await answerCall(inboundControlId);
  console.log(`[voice-ring] Answered inbound from ${callerNumber}`);

  const mobile = humanForwardNumber();
  const tasks: Promise<void>[] = [];

  if (mobile) {
    tasks.push(
      (async () => {
        const clientState = encodeClientState({ sessionId: session.sessionId, leg: 'mobile' });
        const legId = await dialLinkedCall(inboundControlId, mobile, clientState);
        if (legId) registerRingLeg(session, legId, 'mobile');
        console.log(`[voice-ring] Dialing mobile ${mobile}`);
      })()
    );
  }

  if (TelnyxWebRTCService.isConfigured()) {
    tasks.push(
      (async () => {
        const cred = await TelnyxWebRTCService.getOrCreateCredential();
        const sipUri = `sip:${cred.sip_username}@sip.telnyx.com`;
        const clientState = encodeClientState({ sessionId: session.sessionId, leg: 'webrtc' });
        const legId = await dialLinkedCall(inboundControlId, sipUri, clientState);
        if (legId) registerRingLeg(session, legId, 'webrtc');
        console.log(`[voice-ring] Dialing WebRTC ${cred.sip_username}`);
      })()
    );
  }

  await Promise.all(tasks);
}

async function settleSession(session: RingSession, winnerControlId: string): Promise<void> {
  if (!markRingSessionSettled(session)) return;

  for (const controlId of Object.keys(session.legs)) {
    if (controlId === winnerControlId) continue;
    await hangupCall(controlId).catch((e) =>
      console.warn('[voice-ring] hangup leg failed:', e instanceof Error ? e.message : e)
    );
  }

  console.log(`[voice-ring] Connected via ${session.legs[winnerControlId] || 'unknown'} leg`);
}

/** Ring mobile + WebRTC app; first answer wins and cancels the other leg. */
export async function handleInboundCallForward(body: Record<string, unknown>): Promise<void> {
  const event = parseEvent(body);
  if (!event?.payload?.call_control_id) return;

  const { event_type: eventType, payload } = event;
  const callControlId = payload!.call_control_id!;
  const direction = payload!.direction || '';
  const from = payload!.from || '';
  const sessionId = payload!.call_session_id || callControlId;
  const clientState = parseClientState(payload!.client_state);

  if (eventType === 'call.initiated' && direction === 'incoming') {
    if (!inboundRingConfigured()) {
      console.warn('[voice-ring] No HUMAN_FORWARD_NUMBER or WebRTC — inbound call not handled');
      return;
    }
    await startSimultaneousRing(callControlId, sessionId, from);
    return;
  }

  if (eventType === 'call.initiated' && direction === 'outgoing' && clientState?.sessionId) {
    const session = getRingSessionByControlId(callControlId);
    if (session && clientState.leg) {
      registerRingLeg(session, callControlId, clientState.leg);
    }
    return;
  }

  const session = getRingSessionByControlId(callControlId);
  if (!session) return;

  if (eventType === 'call.bridged') {
    if (session.legs[callControlId]) {
      await settleSession(session, callControlId);
    }
    return;
  }

  if (eventType === 'call.answered' && direction === 'outgoing' && session.legs[callControlId]) {
    await settleSession(session, callControlId);
    return;
  }

  if (eventType === 'call.hangup') {
    if (callControlId === session.inboundControlId || session.settled) {
      clearRingSession(session);
      if (callControlId === session.inboundControlId) {
        await handleVoiceCallCompleted({
          call_id: session.callSessionId,
          caller_number: session.callerNumber,
          direction: 'inbound',
          status: 'completed',
          duration: 0,
          handled_by: 'human',
        }).catch((e) => console.error('[voice-ring] call-completed log failed:', e));
      }
    }
  }
}
