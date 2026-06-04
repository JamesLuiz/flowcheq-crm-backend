import { db } from '../store/db';
import type { Contact } from '../types';

export async function handleInboundSMS(
  normalized: { from: string; to: string; text: string; providerMessageId: string },
  contentType: 'text' | 'html' = 'text'
) {
  let contact = await db.getContactByPhoneNumber(normalized.from);
  if (!contact) {
    contact = await db.createContact({
      name: `Inbound Contact (${normalized.from})`,
      phoneNumber: normalized.from,
      businessName: '',
      location: 'Inbound Channel',
      website: '',
      tags: ['NewLead'],
    });
  }

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
    direction: 'inbound',
    content: normalized.text,
    contentType,
    read: false,
    providerMessageId: normalized.providerMessageId,
    status: 'sent',
  });

  await db.createNotification({
    type: 'new_message',
    message: `New message from ${contact.name}: ${normalized.text.substring(0, 40)}...`,
    read: false,
  });

  return { contact, conv, message };
}

export async function resolveOrCreateContactByPhone(
  phoneNumber: string,
  nameHint?: string
): Promise<Contact> {
  let contact = await db.getContactByPhoneNumber(phoneNumber);
  if (!contact) {
    contact = await db.createContact({
      name: nameHint || `Contact (${phoneNumber})`,
      phoneNumber,
      businessName: '',
      location: '',
      website: '',
      tags: ['VoiceLead'],
    });
  }
  return contact;
}
