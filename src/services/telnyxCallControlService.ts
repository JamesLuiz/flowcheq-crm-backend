import { config } from '../config';
import { normalizePhoneToE164 } from '../utils/phone';

const TELNYX_API = 'https://api.telnyx.com/v2';

function headers() {
  return {
    Authorization: `Bearer ${config.telnyx.apiKey}`,
    'Content-Type': 'application/json',
  };
}

async function postAction(callControlId: string, action: string, body: Record<string, unknown> = {}) {
  const res = await fetch(`${TELNYX_API}/calls/${callControlId}/actions/${action}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) {
    let message = raw.trim();
    try {
      const data = JSON.parse(raw) as { errors?: { code?: string; title?: string; detail?: string }[] };
      const err = data.errors?.[0];
      message = [err?.code, err?.title, err?.detail].filter(Boolean).join(': ') || message;
    } catch {
      /* use raw */
    }
    throw new Error(message || `Telnyx ${action} failed (${res.status})`);
  }
}

export async function answerCall(callControlId: string): Promise<void> {
  await postAction(callControlId, 'answer');
}

export async function hangupCall(callControlId: string): Promise<void> {
  await postAction(callControlId, 'hangup');
}

export async function transferCall(callControlId: string, to: string): Promise<void> {
  const destination = normalizePhoneToE164(to);
  const from = normalizePhoneToE164(config.telnyx.phoneNumber);
  await postAction(callControlId, 'transfer', { to: destination, from });
}

/** Dial an outbound leg that auto-bridges to the inbound call when answered. */
export async function dialLinkedCall(
  linkToControlId: string,
  to: string,
  clientState: string
): Promise<string | undefined> {
  const connectionId = config.telnyx.connectionId;
  if (!connectionId) {
    throw new Error('TELNYX_CONNECTION_ID required for inbound ring.');
  }

  const from = normalizePhoneToE164(config.telnyx.phoneNumber);
  const destination = to.startsWith('sip:') ? to : normalizePhoneToE164(to);

  const res = await fetch(`${TELNYX_API}/calls`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      connection_id: connectionId,
      to: destination,
      from,
      link_to: linkToControlId,
      timeout_secs: 45,
      client_state: Buffer.from(clientState, 'utf8').toString('base64'),
    }),
  });

  const raw = await res.text();
  if (!res.ok) {
    let message = raw.trim();
    try {
      const data = JSON.parse(raw) as { errors?: { code?: string; title?: string; detail?: string }[] };
      const err = data.errors?.[0];
      message = [err?.code, err?.title, err?.detail].filter(Boolean).join(': ') || message;
    } catch {
      /* use raw */
    }
    throw new Error(message || `Telnyx dial failed (${res.status})`);
  }

  try {
    const data = JSON.parse(raw) as { data?: { call_control_id?: string } };
    return data.data?.call_control_id;
  } catch {
    return undefined;
  }
}

export function humanForwardNumber(): string {
  const forward = (config.telnyx.humanForwardNumber || '').trim();
  if (!forward || /X{3,}/i.test(forward)) return '';
  try {
    return normalizePhoneToE164(forward);
  } catch {
    return '';
  }
}

export function inboundRingConfigured(): boolean {
  if (!config.telnyx.apiKey || !config.telnyx.connectionId) return false;
  return Boolean(humanForwardNumber());
}

/** @deprecated use inboundRingConfigured */
export function inboundForwardConfigured(): boolean {
  return inboundRingConfigured();
}
