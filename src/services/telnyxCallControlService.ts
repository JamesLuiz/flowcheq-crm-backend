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

export async function transferCall(callControlId: string, to: string): Promise<void> {
  const destination = normalizePhoneToE164(to);
  await postAction(callControlId, 'transfer', { to: destination });
}

export function humanForwardNumber(): string {
  return (config.telnyx.humanForwardNumber || '').trim();
}

export function inboundForwardConfigured(): boolean {
  return Boolean(config.telnyx.apiKey && humanForwardNumber());
}
