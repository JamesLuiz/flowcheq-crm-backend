import { config } from '../config';
import { normalizePhoneToE164 } from '../utils/phone';

export interface InboundSMSPayload {
  from: string;
  to: string;
  text: string;
  providerMessageId: string;
}

export interface SMSResponse {
  success: boolean;
  providerMessageId: string;
  provider: string;
  rawResponse?: unknown;
  error?: string;
}

function telnyxErrorMessage(data: unknown, fallback: string): string {
  const err = (data as { errors?: { title?: string; detail?: string; code?: string }[] }).errors?.[0];
  const parts = [err?.code, err?.title, err?.detail].filter(Boolean);
  return parts.join(': ') || fallback;
}

export class SMSService {
  static formatError(err: unknown): string {
    if (err instanceof Error && err.message.trim()) return err.message.trim();
    if (typeof err === 'string' && err.trim()) return err.trim();
    return 'SMS dispatch failed';
  }

  static async sendMessage(
    to: string,
    from: string,
    content: string,
    contentType: 'text' | 'html' = 'text'
  ): Promise<SMSResponse> {
    console.log(`[sms] Sending ${contentType} from ${from} to ${to}`);

    const telnyxApiKey = config.telnyx.apiKey;
    if (!telnyxApiKey) {
      const simulatedId = `sim_${Math.random().toString(36).substring(2, 11)}`;
      return {
        success: true,
        providerMessageId: simulatedId,
        provider: 'flowcheq-carrier-simulator',
      };
    }

    const fromAddress = normalizePhoneToE164(from || config.telnyx.phoneNumber);
    const toAddress = normalizePhoneToE164(to);

    const body: Record<string, string> = {
      from: fromAddress,
      to: toAddress,
      text: content,
    };
    if (config.telnyx.messagingProfileId) {
      body.messaging_profile_id = config.telnyx.messagingProfileId;
    }

    try {
      const res = await fetch('https://api.telnyx.com/v2/messages', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${telnyxApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const raw = await res.text();
      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(raw.trim() || `Telnyx SMS API error (${res.status})`);
      }
      if (res.ok) {
        return {
          success: true,
          providerMessageId: (data as { data?: { id?: string } }).data?.id || `tlx_${Date.now()}`,
          provider: 'telnyx',
          rawResponse: data,
        };
      }
      throw new Error(telnyxErrorMessage(data, `Telnyx SMS API error (${res.status})`));
    } catch (err) {
      const message = SMSService.formatError(err);
      console.error('[sms] Telnyx failed:', message);
      throw new Error(message);
    }
  }

  static normalizeInbound(rawPayload: Record<string, unknown>, provider: 'twilio' | 'telnyx' | 'generic'): InboundSMSPayload {
    if (provider === 'twilio') {
      const p = rawPayload as Record<string, string>;
      return {
        from: p.From || '',
        to: p.To || '',
        text: p.Body || '',
        providerMessageId: p.MessageSid || `tw_msg_${Date.now()}`,
      };
    }

    if (provider === 'telnyx') {
      const data = rawPayload.data as { id?: string; payload?: { from?: { phone_number?: string }; to?: { phone_number?: string }[]; text?: string } };
      const payload = data?.payload || {};
      return {
        from: payload.from?.phone_number || '',
        to: payload.to?.[0]?.phone_number || '',
        text: payload.text || '',
        providerMessageId: data?.id || `tx_msg_${Date.now()}`,
      };
    }

    const p = rawPayload as { from?: string; to?: string; text?: string; providerMessageId?: string };
    return {
      from: p.from || '',
      to: p.to || '',
      text: p.text || '',
      providerMessageId: p.providerMessageId || `gen_msg_${Date.now()}`,
    };
  }
}
