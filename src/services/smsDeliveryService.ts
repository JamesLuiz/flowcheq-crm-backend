import { db } from '../store/db';
import { telnyxSmsWebhookUrl } from '../config';

type TelnyxMsgError = { code?: string; title?: string; detail?: string };

function formatTelnyxErrors(errors: TelnyxMsgError[] | undefined, fallback: string): string {
  const err = errors?.[0];
  const parts = [err?.code, err?.title, err?.detail].filter(Boolean);
  return parts.join(': ') || fallback;
}

function isFailedDeliveryStatus(status?: string): boolean {
  return status === 'delivery_failed' || status === 'sending_failed';
}

/** Apply async Telnyx delivery result to our outbound message row. */
export async function handleSmsDeliveryWebhook(body: Record<string, unknown>): Promise<void> {
  const data = body.data as {
    event_type?: string;
    id?: string;
    payload?: {
      id?: string;
      errors?: TelnyxMsgError[];
      to?: { phone_number?: string; status?: string }[];
    };
  };

  const eventType = data?.event_type;
  if (eventType !== 'message.finalized' && eventType !== 'message.sent') return;

  const payload = data.payload || {};
  const providerMessageId = String(payload.id || data.id || '');
  if (!providerMessageId) return;

  const toEntry = payload.to?.[0];
  const status = toEntry?.status;
  const errors = payload.errors;

  if (!isFailedDeliveryStatus(status) && !(errors && errors.length > 0)) {
    if (eventType === 'message.finalized' && status === 'delivered') {
      const msg = await db.getMessageByProviderId(providerMessageId);
      if (msg && msg.status === 'pending') {
        await db.updateMessage(msg._id, { status: 'sent', sendError: '' });
      }
    }
    return;
  }

  const sendError = formatTelnyxErrors(
    errors,
    status === 'delivery_failed' ?
      'SMS delivery failed at carrier.'
    : 'SMS sending failed at carrier.'
  );

  const message = await db.getMessageByProviderId(providerMessageId);
  if (!message) {
    console.warn(`[sms-delivery] No message for provider id ${providerMessageId}: ${sendError}`);
    return;
  }

  if (message.status === 'failed' && message.sendError === sendError) return;

  await db.updateMessage(message._id, { status: 'failed', sendError });
  console.error(`[sms-delivery] Message ${message._id} failed: ${sendError}`);
}

export function extractSendTimeErrors(data: unknown): string | null {
  const payload = (data as { data?: { errors?: TelnyxMsgError[]; to?: { status?: string }[] } }).data;
  if (!payload) return null;

  if (payload.errors?.length) {
    return formatTelnyxErrors(payload.errors, 'Telnyx SMS error');
  }

  const status = payload.to?.[0]?.status;
  if (isFailedDeliveryStatus(status)) {
    return formatTelnyxErrors(payload.errors, `SMS ${status}`);
  }

  return null;
}

export { telnyxSmsWebhookUrl };
