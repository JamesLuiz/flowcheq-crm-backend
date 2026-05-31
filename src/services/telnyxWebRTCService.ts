import fs from 'fs';
import path from 'path';
import { config } from '../config';

const TELNYX_API = 'https://api.telnyx.com/v2';
const CRED_CACHE = path.join(process.cwd(), 'data', 'webrtc_credential.json');

interface CachedCredential {
  id: string;
  sip_username: string;
  sip_password: string;
}

function headers() {
  return {
    Authorization: `Bearer ${config.telnyx.apiKey}`,
    'Content-Type': 'application/json',
  };
}

async function telnyxFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...headers(), ...init?.headers } });
  const data = await res.json();
  if (!res.ok) {
    const err = (data as { errors?: { title?: string; detail?: string }[] }).errors?.[0];
    const msg = [err?.title, err?.detail].filter(Boolean).join(': ') || res.statusText;
    throw new Error(msg);
  }
  return data as T;
}

function loadCachedCredential(): CachedCredential | null {
  try {
    if (fs.existsSync(CRED_CACHE)) {
      return JSON.parse(fs.readFileSync(CRED_CACHE, 'utf-8'));
    }
  } catch {
    /* ignore */
  }
  return null;
}

function saveCachedCredential(cred: CachedCredential) {
  const dir = path.dirname(CRED_CACHE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CRED_CACHE, JSON.stringify(cred, null, 2));
}

export class TelnyxWebRTCService {
  static isConfigured(): boolean {
    const connId = config.telnyx.webrtcConnectionId || config.telnyx.connectionId;
    return Boolean(config.telnyx.apiKey && connId);
  }

  static async getOrCreateCredential(): Promise<CachedCredential> {
    if (config.telnyx.webrtcCredentialId) {
      const data = await telnyxFetch<{ data: CachedCredential }>(
        `${TELNYX_API}/telephony_credentials/${config.telnyx.webrtcCredentialId}`
      );
      return {
        id: data.data.id,
        sip_username: data.data.sip_username,
        sip_password: data.data.sip_password,
      };
    }

    const cached = loadCachedCredential();
    if (cached?.id && cached.sip_username) return cached;

    const connectionId = config.telnyx.webrtcConnectionId || config.telnyx.connectionId;
    if (!connectionId) throw new Error('TELNYX_WEBRTC_CONNECTION_ID or TELNYX_CONNECTION_ID required');

    try {
      const created = await telnyxFetch<{ data: CachedCredential }>(`${TELNYX_API}/telephony_credentials`, {
        method: 'POST',
        body: JSON.stringify({
          connection_id: connectionId,
          name: 'flowcheq-agent-webrtc',
          tag: 'flowcheq',
        }),
      });

      const cred = {
        id: created.data.id,
        sip_username: created.data.sip_username,
        sip_password: created.data.sip_password,
      };
      saveCachedCredential(cred);
      return cred;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/unprocessable|connection/i.test(msg)) {
        throw new Error(
          `${msg}. TELNYX_WEBRTC_CONNECTION_ID must be a Telnyx Credential Connection ID (Voice → Connections → Credential), not the Call Control Application ID.`
        );
      }
      throw err;
    }
  }

  static async getLoginToken(): Promise<{ login_token: string; sip_username: string; caller_id: string }> {
    const cred = await this.getOrCreateCredential();
    const res = await fetch(`${TELNYX_API}/telephony_credentials/${cred.id}/token`, {
      method: 'POST',
      headers: headers(),
      body: '{}',
    });
    const text = await res.text();
    if (!res.ok) {
      try {
        const data = JSON.parse(text) as { errors?: { title?: string; detail?: string }[] };
        const err = data.errors?.[0];
        throw new Error([err?.title, err?.detail].filter(Boolean).join(': ') || res.statusText);
      } catch (parseErr) {
        if (parseErr instanceof Error && parseErr.message !== text) throw parseErr;
        throw new Error(text || res.statusText);
      }
    }
    let login_token: string;
    try {
      const parsed = JSON.parse(text) as { data?: string };
      login_token = (parsed.data ?? text).trim();
    } catch {
      login_token = text.trim();
    }
    return {
      login_token,
      sip_username: cred.sip_username,
      caller_id: config.telnyx.phoneNumber,
    };
  }

  /** Bridge an active PSTN call to the agent's WebRTC SIP endpoint */
  static async transferToWebRTC(callControlId: string, sipUsername: string): Promise<void> {
    const sipUri = `sip:${sipUsername}@sip.telnyx.com`;
    await telnyxFetch(`${TELNYX_API}/calls/${callControlId}/actions/transfer`, {
      method: 'POST',
      body: JSON.stringify({
        to: sipUri,
        from: config.telnyx.phoneNumber,
      }),
    });
  }
}
