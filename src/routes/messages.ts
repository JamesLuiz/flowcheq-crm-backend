import { Router } from 'express';
import { config } from '../config';
import { db } from '../store/db';
import { asyncHandler } from '../middleware/auth';
import { SMSService } from '../services/smsService';
import { handleInboundSMS } from '../services/inboundSmsService';
import { sanitizeHTML } from '../utils/sanitizer';

const router = Router();

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

    let contact = null;
    let conv = null;

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

    if (!contact) {
      res.status(400).json({ error: 'Active contact could not be resolved.' });
      return;
    }

    if (!conv) {
      conv = await db.createConversation({
        contactId: contact._id,
        lastMessageAt: new Date().toISOString(),
        unreadCount: 0,
        status: 'active',
      });
    }

    const fromNumber = config.sms.fromNumber;
    const sendResult = await SMSService.sendMessage(contact.phoneNumber, fromNumber, content, resolvedContentType);

    const message = await db.createMessage({
      conversationId: conv._id,
      contactId: contact._id,
      direction: 'outbound',
      content,
      contentType: resolvedContentType,
      read: true,
      providerMessageId: sendResult.providerMessageId,
    });

    await db.updateConversation(conv._id, { lastMessageAt: message.createdAt, status: 'active' });

    if (config.sms.simulateReplies && sendResult.provider === 'flowcheq-carrier-simulator') {
      setTimeout(() => {
        handleInboundSMS(
          {
            from: contact!.phoneNumber,
            to: fromNumber,
            text: `Thanks! We received your message: "${content.substring(0, 80)}"`,
            providerMessageId: `sim_${Date.now()}`,
          },
          'text'
        ).catch((e) => console.error('[sms] Simulated reply failed:', e));
      }, 2000);
    }

    res.status(201).json(message);
  })
);

export default router;
