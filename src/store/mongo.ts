import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { config } from '../config';
import {
  CallModel,
  ContactModel,
  ConversationModel,
  MessageModel,
  NotificationModel,
} from './schemas';

const LEGACY_JSON = path.join(process.cwd(), 'flowcheq_db.json');

export async function connectMongo(): Promise<void> {
  if (mongoose.connection.readyState === 1) return;

  await mongoose.connect(config.mongodb.uri, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
  });

  console.log(`[DB] MongoDB connected (${config.mongodb.uri.replace(/\/\/[^:]+:[^@]+@/, '//***@')})`);

  await migrateLegacyJsonIfNeeded();
  await seedIfEmpty();
}

export async function disconnectMongo(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

async function seedIfEmpty(): Promise<void> {
  const count = await ContactModel.countDocuments();
  if (count > 0) return;

  const now = new Date();
  const contactId = 'con_seed1';
  await ContactModel.create({
    _id: contactId,
    name: 'James Luiz',
    phoneNumber: '+15552345678',
    businessName: 'Luiz Ventures',
    location: 'New York, USA',
    tags: ['VIP', 'Inquiry', 'Marketing'],
    createdAt: now,
    updatedAt: now,
  });
  await ConversationModel.create({
    _id: 'chat_seed1',
    contactId,
    lastMessageAt: now,
    unreadCount: 0,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
  console.log('[DB] Seeded default contact and conversation');
}

async function migrateLegacyJsonIfNeeded(): Promise<void> {
  if (!fs.existsSync(LEGACY_JSON)) return;
  const existing = await ContactModel.countDocuments();
  if (existing > 0) return;

  try {
    const raw = JSON.parse(fs.readFileSync(LEGACY_JSON, 'utf-8')) as {
      contacts?: Record<string, unknown>[];
      conversations?: Record<string, unknown>[];
      messages?: Record<string, unknown>[];
      notifications?: Record<string, unknown>[];
      calls?: Record<string, unknown>[];
    };

    if (raw.contacts?.length) {
      await ContactModel.insertMany(
        raw.contacts.map((c) => ({
          ...c,
          createdAt: c.createdAt ? new Date(String(c.createdAt)) : new Date(),
          updatedAt: c.updatedAt ? new Date(String(c.updatedAt)) : new Date(),
        })) as Record<string, unknown>[]
      );
    }
    if (raw.conversations?.length) {
      await ConversationModel.insertMany(
        raw.conversations.map((c) => ({
          ...c,
          lastMessageAt: c.lastMessageAt ? new Date(String(c.lastMessageAt)) : new Date(),
          createdAt: c.createdAt ? new Date(String(c.createdAt)) : new Date(),
          updatedAt: c.updatedAt ? new Date(String(c.updatedAt)) : new Date(),
        })) as Record<string, unknown>[]
      );
    }
    if (raw.messages?.length) {
      await MessageModel.insertMany(
        raw.messages.map((m) => ({
          ...m,
          createdAt: m.createdAt ? new Date(String(m.createdAt)) : new Date(),
          updatedAt: m.updatedAt ? new Date(String(m.updatedAt)) : new Date(),
        })) as Record<string, unknown>[]
      );
    }
    if (raw.notifications?.length) {
      await NotificationModel.insertMany(
        raw.notifications.map((n) => ({
          ...n,
          createdAt: n.createdAt ? new Date(String(n.createdAt)) : new Date(),
          updatedAt: n.updatedAt ? new Date(String(n.updatedAt)) : new Date(),
        })) as Record<string, unknown>[]
      );
    }
    if (raw.calls?.length) {
      for (const call of raw.calls) {
        await CallModel.findOneAndUpdate(
          { call_id: String(call.providerCallId || call._id) },
          {
            $set: {
              call_id: String(call.providerCallId || call._id),
              contact_id: call.contactId,
              direction: call.direction,
              status: mapFlowcheqStatusToVoice(String(call.status)),
              duration_seconds: Number(call.duration) || 0,
              handled_by: call.handledBy,
              notes: call.notes,
              summary: call.summary,
              lead_score: call.leadScore,
              transcript: call.transcript,
              telnyx_call_control_id: call.telnyxCallControlId,
            },
          },
          { upsert: true, new: true }
        );
      }
    }

    const backup = `${LEGACY_JSON}.migrated.${Date.now()}.bak`;
    fs.renameSync(LEGACY_JSON, backup);
    console.log(`[DB] Migrated legacy flowcheq_db.json → MongoDB (backup: ${path.basename(backup)})`);
  } catch (e) {
    console.error('[DB] Legacy JSON migration failed:', e);
  }
}

function mapFlowcheqStatusToVoice(status: string): string {
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
