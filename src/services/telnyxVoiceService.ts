import { config } from '../config';
import { normalizePhoneToE164 } from '../utils/phone';

const TELNYX_API = 'https://api.telnyx.com/v2';

export interface OutboundCallResult {
  callControlId: string;
  callSessionId: string;
  raw: unknown;
}

export class TelnyxVoiceService {
  private static headers() {
    return {
      Authorization: `Bearer ${config.telnyx.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  static async makeOutboundCall(to: string): Promise<OutboundCallResult> {
    if (!config.telnyx.apiKey || !config.telnyx.connectionId) {
      throw new Error('Telnyx voice not configured. Set TELNYX_API_KEY and TELNYX_CONNECTION_ID.');
    }

    const destination = normalizePhoneToE164(to);
    const from = normalizePhoneToE164(config.telnyx.phoneNumber);

    const webhookUrl =
      config.n8n.voiceEventsWebhook ||
      `${config.telnyx.webhookBaseUrl.replace(/\/$/, '')}/webhook/telnyx/events`;

    const res = await fetch(`${TELNYX_API}/calls`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        connection_id: config.telnyx.connectionId,
        to: destination,
        from,
        webhook_url: webhookUrl,
        webhook_url_method: 'POST',
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      const err = (data as { errors?: { title?: string }[] }).errors?.[0]?.title || 'Telnyx outbound call failed';
      throw new Error(err);
    }

    const payload = (data as { data: { call_control_id: string; call_session_id: string } }).data;
    return {
      callControlId: payload.call_control_id,
      callSessionId: payload.call_session_id,
      raw: data,
    };
  }

  static async getCallState(callControlId: string): Promise<{ state: string; answered: boolean }> {
    const res = await fetch(`${TELNYX_API}/calls/${callControlId}`, {
      headers: this.headers(),
    });
    const data = await res.json();
    if (!res.ok) {
      return { state: 'unknown', answered: false };
    }
    const payload = (data as { data: { state?: string; is_alive?: boolean } }).data;
    const state = payload.state || 'unknown';
    const answered = state === 'answered' || state === 'bridged';
    return { state, answered };
  }
}
