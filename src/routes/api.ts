import { Router, type Request } from 'express';
import mongoose from 'mongoose';
import { db } from '../store/db';
import { asyncHandler } from '../middleware/auth';

function paramId(req: Request): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] : id;
}

const router = Router();

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({
      status: 'ok',
      serverTime: new Date().toISOString(),
      db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    });
  })
);

router.get(
  '/contacts',
  asyncHandler(async (_req, res) => {
    res.json(await db.getContacts());
  })
);

router.post(
  '/contacts',
  asyncHandler(async (req, res) => {
    const { name, phoneNumber, businessName, location, tags } = req.body;
    if (!name || !phoneNumber) {
      res.status(400).json({ error: 'Name and unique PhoneNumber are required.' });
      return;
    }
    if (await db.getContactByPhoneNumber(phoneNumber)) {
      res.status(400).json({ error: 'Contact phone number must be unique.' });
      return;
    }
    try {
      const contact = await db.createContact({
        name: name.trim(),
        phoneNumber: phoneNumber.trim(),
        businessName: (businessName || '').trim(),
        location: (location || '').trim(),
        tags: Array.isArray(tags) ? tags.map((t: string) => t.trim()).filter(Boolean) : [],
      });
      res.status(201).json(contact);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Failed to create contact' });
    }
  })
);

router.put(
  '/contacts/:id',
  asyncHandler(async (req, res) => {
    const contactId = paramId(req);
    const existing = await db.getContactById(contactId);
    if (!existing) {
      res.status(404).json({ error: 'Contact not found.' });
      return;
    }
    const { name, phoneNumber, businessName, location, tags } = req.body;
    if (phoneNumber && phoneNumber !== existing.phoneNumber && (await db.getContactByPhoneNumber(phoneNumber))) {
      res.status(400).json({ error: 'Another contact already owns this phone number.' });
      return;
    }
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name.trim();
    if (phoneNumber !== undefined) updates.phoneNumber = phoneNumber.trim();
    if (businessName !== undefined) updates.businessName = businessName.trim();
    if (location !== undefined) updates.location = location.trim();
    if (tags !== undefined && Array.isArray(tags)) {
      updates.tags = tags.map((t: string) => t.trim()).filter(Boolean);
    }
    const updated = await db.updateContact(contactId, updates);
    res.json(updated);
  })
);

router.delete(
  '/contacts/:id',
  asyncHandler(async (req, res) => {
    const ok = await db.deleteContact(paramId(req));
    if (!ok) {
      res.status(404).json({ error: 'Contact not found.' });
      return;
    }
    res.json({ success: true });
  })
);

router.get(
  '/conversations',
  asyncHandler(async (_req, res) => {
    const convs = await db.getConversations();
    const populated = await Promise.all(
      convs.map(async (conv) => ({
        ...conv,
        contact: (await db.getContactById(conv.contactId)) || {
          _id: conv.contactId,
          name: 'Unknown Contact',
          phoneNumber: 'Unknown',
          businessName: '',
          location: '',
          tags: [],
          createdAt: '',
          updatedAt: '',
        },
      }))
    );
    populated.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
    res.json(populated);
  })
);

router.get(
  '/conversations/:id',
  asyncHandler(async (req, res) => {
    const conv = await db.getConversationById(paramId(req));
    if (!conv) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }
    const contact = await db.getContactById(conv.contactId);
    const messages = (await db.getMessages())
      .filter((m) => m.conversationId === conv._id)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    res.json({
      ...conv,
      contact: contact || {
        _id: conv.contactId,
        name: 'Unknown Contact',
        phoneNumber: 'Unknown',
        businessName: '',
        location: '',
        tags: [],
        createdAt: '',
        updatedAt: '',
      },
      messages,
    });
  })
);

router.patch(
  '/conversations/:id',
  asyncHandler(async (req, res) => {
    const id = paramId(req);
    const conv = await db.getConversationById(id);
    if (!conv) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }
    const { status } = req.body;
    if (status !== 'active' && status !== 'archived') {
      res.status(400).json({ error: 'status must be active or archived' });
      return;
    }
    const updated = await db.updateConversation(id, { status });
    res.json(updated);
  })
);

router.post(
  '/conversations/:id/read',
  asyncHandler(async (req, res) => {
    await db.markMessagesAsRead(paramId(req));
    res.json({ success: true });
  })
);

router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const contacts = await db.getContacts();
    if (!q) {
      res.json({ matches: contacts });
      return;
    }
    const matches = contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.phoneNumber.toLowerCase().includes(q) ||
        c.businessName.toLowerCase().includes(q) ||
        c.location.toLowerCase().includes(q)
    );
    res.json({ query: q, matches });
  })
);

router.get(
  '/notifications',
  asyncHandler(async (_req, res) => {
    const list = (await db.getNotifications()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    res.json({ notifications: list, unreadCount: list.filter((n) => !n.read).length });
  })
);

router.post(
  '/notifications',
  asyncHandler(async (req, res) => {
    const { type, message } = req.body;
    const notification = await db.createNotification({
      type: type || 'system',
      message: message || '',
      read: false,
    });
    res.status(201).json(notification);
  })
);

router.post(
  '/notifications/read-all',
  asyncHandler(async (_req, res) => {
    await db.markNotificationsAsRead();
    res.json({ success: true });
  })
);

router.post(
  '/notifications/:id/read',
  asyncHandler(async (req, res) => {
    const updated = await db.updateNotification(paramId(req), { read: true });
    res.json({ success: true, notification: updated });
  })
);

export default router;
