export type RingLegType = 'mobile' | 'webrtc';

export interface RingSession {
  sessionId: string;
  callSessionId: string;
  inboundControlId: string;
  callerNumber: string;
  legs: Record<string, RingLegType>;
  settled: boolean;
}

const byInbound = new Map<string, RingSession>();
const byControlId = new Map<string, RingSession>();

export function createRingSession(input: {
  sessionId: string;
  callSessionId: string;
  inboundControlId: string;
  callerNumber: string;
}): RingSession {
  const session: RingSession = {
    ...input,
    legs: {},
    settled: false,
  };
  byInbound.set(input.inboundControlId, session);
  byControlId.set(input.inboundControlId, session);
  return session;
}

export function registerRingLeg(session: RingSession, controlId: string, leg: RingLegType): void {
  session.legs[controlId] = leg;
  byControlId.set(controlId, session);
}

export function getRingSessionByControlId(controlId: string): RingSession | undefined {
  return byControlId.get(controlId);
}

export function markRingSessionSettled(session: RingSession): boolean {
  if (session.settled) return false;
  session.settled = true;
  return true;
}

export function clearRingSession(session: RingSession): void {
  byInbound.delete(session.inboundControlId);
  byControlId.delete(session.inboundControlId);
  for (const controlId of Object.keys(session.legs)) {
    byControlId.delete(controlId);
  }
}

export function encodeClientState(data: Record<string, string>): string {
  return Buffer.from(JSON.stringify(data)).toString('base64');
}

export function parseClientState(raw?: string): { sessionId?: string; leg?: RingLegType } | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as {
      sessionId?: string;
      leg?: RingLegType;
    };
    return parsed?.sessionId ? parsed : null;
  } catch {
    return null;
  }
}
