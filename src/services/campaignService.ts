import { config } from '../config';
import { db } from '../store/db';
import type { Contact } from '../types';
import { wrapLinksInMessage } from './linkTrackingService';
import { SMSService } from './smsService';
import { getInsightByContactId } from './insightService';

const CONSULTATION_URL = () => config.campaign.consultationUrl;

export interface BulkSendResult {
  sent: number;
  failed: number;
  skipped: number;
  results: { contactId: string; status: 'sent' | 'failed' | 'skipped'; error?: string }[];
}

function ensureConsultationLink(text: string): string {
  const url = CONSULTATION_URL();
  if (text.includes(url)) return text;
  return `${text.trim()}\n\nBook your consultation: ${url}`;
}

async function resolveMessageForContact(
  contact: Contact,
  template?: string,
  useAiMessage?: boolean
): Promise<string> {
  if (template?.trim()) return ensureConsultationLink(template);

  if (useAiMessage) {
    const insight = await getInsightByContactId(contact._id);
    const aiText = insight?.suggestedMessages?.[0]?.text;
    if (aiText?.trim()) return ensureConsultationLink(aiText);
  }

  return ensureConsultationLink(
    `Hi ${contact.name}, Flowcheq helps ${contact.businessName || contact.name} turn conversations into booked consultations.`
  );
}

async function sendTrackedSms(
  contact: Contact,
  content: string
): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  let conv = await db.getConversationByContactId(contact._id);
  if (!conv) {
    conv = await db.createConversation({
      contactId: contact._id,
      lastMessageAt: new Date().toISOString(),
      unreadCount: 0,
      status: 'active',
    });
  }

  const message = await db.createMessage({
    conversationId: conv._id,
    contactId: contact._id,
    direction: 'outbound',
    content,
    contentType: 'text',
    read: true,
    providerMessageId: '',
    status: 'pending',
    trackLinks: true,
  });

  let outbound = await wrapLinksInMessage({
    content,
    contentType: 'text',
    messageId: message._id,
    contactId: contact._id,
    conversationId: conv._id,
  });

  if (outbound !== content) {
    await db.updateMessage(message._id, { content: outbound });
  }

  const fromNumber = config.sms.fromNumber;
  try {
    const result = await SMSService.sendMessage(contact.phoneNumber, fromNumber, outbound, 'text');
    await db.updateMessage(message._id, {
      status: 'sent',
      providerMessageId: result.providerMessageId,
      sendError: '',
    });
    await db.updateConversation(conv._id, {
      lastMessageAt: new Date().toISOString(),
      status: 'active',
    });
    return { ok: true, messageId: message._id };
  } catch (e) {
    const err = e instanceof Error ? e.message : 'Send failed';
    await db.updateMessage(message._id, { status: 'failed', sendError: err });
    return { ok: false, error: err };
  }
}

export async function bulkSendCampaign(options: {
  contactIds?: string[];
  messageTemplate?: string;
  useAiMessages?: boolean;
}): Promise<BulkSendResult> {
  const all = await db.getContacts();
  const targets =
    options.contactIds?.length ?
      all.filter((c) => options.contactIds!.includes(c._id))
    : all;

  const result: BulkSendResult = { sent: 0, failed: 0, skipped: 0, results: [] };

  for (const contact of targets) {
    if (!contact.phoneNumber?.trim()) {
      result.skipped++;
      result.results.push({ contactId: contact._id, status: 'skipped', error: 'No phone' });
      continue;
    }

    const text = await resolveMessageForContact(contact, options.messageTemplate, options.useAiMessages);
    const outcome = await sendTrackedSms(contact, text);
    if (outcome.ok) {
      result.sent++;
      result.results.push({ contactId: contact._id, status: 'sent' });
    } else {
      result.failed++;
      result.results.push({ contactId: contact._id, status: 'failed', error: outcome.error });
    }
  }

  return result;
}
