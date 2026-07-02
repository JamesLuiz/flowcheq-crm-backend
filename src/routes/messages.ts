import { Router, type Request } from 'express';
import { config } from '../config';
import { db } from '../store/db';
import { asyncHandler } from '../middleware/auth';
import { SMSService, resolveSmsProvider, smsProvidersStatus } from '../services/smsService';
import { handleInboundSMS } from '../services/inboundSmsService';
import { sanitizeHTML } from '../utils/sanitizer';
import { wrapLinksInMessage } from '../services/linkTrackingService';
import { ensureSmsCheck, isNonMobileTelnyxError } from '../services/phoneLookupService';
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
        website: '',
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
  contentType: 'text' | 'html',
  provider?: string
): Promise<Message> {
  const fromNumber = config.sms.fromNumber;
  try {
    const sendResult = await SMSService.sendMessage(contact.phoneNumber, fromNumber, content, contentType, provider);
    const updated = await db.updateMessage(message._id, {
      status: 'sent',
      providerMessageId: sendResult.providerMessageId,
      provider: sendResult.provider,
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
    const errorMessage = SMSService.formatError(err);
    if (isNonMobileTelnyxError(errorMessage)) {
      await db.updateContact(contact._id, {
        smsCapable: false,
        lineType: contact.lineType || 'fixed_line',
      });
    }
    const updated = await db.updateMessage(message._id, {
      status: 'failed',
      sendError: errorMessage,
    });
    return updated || { ...message, status: 'failed', sendError: errorMessage };
  }
}

router.get(
  '/providers',
  asyncHandler(async (_req, res) => {
    res.json(smsProvidersStatus());
  })
);

router.post(
  '/send',
  asyncHandler(async (req, res) => {
    let { conversationId, contactId, to, content, contentType, trackLinks, forceSend, provider } = req.body;

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

    let { contact, conv } = ctx;
    contact = await ensureSmsCheck(contact);

    if (!forceSend && contact.smsCapable === false) {
      res.status(409).json({
        error:
          'This number does not appear SMS-capable (e.g. landline). You can still try sending via Telnyx if you believe the number is mobile.',
        smsBlocked: true,
        lineType: contact.lineType || 'fixed_line',
        carrierName: contact.carrierName || '',
        smsCapable: false,
      });
      return;
    }

    const shouldTrackLinks = Boolean(trackLinks);

    const message = await db.createMessage({
      conversationId: conv._id,
      contactId: contact._id,
      direction: 'outbound',
      content,
      contentType: resolvedContentType,
      read: true,
      providerMessageId: '',
      provider: resolveSmsProvider(provider) || '',
      status: 'pending',
      trackLinks: shouldTrackLinks,
    });

    await db.updateConversation(conv._id, { lastMessageAt: message.createdAt, status: 'active' });

    let outboundContent = content;
    if (shouldTrackLinks) {
      outboundContent = await wrapLinksInMessage({
        content,
        contentType: resolvedContentType,
        messageId: message._id,
        contactId: contact._id,
        conversationId: conv._id,
      });
      if (outboundContent !== content) {
        await db.updateMessage(message._id, { content: outboundContent });
      }
    }

    const result = await dispatchOutboundSms(
      { ...message, content: outboundContent },
      contact,
      outboundContent,
      resolvedContentType,
      provider
    );

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
    const forceSend = Boolean(req.body?.forceSend);
    const provider = typeof req.body?.provider === 'string' ? req.body.provider : undefined;
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

    const checkedContact = await ensureSmsCheck(contact);
    if (!forceSend && checkedContact.smsCapable === false) {
      res.status(409).json({
        error:
          'This number does not appear SMS-capable (e.g. landline). You can still try sending via Telnyx if you believe the number is mobile.',
        smsBlocked: true,
        lineType: checkedContact.lineType || 'fixed_line',
        carrierName: checkedContact.carrierName || '',
        smsCapable: false,
      });
      return;
    }

    await db.updateMessage(messageId, { status: 'pending', sendError: '' });
    const result = await dispatchOutboundSms(
      { ...message, status: 'pending', sendError: '' },
      checkedContact,
      message.content,
      message.contentType,
      provider || message.provider
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
