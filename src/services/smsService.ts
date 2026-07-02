import { config, telnyxConfigured, twilioConfigured } from '../config';
import { normalizePhoneToE164 } from '../utils/phone';
import { extractSendTimeErrors } from './smsDeliveryService';

export type SmsProvider = 'telnyx' | 'twilio';

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

async function sendViaTelnyx(to: string, from: string, content: string): Promise<SMSResponse> {
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

  const res = await fetch('https://api.telnyx.com/v2/messages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.telnyx.apiKey}`,
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
    const immediateError = extractSendTimeErrors(data);
    if (immediateError) {
      throw new Error(immediateError);
    }
    return {
      success: true,
      providerMessageId: (data as { data?: { id?: string } }).data?.id || `tlx_${Date.now()}`,
      provider: 'telnyx',
      rawResponse: data,
    };
  }
  throw new Error(telnyxErrorMessage(data, `Telnyx SMS API error (${res.status})`));
}

/**
 * Friendly explanations for common Twilio error codes.
 * Codes appear in REST error responses (`code`) and status callbacks (`ErrorCode`).
 * https://www.twilio.com/docs/api/errors
 */
const TWILIO_ERROR_TEXT: Record<number, string> = {
  20003: 'Twilio authentication failed — check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.',
  20404: 'Twilio resource not found — check the Account SID in TWILIO_ACCOUNT_SID.',
  21211: "Invalid recipient phone number — Twilio requires E.164 format (e.g. +14155552671).",
  21408: 'Twilio account does not have permission to send SMS to this region/country. Enable it under Messaging Geographic Permissions in the Twilio Console.',
  21606: 'The Twilio From number is not SMS-capable for this destination — check TWILIO_PHONE_NUMBER.',
  21608: 'Twilio trial account: the recipient number must first be verified in the Twilio Console (or upgrade the account).',
  21610: 'Recipient has opted out of SMS from this number (replied STOP). They must text START to resubscribe.',
  21612: 'The Twilio From number cannot send SMS to this destination (unsupported route).',
  21614: 'Recipient number is a landline or cannot receive SMS.',
  21617: 'Message body exceeds the 1600 character limit for Twilio SMS.',
  21659: 'TWILIO_PHONE_NUMBER is not a number owned by this Twilio account.',
  30001: 'Twilio queue overflow — sending too many messages too quickly. Retry shortly.',
  30002: 'Twilio account suspended — contact Twilio support.',
  30003: "Recipient's phone is off or unreachable.",
  30004: 'Message blocked by the carrier or the recipient.',
  30005: 'Recipient number is unknown or no longer exists.',
  30006: 'Recipient number is a landline or an unreachable carrier.',
  30007: 'Carrier filtered this message as spam/objectionable content.',
  30008: 'Delivery failed — carrier returned an unknown error.',
  30034: 'US carriers blocked this: the Twilio number is not registered to an approved A2P 10DLC campaign.',
  63038: 'Twilio daily message limit reached for this account.',
};

export function twilioErrorText(code: number | string | undefined, fallback: string): string {
  const numeric = Number(code);
  if (Number.isFinite(numeric) && TWILIO_ERROR_TEXT[numeric]) {
    return `Twilio ${numeric}: ${TWILIO_ERROR_TEXT[numeric]}`;
  }
  return fallback;
}

/** Twilio REST exception body: https://www.twilio.com/docs/usage/twilios-response */
interface TwilioRestException {
  status?: number;
  code?: number;
  message?: string;
  more_info?: string;
}

function twilioApiErrorMessage(data: TwilioRestException, httpStatus: number): string {
  if (data.code !== undefined && TWILIO_ERROR_TEXT[data.code]) {
    return `Twilio ${data.code}: ${TWILIO_ERROR_TEXT[data.code]}`;
  }
  const parts: string[] = [];
  if (data.code !== undefined) parts.push(`Twilio ${data.code}`);
  if (data.message) parts.push(data.message);
  if (data.more_info) parts.push(`(${data.more_info})`);
  return parts.join(': ') || `Twilio SMS API error (HTTP ${httpStatus})`;
}

async function sendViaTwilio(to: string, content: string): Promise<SMSResponse> {
  const { accountSid, authToken, phoneNumber, messagingServiceSid } = config.twilio;

  if (!accountSid || !authToken) {
    throw new Error('Twilio is not configured: set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.');
  }
  if (!phoneNumber && !messagingServiceSid) {
    throw new Error('Twilio is not configured: set TWILIO_PHONE_NUMBER or TWILIO_MESSAGING_SERVICE_SID.');
  }

  const toAddress = normalizePhoneToE164(to);

  // POST /2010-04-01/Accounts/{AccountSid}/Messages.json — form-encoded per Twilio docs.
  // Sender is From OR MessagingServiceSid; StatusCallback receives delivery updates.
  const params = new URLSearchParams({ To: toAddress, Body: content });
  if (messagingServiceSid) {
    params.set('MessagingServiceSid', messagingServiceSid);
  } else {
    params.set('From', normalizePhoneToE164(phoneNumber));
  }
  const statusCallback = twilioStatusCallbackUrl();
  if (statusCallback) {
    params.set('StatusCallback', statusCallback);
  }

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  let res: Response;
  try {
    res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not reach the Twilio API (network error): ${reason}`);
  }

  const raw = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      `Twilio returned an unexpected non-JSON response (HTTP ${res.status}): ${raw.trim().slice(0, 200) || 'empty body'}`
    );
  }

  if (!res.ok) {
    throw new Error(twilioApiErrorMessage(data as TwilioRestException, res.status));
  }

  // Success: Message resource with status queued/accepted/sending.
  // error_code/error_message are null unless the message already failed.
  const d = data as {
    sid?: string;
    status?: string;
    error_code?: number | null;
    error_message?: string | null;
  };
  if (d.status === 'failed' || d.status === 'undelivered' || d.error_code) {
    throw new Error(
      twilioErrorText(d.error_code ?? undefined, d.error_message || `Twilio rejected the message (status: ${d.status})`)
    );
  }

  return {
    success: true,
    providerMessageId: d.sid || `tw_${Date.now()}`,
    provider: 'twilio',
    rawResponse: data,
  };
}

/** Public URL Twilio posts delivery status updates to (same inbound webhook). */
export function twilioStatusCallbackUrl(): string {
  const base = (config.telnyx.webhookBaseUrl || config.appUrl || '').replace(/\/$/, '');
  if (!base || base.includes('localhost')) return '';
  return `${base}/webhook/inbound`;
}

/** Pick a usable provider: requested if configured, else any configured one. */
export function resolveSmsProvider(requested?: string): SmsProvider | null {
  const wanted = requested === 'twilio' || requested === 'telnyx' ? requested : config.sms.defaultProvider;
  if (wanted === 'twilio' && twilioConfigured()) return 'twilio';
  if (wanted === 'telnyx' && telnyxConfigured()) return 'telnyx';
  // Requested provider not configured — fall back to whichever is
  if (telnyxConfigured()) return 'telnyx';
  if (twilioConfigured()) return 'twilio';
  return null;
}

export function smsProvidersStatus(): {
  providers: { id: SmsProvider; configured: boolean; fromNumber: string }[];
  defaultProvider: SmsProvider;
} {
  return {
    providers: [
      { id: 'telnyx', configured: telnyxConfigured(), fromNumber: config.telnyx.phoneNumber },
      {
        id: 'twilio',
        configured: twilioConfigured(),
        fromNumber: config.twilio.phoneNumber || config.twilio.messagingServiceSid,
      },
    ],
    defaultProvider: config.sms.defaultProvider,
  };
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
    contentType: 'text' | 'html' = 'text',
    provider?: string
  ): Promise<SMSResponse> {
    const resolved = resolveSmsProvider(provider);
    console.log(`[sms] Sending ${contentType} via ${resolved || 'simulator'} to ${to}`);

    if (!resolved) {
      const simulatedId = `sim_${Math.random().toString(36).substring(2, 11)}`;
      return {
        success: true,
        providerMessageId: simulatedId,
        provider: 'flowcheq-carrier-simulator',
      };
    }

    try {
      if (resolved === 'twilio') {
        return await sendViaTwilio(to, content);
      }
      return await sendViaTelnyx(to, from, content);
    } catch (err) {
      const message = SMSService.formatError(err);
      console.error(`[sms] ${resolved} failed:`, message);
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
