import type {
  CallRecord,
  Contact,
  Conversation,
  LinkAnalyticsRow,
  LinkAnalyticsSummary,
  LinkClick,
  Message,
  Notification,
  TrackedLink,
} from '../types';
import {
  CallModel,
  ContactModel,
  ConversationModel,
  LinkClickModel,
  MessageModel,
  NotificationModel,
  TrackedLinkModel,
} from './schemas';

function prefixedId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).substring(2, 11)}`;
}

function normalizePhone(phone: string): string {
  return phone.replace(/\s/g, '');
}

function toIso(value: Date | string | undefined): string {
  if (!value) return new Date().toISOString();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toContact(doc: Record<string, unknown>): Contact {
  return {
    _id: String(doc._id),
    name: String(doc.name),
    phoneNumber: String(doc.phoneNumber),
    businessName: String(doc.businessName || ''),
    location: String(doc.location || ''),
    website: String(doc.website || ''),
    tags: Array.isArray(doc.tags) ? (doc.tags as string[]) : [],
    createdAt: toIso(doc.createdAt as Date | string),
    updatedAt: toIso(doc.updatedAt as Date | string),
  };
}

function toConversation(doc: Record<string, unknown>): Conversation {
  return {
    _id: String(doc._id),
    contactId: String(doc.contactId),
    lastMessageAt: toIso(doc.lastMessageAt as Date | string),
    unreadCount: Number(doc.unreadCount) || 0,
    status: (doc.status as Conversation['status']) || 'active',
    createdAt: toIso(doc.createdAt as Date | string),
    updatedAt: toIso(doc.updatedAt as Date | string),
  };
}

function toMessage(doc: Record<string, unknown>): Message {
  const direction = doc.direction as Message['direction'];
  const rawStatus = doc.status as Message['status'] | undefined;
  const status = rawStatus || 'sent';
  return {
    _id: String(doc._id),
    conversationId: String(doc.conversationId),
    contactId: String(doc.contactId),
    direction,
    content: String(doc.content),
    contentType: (doc.contentType as Message['contentType']) || 'text',
    read: Boolean(doc.read),
    providerMessageId: String(doc.providerMessageId || ''),
    status,
    sendError: doc.sendError ? String(doc.sendError) : undefined,
    trackLinks: Boolean(doc.trackLinks),
    createdAt: toIso(doc.createdAt as Date | string),
    updatedAt: toIso(doc.updatedAt as Date | string),
  };
}

function randomSlug(): string {
  return Math.random().toString(36).substring(2, 12);
}

function toTrackedLink(doc: Record<string, unknown>): TrackedLink {
  return {
    _id: String(doc._id),
    slug: String(doc.slug),
    messageId: String(doc.messageId),
    contactId: String(doc.contactId),
    conversationId: String(doc.conversationId),
    originalUrl: String(doc.originalUrl),
    clickCount: Number(doc.clickCount) || 0,
    createdAt: toIso(doc.createdAt as Date | string),
    updatedAt: toIso(doc.updatedAt as Date | string),
  };
}

function toLinkClick(doc: Record<string, unknown>): LinkClick {
  return {
    _id: String(doc._id),
    linkId: String(doc.linkId),
    messageId: String(doc.messageId),
    contactId: String(doc.contactId),
    userAgent: String(doc.userAgent || ''),
    referer: String(doc.referer || ''),
    ip: String(doc.ip || ''),
    clickedAt: toIso(doc.clickedAt as Date | string),
  };
}

function toNotification(doc: Record<string, unknown>): Notification {
  return {
    _id: String(doc._id),
    type: doc.type as Notification['type'],
    message: String(doc.message),
    read: Boolean(doc.read),
    createdAt: toIso(doc.createdAt as Date | string),
    updatedAt: toIso(doc.updatedAt as Date | string),
  };
}

function mapVoiceStatusToFlowcheq(status: string | undefined): CallRecord['status'] {
  switch (status) {
    case 'initiated':
      return 'ringing';
    case 'human_handled':
    case 'ai_handled':
    case 'forwarded':
    case 'escalated':
      return 'in-progress';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'missed';
    default:
      if (status === 'ringing' || status === 'in-progress' || status === 'no-answer') {
        return status as CallRecord['status'];
      }
      return 'completed';
  }
}

function mapFlowcheqStatusToVoice(status: CallRecord['status']): string {
  switch (status) {
    case 'ringing':
      return 'initiated';
    case 'in-progress':
      return 'human_handled';
    case 'completed':
      return 'completed';
    case 'missed':
    case 'no-answer':
      return 'failed';
    default:
      return status;
  }
}

function toCallRecord(doc: Record<string, unknown>): CallRecord {
  const mongoId = doc._id ? String(doc._id) : prefixedId('call');
  const providerCallId = doc.call_id ? String(doc.call_id) : mongoId;
  return {
    _id: mongoId,
    contactId: String(doc.contact_id || ''),
    direction: (doc.direction as CallRecord['direction']) || 'inbound',
    status: mapVoiceStatusToFlowcheq(doc.status as string | undefined),
    duration: Number(doc.duration_seconds ?? doc.duration ?? 0),
    createdAt: toIso(doc.createdAt as Date | string),
    notes: doc.notes ? String(doc.notes) : undefined,
    providerCallId,
    telnyxCallControlId: doc.telnyx_call_control_id ? String(doc.telnyx_call_control_id) : undefined,
    handledBy: doc.handled_by as CallRecord['handledBy'],
    summary: doc.summary ? String(doc.summary) : undefined,
    leadScore: doc.lead_score != null ? Number(doc.lead_score) : undefined,
    transcript: doc.transcript ? String(doc.transcript) : undefined,
  };
}

class Database {
  async getContacts(): Promise<Contact[]> {
    const docs = await ContactModel.find().sort({ updatedAt: -1 }).lean();
    return docs.map((d) => toContact(d as Record<string, unknown>));
  }

  async getConversations(): Promise<Conversation[]> {
    const docs = await ConversationModel.find().lean();
    return docs.map((d) => toConversation(d as Record<string, unknown>));
  }

  async getMessages(): Promise<Message[]> {
    const docs = await MessageModel.find().lean();
    return docs.map((d) => toMessage(d as Record<string, unknown>));
  }

  async getNotifications(): Promise<Notification[]> {
    const docs = await NotificationModel.find().sort({ createdAt: -1 }).lean();
    return docs.map((d) => toNotification(d as Record<string, unknown>));
  }

  async getCalls(): Promise<CallRecord[]> {
    const docs = await CallModel.find().sort({ createdAt: -1 }).lean();
    return docs.map((d) => toCallRecord(d as Record<string, unknown>));
  }

  async createContact(contact: Omit<Contact, '_id' | 'createdAt' | 'updatedAt'>): Promise<Contact> {
    const existing = await ContactModel.findOne({ phoneNumber: contact.phoneNumber.trim() });
    if (existing) {
      throw new Error(`Contact with phoneNumber ${contact.phoneNumber} already exists.`);
    }
    const doc = await ContactModel.create({
      _id: prefixedId('con'),
      ...contact,
      phoneNumber: contact.phoneNumber.trim(),
    });
    return toContact(doc.toObject() as Record<string, unknown>);
  }

  async updateContact(id: string, updates: Partial<Contact>): Promise<Contact | null> {
    const doc = await ContactModel.findOneAndUpdate(
      { _id: id },
      { $set: { ...updates, updatedAt: new Date() } },
      { new: true }
    ).lean();
    return doc ? toContact(doc as Record<string, unknown>) : null;
  }

  async getContactById(id: string): Promise<Contact | null> {
    const doc = await ContactModel.findOne({ _id: id }).lean();
    return doc ? toContact(doc as Record<string, unknown>) : null;
  }

  async getContactByPhoneNumber(phone: string): Promise<Contact | null> {
    const normalized = normalizePhone(phone);
    const docs = await ContactModel.find().lean();
    const doc = docs.find(
      (c) =>
        normalizePhone(String(c.phoneNumber)) === normalized ||
        String(c.phoneNumber).endsWith(normalized.slice(-10))
    );
    return doc ? toContact(doc as Record<string, unknown>) : null;
  }

  async deleteContact(id: string): Promise<boolean> {
    const result = await ContactModel.deleteOne({ _id: id });
    if (result.deletedCount === 0) return false;
    await Promise.all([
      ConversationModel.deleteMany({ contactId: id }),
      MessageModel.deleteMany({ contactId: id }),
      CallModel.deleteMany({ contact_id: id }),
    ]);
    return true;
  }

  async createConversation(conv: Omit<Conversation, '_id' | 'createdAt' | 'updatedAt'>): Promise<Conversation> {
    const doc = await ConversationModel.create({
      _id: prefixedId('chat'),
      ...conv,
      lastMessageAt: conv.lastMessageAt ? new Date(conv.lastMessageAt) : new Date(),
    });
    return toConversation(doc.toObject() as Record<string, unknown>);
  }

  async getConversationById(id: string): Promise<Conversation | null> {
    const doc = await ConversationModel.findOne({ _id: id }).lean();
    return doc ? toConversation(doc as Record<string, unknown>) : null;
  }

  async getConversationByContactId(contactId: string): Promise<Conversation | null> {
    const doc = await ConversationModel.findOne({ contactId }).lean();
    return doc ? toConversation(doc as Record<string, unknown>) : null;
  }

  async updateConversation(id: string, updates: Partial<Conversation>): Promise<Conversation | null> {
    const set: Record<string, unknown> = { ...updates, updatedAt: new Date() };
    if (updates.lastMessageAt) set.lastMessageAt = new Date(updates.lastMessageAt);
    const doc = await ConversationModel.findOneAndUpdate({ _id: id }, { $set: set }, { new: true }).lean();
    return doc ? toConversation(doc as Record<string, unknown>) : null;
  }

  async createMessage(msg: Omit<Message, '_id' | 'createdAt' | 'updatedAt'>): Promise<Message> {
    const doc = await MessageModel.create({ _id: prefixedId('msg'), ...msg });
    await this.touchConversationForMessage(msg);
    return toMessage(doc.toObject() as Record<string, unknown>);
  }

  async updateMessage(id: string, updates: Partial<Message>): Promise<Message | null> {
    const doc = await MessageModel.findOneAndUpdate(
      { _id: id },
      { $set: { ...updates, updatedAt: new Date() } },
      { new: true }
    ).lean();
    return doc ? toMessage(doc as Record<string, unknown>) : null;
  }

  async getMessageById(id: string): Promise<Message | null> {
    const doc = await MessageModel.findOne({ _id: id }).lean();
    return doc ? toMessage(doc as Record<string, unknown>) : null;
  }

  private async touchConversationForMessage(msg: {
    conversationId: string;
    direction: Message['direction'];
    read: boolean;
  }): Promise<void> {
    const conv = await ConversationModel.findOne({ _id: msg.conversationId });
    if (!conv) return;
    conv.set('lastMessageAt', new Date());
    if (msg.direction === 'inbound' && !msg.read) {
      conv.set('unreadCount', Number(conv.get('unreadCount') || 0) + 1);
    }
    conv.set('updatedAt', new Date());
    await conv.save();
  }

  async markMessagesAsRead(conversationId: string): Promise<void> {
    await MessageModel.updateMany(
      { conversationId, direction: 'inbound', read: false },
      { $set: { read: true, updatedAt: new Date() } }
    );
    await ConversationModel.updateOne(
      { _id: conversationId },
      { $set: { unreadCount: 0, updatedAt: new Date() } }
    );
  }

  async createNotification(ntf: Omit<Notification, '_id' | 'createdAt' | 'updatedAt'>): Promise<Notification> {
    const doc = await NotificationModel.create({ _id: prefixedId('ntf'), ...ntf });
    return toNotification(doc.toObject() as Record<string, unknown>);
  }

  async markNotificationsAsRead(): Promise<void> {
    await NotificationModel.updateMany({}, { $set: { read: true, updatedAt: new Date() } });
  }

  async updateNotification(id: string, updates: Partial<Notification>): Promise<Notification | null> {
    const doc = await NotificationModel.findOneAndUpdate(
      { _id: id },
      { $set: { ...updates, updatedAt: new Date() } },
      { new: true }
    ).lean();
    return doc ? toNotification(doc as Record<string, unknown>) : null;
  }

  async createCall(call: Omit<CallRecord, '_id' | 'createdAt'>): Promise<CallRecord> {
    const callId = call.providerCallId || prefixedId('call');
    const doc = await CallModel.create({
      call_id: callId,
      contact_id: call.contactId,
      direction: call.direction,
      status: mapFlowcheqStatusToVoice(call.status),
      duration_seconds: call.duration ?? 0,
      handled_by: call.handledBy,
      notes: call.notes,
      summary: call.summary,
      lead_score: call.leadScore,
      transcript: call.transcript,
      telnyx_call_control_id: call.telnyxCallControlId,
    });
    return toCallRecord(doc.toObject() as Record<string, unknown>);
  }

  async updateCall(id: string, updates: Partial<CallRecord>): Promise<CallRecord | null> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.contactId !== undefined) set.contact_id = updates.contactId;
    if (updates.direction !== undefined) set.direction = updates.direction;
    if (updates.status !== undefined) set.status = mapFlowcheqStatusToVoice(updates.status);
    if (updates.duration !== undefined) set.duration_seconds = updates.duration;
    if (updates.handledBy !== undefined) set.handled_by = updates.handledBy;
    if (updates.notes !== undefined) set.notes = updates.notes;
    if (updates.summary !== undefined) set.summary = updates.summary;
    if (updates.leadScore !== undefined) set.lead_score = updates.leadScore;
    if (updates.transcript !== undefined) set.transcript = updates.transcript;
    if (updates.providerCallId !== undefined) set.call_id = updates.providerCallId;
    if (updates.telnyxCallControlId !== undefined) set.telnyx_call_control_id = updates.telnyxCallControlId;

    const doc = await CallModel.findOneAndUpdate(
      { $or: [{ _id: id }, { call_id: id }] },
      { $set: set },
      { new: true }
    ).lean();
    return doc ? toCallRecord(doc as Record<string, unknown>) : null;
  }

  async updateCallNotes(callId: string, notes: string): Promise<CallRecord | null> {
    return this.updateCall(callId, { notes });
  }

  async findCallByProviderId(providerCallId: string): Promise<CallRecord | null> {
    const doc = await CallModel.findOne({ call_id: providerCallId }).lean();
    return doc ? toCallRecord(doc as Record<string, unknown>) : null;
  }

  async upsertCallByProvider(
    providerCallId: string,
    data: Omit<CallRecord, '_id' | 'createdAt'> & Partial<CallRecord>
  ): Promise<CallRecord> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (data.contactId) set.contact_id = data.contactId;
    if (data.direction) set.direction = data.direction;
    if (data.status) set.status = mapFlowcheqStatusToVoice(data.status);
    if (data.duration !== undefined) set.duration_seconds = data.duration;
    if (data.handledBy) set.handled_by = data.handledBy;
    if (data.notes !== undefined) set.notes = data.notes;
    if (data.summary !== undefined) set.summary = data.summary;
    if (data.leadScore !== undefined) set.lead_score = data.leadScore;
    if (data.transcript !== undefined) set.transcript = data.transcript;
    if (data.telnyxCallControlId) set.telnyx_call_control_id = data.telnyxCallControlId;

    const doc = await CallModel.findOneAndUpdate(
      { call_id: providerCallId },
      {
        $set: set,
        $setOnInsert: { call_id: providerCallId, createdAt: new Date() },
      },
      { upsert: true, new: true }
    ).lean();

    return toCallRecord(doc as Record<string, unknown>);
  }

  async createTrackedLink(
    link: Omit<TrackedLink, '_id' | 'clickCount' | 'createdAt' | 'updatedAt'> & { slug?: string }
  ): Promise<TrackedLink> {
    let slug = link.slug || randomSlug();
    for (let attempt = 0; attempt < 5; attempt++) {
      const exists = await TrackedLinkModel.findOne({ slug }).lean();
      if (!exists) break;
      slug = randomSlug();
    }
    const doc = await TrackedLinkModel.create({
      _id: prefixedId('lnk'),
      slug,
      messageId: link.messageId,
      contactId: link.contactId,
      conversationId: link.conversationId,
      originalUrl: link.originalUrl,
      clickCount: 0,
    });
    return toTrackedLink(doc.toObject() as Record<string, unknown>);
  }

  async getTrackedLinkBySlug(slug: string): Promise<TrackedLink | null> {
    const doc = await TrackedLinkModel.findOne({ slug }).lean();
    return doc ? toTrackedLink(doc as Record<string, unknown>) : null;
  }

  async incrementTrackedLinkClicks(linkId: string): Promise<void> {
    await TrackedLinkModel.updateOne(
      { _id: linkId },
      { $inc: { clickCount: 1 }, $set: { updatedAt: new Date() } }
    );
  }

  async createLinkClick(
    click: Omit<LinkClick, '_id' | 'clickedAt'>
  ): Promise<LinkClick> {
    const doc = await LinkClickModel.create({
      _id: prefixedId('clk'),
      ...click,
      clickedAt: new Date(),
    });
    return toLinkClick(doc.toObject() as Record<string, unknown>);
  }

  async getLinkAnalytics(): Promise<{ summary: LinkAnalyticsSummary; links: LinkAnalyticsRow[] }> {
    const links = await TrackedLinkModel.find().sort({ updatedAt: -1 }).lean();
    const clicks = await LinkClickModel.find().sort({ clickedAt: -1 }).lean();
    const contacts = await ContactModel.find().lean();
    const contactNameById = new Map(contacts.map((c) => [String(c._id), String(c.name)]));

    const clicksByLink = new Map<string, Record<string, unknown>[]>();
    for (const raw of clicks) {
      const linkId = String(raw.linkId);
      const list = clicksByLink.get(linkId) || [];
      list.push(raw);
      clicksByLink.set(linkId, list);
    }

    const rows: LinkAnalyticsRow[] = links.map((raw) => {
      const link = toTrackedLink(raw as Record<string, unknown>);
      const linkClicks = (clicksByLink.get(link._id) || []).map((c) =>
        toLinkClick(c as Record<string, unknown>)
      );
      return {
        linkId: link._id,
        slug: link.slug,
        originalUrl: link.originalUrl,
        messageId: link.messageId,
        contactId: link.contactId,
        contactName: contactNameById.get(link.contactId) || 'Unknown',
        clickCount: link.clickCount,
        lastClickedAt: linkClicks[0]?.clickedAt || null,
        recentClicks: linkClicks.slice(0, 10),
      };
    });

    const totalClicks = clicks.length;
    const linksWithClicks = rows.filter((r) => r.clickCount > 0).length;

    return {
      summary: {
        totalClicks,
        totalLinks: rows.length,
        linksWithClicks,
      },
      links: rows,
    };
  }
}

export const db = new Database();
