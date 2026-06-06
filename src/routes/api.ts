import { Router, type Request } from 'express';
import mongoose from 'mongoose';
import { db } from '../store/db';
import { asyncHandler } from '../middleware/auth';
import { normalizePhoneToE164 } from '../utils/phone';
import { CONTACT_TAG_OPTIONS } from '../constants/contactTags';
import { fetchWebsiteMeta } from '../services/websiteMetaService';
import { importLeads } from '../services/leadImportService';
import { normalizeWebsiteUrl } from '../utils/url';
import { normalizeGoogleMapsUrl } from '../utils/googleMaps';

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
    const { name, phoneNumber, businessName, location, website, googleMapsUrl, tags, defaultDialCode } =
      req.body;
    if (!name || !phoneNumber) {
      res.status(400).json({ error: 'Name and unique PhoneNumber are required.' });
      return;
    }
    let normalizedPhone: string;
    try {
      normalizedPhone = normalizePhoneToE164(
        String(phoneNumber),
        defaultDialCode ? String(defaultDialCode).replace(/\D/g, '') : '1'
      );
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Invalid phone number.' });
      return;
    }
    if (await db.getContactByPhoneNumber(normalizedPhone)) {
      res.status(400).json({ error: 'Contact phone number must be unique.' });
      return;
    }
    try {
      const contact = await db.createContact({
        name: name.trim(),
        phoneNumber: normalizedPhone,
        businessName: (businessName || '').trim(),
        location: (location || '').trim(),
        website: website ? normalizeWebsiteUrl(String(website)) || String(website).trim() : '',
        googleMapsUrl: googleMapsUrl ? normalizeGoogleMapsUrl(String(googleMapsUrl)) : '',
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
    const { name, phoneNumber, businessName, location, website, googleMapsUrl, tags, defaultDialCode } =
      req.body;
    let normalizedPhone: string | undefined;
    if (phoneNumber !== undefined) {
      try {
        normalizedPhone = normalizePhoneToE164(
          String(phoneNumber),
          defaultDialCode ? String(defaultDialCode).replace(/\D/g, '') : '1'
        );
      } catch (e) {
        res.status(400).json({ error: e instanceof Error ? e.message : 'Invalid phone number.' });
        return;
      }
      if (
        normalizedPhone !== existing.phoneNumber &&
        (await db.getContactByPhoneNumber(normalizedPhone))
      ) {
        res.status(400).json({ error: 'Another contact already owns this phone number.' });
        return;
      }
    }
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name.trim();
    if (normalizedPhone !== undefined) updates.phoneNumber = normalizedPhone;
    if (businessName !== undefined) updates.businessName = businessName.trim();
    if (location !== undefined) updates.location = location.trim();
    if (website !== undefined) {
      updates.website = website ? normalizeWebsiteUrl(String(website)) || String(website).trim() : '';
    }
    if (googleMapsUrl !== undefined) {
      updates.googleMapsUrl = googleMapsUrl ? normalizeGoogleMapsUrl(String(googleMapsUrl)) : '';
    }
    if (tags !== undefined && Array.isArray(tags)) {
      updates.tags = tags.map((t: string) => t.trim()).filter(Boolean);
    }
    const updated = await db.updateContact(contactId, updates);
    res.json(updated);
  })
);

router.get(
  '/contacts/:id/website-meta',
  asyncHandler(async (req, res) => {
    const contact = await db.getContactById(paramId(req));
    if (!contact) {
      res.status(404).json({ error: 'Contact not found.' });
      return;
    }
    if (!contact.website?.trim()) {
      res.status(400).json({ error: 'Contact has no website URL.' });
      return;
    }
    const meta = await fetchWebsiteMeta(contact.website);
    res.json(meta);
  })
);

router.patch(
  '/contacts/:id/tags',
  asyncHandler(async (req, res) => {
    const contactId = paramId(req);
    const existing = await db.getContactById(contactId);
    if (!existing) {
      res.status(404).json({ error: 'Contact not found.' });
      return;
    }
    const { tag } = req.body as { tag?: string };
    if (tag !== undefined && tag !== '' && !CONTACT_TAG_OPTIONS.includes(tag as (typeof CONTACT_TAG_OPTIONS)[number])) {
      res.status(400).json({ error: 'Invalid tag.', allowed: CONTACT_TAG_OPTIONS });
      return;
    }
    const tags = tag && tag.trim() ? [tag.trim()] : [];
    const updated = await db.updateContact(contactId, { tags });
    res.json(updated);
  })
);

router.post(
  '/contacts/bulk-import',
  asyncHandler(async (req, res) => {
    const { leads, updateExisting } = req.body as {
      updateExisting?: boolean;
      leads?: {
        name: string;
        phoneNumber: string;
        businessName?: string;
        location?: string;
        website?: string;
        tags?: string[];
        defaultDialCode?: string;
      }[];
    };
    if (!Array.isArray(leads) || leads.length === 0) {
      res.status(400).json({ error: 'leads array is required.' });
      return;
    }

    const normalizedLeads: {
      name: string;
      businessName: string;
      phoneNumber: string;
      location: string;
      website?: string;
      tags?: string[];
    }[] = [];
    const preErrors: { phoneNumber: string; error: string }[] = [];

    for (const row of leads) {
      if (!row.name?.trim() || !row.phoneNumber?.trim()) {
        preErrors.push({ phoneNumber: row.phoneNumber || '', error: 'Name and phone required.' });
        continue;
      }
      try {
        const normalizedPhone = normalizePhoneToE164(
          String(row.phoneNumber),
          row.defaultDialCode ? String(row.defaultDialCode).replace(/\D/g, '') : '1'
        );
        normalizedLeads.push({
          name: row.name.trim(),
          businessName: (row.businessName || row.name).trim(),
          phoneNumber: normalizedPhone,
          location: (row.location || '').trim(),
          website: row.website,
          tags: Array.isArray(row.tags) && row.tags.length ? row.tags : ['Imported'],
        });
      } catch (e) {
        preErrors.push({
          phoneNumber: row.phoneNumber || '',
          error: e instanceof Error ? e.message : 'Invalid phone number',
        });
      }
    }

    const stats = await importLeads(normalizedLeads, { updateExisting: Boolean(updateExisting) });
    stats.errors.unshift(...preErrors);
    stats.failed += preErrors.length;

    res.status(201).json({
      ...stats,
      errors: stats.errors.slice(0, 50),
      total: leads.length,
      updateExisting: Boolean(updateExisting),
    });
  })
);

router.get(
  '/contact-tags',
  asyncHandler(async (_req, res) => {
    res.json({ tags: CONTACT_TAG_OPTIONS });
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
          website: '',
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
        website: '',
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
        c.location.toLowerCase().includes(q) ||
        (c.website || '').toLowerCase().includes(q)
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
