import { Router, type Request } from 'express';
import { config } from '../config';
import { db } from '../store/db';
import { asyncHandler } from '../middleware/auth';
import { SMSService } from '../services/smsService';
import { handleInboundSMS } from '../services/inboundSmsService';
import { sanitizeHTML } from '../utils/sanitizer';
import type { Contact, Conversation, Message } from '../types';

const router = Router();

function paramId(req: Request): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] : id;
}

async function resolveSendContext(body: {
  conversationId?: string;
  contactId?: string;
  to?: string;
}): Promise<{ contact: Contact; conv: Conversation } | null> {
  let { conversationId, contactId, to } = body;
  let contact: Contact | null = null;
  let conv: Conversation | null = null;

  if (conversationId) {
    conv = await db.getConversationById(conversationId);
    if (conv) contact = await db.getContactById(conv.contactId);
  }

  if (!conv && contactId) {
    contact = await db.getContactById(contactId);
    if (contact) conv = await db.getConversationByContactId(contact._id);
  }

  if (!conv && to) {
    const trimmedPhone = to.trim();
    contact = await db.getContactByPhoneNumber(trimmedPhone);
    if (!contact) {
      contact = await db.createContact({
        name: `Contact ${trimmedPhone}`,
        phoneNumber: trimmedPhone,
        businessName: '',
        location: '',
        tags: ['AutoCreated'],
      });
    }
    conv = await db.getConversationByContactId(contact._id);
  }

  if (!contact) return null;

  if (!conv) {
    conv = await db.createConversation({
      contactId: contact._id,
      lastMessageAt: new Date().toISOString(),
      unreadCount: 0,
      status: 'active',
    });
  }

  return { contact, conv };
}

async function dispatchOutboundSms(
  message: Message,
  contact: Contact,
  content: string,
  contentType: 'text' | 'html'
): Promise<Message> {
  const fromNumber = config.sms.fromNumber;
  try {
    const sendResult = await SMSService.sendMessage(contact.phoneNumber, fromNumber, content, contentType);
    const updated = await db.updateMessage(message._id, {
      status: 'sent',
      providerMessageId: sendResult.providerMessageId,
      sendError: '',
    });
    await db.updateConversation(message.conversationId, {
      lastMessageAt: updated?.updatedAt || new Date().toISOString(),
      status: 'active',
    });

    if (config.sms.simulateReplies && sendResult.provider === 'flowcheq-carrier-simulator') {
      setTimeout(() => {
        handleInboundSMS(
          {
            from: contact.phoneNumber,
            to: fromNumber,
            text: `Thanks! We received your message: "${content.substring(0, 80)}"`,
            providerMessageId: `sim_${Date.now()}`,
          },
          'text'
        ).catch((e) => console.error('[sms] Simulated reply failed:', e));
      }, 2000);
    }

    return updated || message;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'SMS dispatch failed';
    const updated = await db.updateMessage(message._id, {
      status: 'failed',
      sendError: errorMessage,
    });
    return updated || { ...message, status: 'failed', sendError: errorMessage };
  }
}

router.post(
  '/send',
  asyncHandler(async (req, res) => {
    let { conversationId, contactId, to, content, contentType } = req.body;

    if (!content || !content.trim()) {
      res.status(400).json({ error: 'Message content cannot be empty.' });
      return;
    }

    const resolvedContentType = contentType === 'html' ? 'html' : 'text';
    if (resolvedContentType === 'html') {
      content = sanitizeHTML(content);
    }

    const ctx = await resolveSendContext({ conversationId, contactId, to });
    if (!ctx) {
      res.status(400).json({ error: 'Active contact could not be resolved.' });
      return;
    }

    const { contact, conv } = ctx;

    const message = await db.createMessage({
      conversationId: conv._id,
      contactId: contact._id,
      direction: 'outbound',
      content,
      contentType: resolvedContentType,
      read: true,
      providerMessageId: '',
      status: 'pending',
    });

    await db.updateConversation(conv._id, { lastMessageAt: message.createdAt, status: 'active' });

    const result = await dispatchOutboundSms(message, contact, content, resolvedContentType);

    if (result.status === 'failed') {
      res.status(502).json({
        error: result.sendError || 'Message dispatch failed.',
        message: result,
        conversationId: conv._id,
      });
      return;
    }

    res.status(201).json(result);
  })
);

router.post(
  '/:id/retry',
  asyncHandler(async (req, res) => {
    const messageId = paramId(req);
    const message = await db.getMessageById(messageId);
    if (!message) {
      res.status(404).json({ error: 'Message not found.' });
      return;
    }
    if (message.direction !== 'outbound' || message.status !== 'failed') {
      res.status(400).json({ error: 'Only failed outbound messages can be retried.' });
      return;
    }

    const contact = await db.getContactById(message.contactId);
    if (!contact) {
      res.status(400).json({ error: 'Contact not found for message.' });
      return;
    }

    await db.updateMessage(messageId, { status: 'pending', sendError: '' });
    const result = await dispatchOutboundSms(
      { ...message, status: 'pending', sendError: '' },
      contact,
      message.content,
      message.contentType
    );

    if (result.status === 'failed') {
      res.status(502).json({
        error: result.sendError || 'Message dispatch failed.',
        message: result,
      });
      return;
    }

    res.json(result);
  })
);

export default router;
