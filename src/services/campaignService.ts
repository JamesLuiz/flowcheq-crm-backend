import { config } from '../config';
import { db } from '../store/db';
import type { Contact } from '../types';
import { wrapLinksInMessage } from './linkTrackingService';
import { SMSService } from './smsService';
import { getInsightByContactId } from './insightService';
import {
  applyMergeFields,
  ensureConsultationLink,
  consultationUrl,
} from '../utils/campaignMessage';

export interface BulkSendResult {
  sent: number;
  failed: number;
  skipped: number;
  results: { contactId: string; status: 'sent' | 'failed' | 'skipped'; error?: string }[];
}

export interface BulkCampaignOptions {
  contactIds?: string[];
  /** Only send to contacts that have at least one of these tags */
  tagFilter?: string[];
  messageTemplate?: string;
  useAiMessages?: boolean;
  /** When false, same template text for every contact (no merge fields) */
  personalizeTemplate?: boolean;
  trackLinks?: boolean;
  includeConsultationUrl?: boolean;
  /** SMS provider override (telnyx | twilio) */
  provider?: string;
}

export interface CampaignPreviewResult {
  message: string;
  contactId: string;
  contactName: string;
  consultationUrl: string;
}

async function resolveMessageForContact(
  contact: Contact,
  options: BulkCampaignOptions
): Promise<string> {
  const includeConsult = options.includeConsultationUrl !== false;
  const template = options.messageTemplate?.trim();
  const useAi = options.useAiMessages !== false;

  if (useAi) {
    const insight = await getInsightByContactId(contact._id);
    const aiText = insight?.suggestedMessages?.[0]?.text;
    if (aiText?.trim()) {
      return ensureConsultationLink(aiText, includeConsult);
    }
  }

  if (template) {
    const body =
      options.personalizeTemplate !== false ?
        applyMergeFields(template, contact)
      : template;
    return ensureConsultationLink(body, includeConsult);
  }

  return ensureConsultationLink(
    applyMergeFields(
      `Hi {{name}}, Flowcheq helps {{businessName}} turn conversations into booked consultations.`,
      contact
    ),
    includeConsult
  );
}

function resolveTargets(all: Contact[], options: BulkCampaignOptions): Contact[] {
  let targets = all;

  if (options.contactIds?.length) {
    const idSet = new Set(options.contactIds);
    targets = targets.filter((c) => idSet.has(c._id));
  }

  if (options.tagFilter?.length) {
    const tags = new Set(options.tagFilter);
    targets = targets.filter((c) => (c.tags || []).some((t) => tags.has(t)));
  }

  return targets;
}

async function sendCampaignSms(
  contact: Contact,
  content: string,
  trackLinks: boolean,
  provider?: string
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
    trackLinks,
  });

  let outbound = content;
  if (trackLinks) {
    outbound = await wrapLinksInMessage({
      content,
      contentType: 'text',
      messageId: message._id,
      contactId: contact._id,
      conversationId: conv._id,
    });
    if (outbound !== content) {
      await db.updateMessage(message._id, { content: outbound });
    }
  }

  const fromNumber = config.sms.fromNumber;
  try {
    const result = await SMSService.sendMessage(contact.phoneNumber, fromNumber, outbound, 'text', provider);
    await db.updateMessage(message._id, {
      status: 'sent',
      providerMessageId: result.providerMessageId,
      provider: result.provider,
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

export async function previewCampaignMessage(options: {
  contactId?: string;
  messageTemplate?: string;
  useAiMessages?: boolean;
  personalizeTemplate?: boolean;
  includeConsultationUrl?: boolean;
}): Promise<CampaignPreviewResult | null> {
  const all = await db.getContacts();
  const contact =
    (options.contactId ? all.find((c) => c._id === options.contactId) : null) ||
    all.find((c) => c.phoneNumber?.trim()) ||
    all[0];

  if (!contact) return null;

  const message = await resolveMessageForContact(contact, {
    messageTemplate: options.messageTemplate,
    useAiMessages: options.useAiMessages,
    personalizeTemplate: options.personalizeTemplate,
    includeConsultationUrl: options.includeConsultationUrl,
  });

  return {
    message,
    contactId: contact._id,
    contactName: contact.name,
    consultationUrl: consultationUrl(),
  };
}

export async function bulkSendCampaign(options: BulkCampaignOptions): Promise<BulkSendResult> {
  const all = await db.getContacts();
  const targets = resolveTargets(all, options);
  const trackLinks = options.trackLinks !== false;

  const result: BulkSendResult = { sent: 0, failed: 0, skipped: 0, results: [] };

  for (const contact of targets) {
    if (!contact.phoneNumber?.trim()) {
      result.skipped++;
      result.results.push({ contactId: contact._id, status: 'skipped', error: 'No phone' });
      continue;
    }

    const text = await resolveMessageForContact(contact, options);
    const outcome = await sendCampaignSms(contact, text, trackLinks, options.provider);
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

export async function countCampaignTargets(options: BulkCampaignOptions): Promise<number> {
  const all = await db.getContacts();
  return resolveTargets(all, options).filter((c) => c.phoneNumber?.trim()).length;
}
