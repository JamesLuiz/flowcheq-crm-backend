import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

function prefixedId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).substring(2, 11)}`;
}

const contactSchema = new Schema(
  {
    _id: { type: String, default: () => prefixedId('con') },
    name: { type: String, required: true },
    phoneNumber: { type: String, required: true, unique: true, index: true },
    businessName: { type: String, default: '' },
    location: { type: String, default: '' },
    website: { type: String, default: '' },
    industry: { type: String, default: '' },
    googleMapsUrl: { type: String, default: '' },
    lineType: { type: String, default: '' },
    smsCapable: { type: Schema.Types.Mixed, default: null },
    carrierName: { type: String, default: '' },
    phoneLookupAt: { type: Date },
    tags: { type: [String], default: [] },
  },
  {
    _id: false,
    versionKey: false,
    collection: 'contacts',
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  }
);

const conversationSchema = new Schema(
  {
    _id: { type: String, default: () => prefixedId('chat') },
    contactId: { type: String, required: true, index: true },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    unreadCount: { type: Number, default: 0 },
    status: { type: String, enum: ['active', 'archived'], default: 'active', index: true },
  },
  {
    _id: false,
    versionKey: false,
    collection: 'conversations',
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  }
);

const messageSchema = new Schema(
  {
    _id: { type: String, default: () => prefixedId('msg') },
    conversationId: { type: String, required: true, index: true },
    contactId: { type: String, required: true, index: true },
    direction: { type: String, enum: ['inbound', 'outbound'], required: true },
    content: { type: String, required: true },
    contentType: { type: String, enum: ['text', 'html'], default: 'text' },
    read: { type: Boolean, default: false },
    providerMessageId: { type: String, default: '' },
    provider: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'sent' },
    sendError: { type: String, default: '' },
    trackLinks: { type: Boolean, default: false },
  },
  {
    _id: false,
    versionKey: false,
    collection: 'messages',
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  }
);

const notificationSchema = new Schema(
  {
    _id: { type: String, default: () => prefixedId('ntf') },
    type: { type: String, enum: ['new_message', 'system', 'call'], required: true },
    message: { type: String, required: true },
    read: { type: Boolean, default: false, index: true },
  },
  {
    _id: false,
    versionKey: false,
    collection: 'notifications',
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  }
);

/** Shared with ai-voice-system — same `calls` collection; extra CRM fields for Flowcheq UI */
const callSchema = new Schema(
  {
    call_id: { type: String, unique: true, sparse: true, index: true },
    contact_id: { type: String, index: true },
    caller_number: { type: String, index: true },
    direction: { type: String, enum: ['inbound', 'outbound'], default: 'inbound' },
    status: { type: String, index: true },
    duration_seconds: { type: Number },
    telnyx_call_control_id: { type: String },
    livekit_session_id: { type: String },
    handled_by: { type: String, enum: ['human', 'ai'] },
    notes: { type: String },
    summary: { type: String },
    lead_score: { type: Number },
    transcript: { type: String },
    structured_fields: { type: Schema.Types.Mixed },
    escalated: { type: Boolean, default: false },
    escalation_reason: { type: String },
  },
  {
    versionKey: false,
    collection: 'calls',
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  }
);

export type ContactDoc = InferSchemaType<typeof contactSchema> & { _id: string };
export type ConversationDoc = InferSchemaType<typeof conversationSchema> & { _id: string };
export type MessageDoc = InferSchemaType<typeof messageSchema> & { _id: string };
export type NotificationDoc = InferSchemaType<typeof notificationSchema> & { _id: string };
export type CallDoc = InferSchemaType<typeof callSchema> & { _id: mongoose.Types.ObjectId };

export const ContactModel = (mongoose.models.FlowcheqContact ||
  mongoose.model('FlowcheqContact', contactSchema)) as Model<Record<string, unknown>>;
export const ConversationModel = (mongoose.models.FlowcheqConversation ||
  mongoose.model('FlowcheqConversation', conversationSchema)) as Model<Record<string, unknown>>;
export const MessageModel = (mongoose.models.FlowcheqMessage ||
  mongoose.model('FlowcheqMessage', messageSchema)) as Model<Record<string, unknown>>;
export const NotificationModel = (mongoose.models.FlowcheqNotification ||
  mongoose.model('FlowcheqNotification', notificationSchema)) as Model<Record<string, unknown>>;
export const CallModel = (mongoose.models.FlowcheqCall ||
  mongoose.model('FlowcheqCall', callSchema)) as Model<Record<string, unknown>>;

const trackedLinkSchema = new Schema(
  {
    _id: { type: String, default: () => prefixedId('lnk') },
    slug: { type: String, required: true, unique: true, index: true },
    messageId: { type: String, required: true, index: true },
    contactId: { type: String, required: true, index: true },
    conversationId: { type: String, required: true, index: true },
    originalUrl: { type: String, required: true },
    clickCount: { type: Number, default: 0 },
  },
  {
    _id: false,
    versionKey: false,
    collection: 'tracked_links',
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  }
);

const linkClickSchema = new Schema(
  {
    _id: { type: String, default: () => prefixedId('clk') },
    linkId: { type: String, required: true, index: true },
    messageId: { type: String, required: true, index: true },
    contactId: { type: String, required: true, index: true },
    userAgent: { type: String, default: '' },
    referer: { type: String, default: '' },
    ip: { type: String, default: '' },
    clickedAt: { type: Date, default: Date.now, index: true },
  },
  {
    _id: false,
    versionKey: false,
    collection: 'link_clicks',
    timestamps: false,
  }
);

export const TrackedLinkModel = (mongoose.models.FlowcheqTrackedLink ||
  mongoose.model('FlowcheqTrackedLink', trackedLinkSchema)) as Model<Record<string, unknown>>;
export const LinkClickModel = (mongoose.models.FlowcheqLinkClick ||
  mongoose.model('FlowcheqLinkClick', linkClickSchema)) as Model<Record<string, unknown>>;

const userSchema = new Schema(
  {
    _id: { type: String, default: () => prefixedId('usr') },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, default: 'Flowcheq Admin' },
  },
  {
    _id: false,
    versionKey: false,
    collection: 'users',
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  }
);

const appSettingsSchema = new Schema(
  {
    _id: { type: String, default: 'global' },
    signupCompleted: { type: Boolean, default: false },
  },
  {
    _id: false,
    versionKey: false,
    collection: 'app_settings',
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  }
);

const contactInsightSchema = new Schema(
  {
    _id: { type: String, default: () => prefixedId('ins') },
    contactId: { type: String, required: true, unique: true, index: true },
    status: { type: String, enum: ['pending', 'ready', 'failed'], default: 'pending' },
    googleRating: { type: Number },
    reviewCount: { type: Number },
    googleMapsUrl: { type: String, default: '' },
    scrapedSummary: { type: String, default: '' },
    needs: { type: [String], default: [] },
    weaknesses: { type: [String], default: [] },
    fixes: { type: [String], default: [] },
    recommendations: { type: [String], default: [] },
    suggestedMessages: {
      type: [
        {
          id: String,
          label: String,
          text: String,
        },
      ],
      default: [],
    },
    followUpMessage: { type: String, default: '' },
    error: { type: String, default: '' },
    raw: { type: Schema.Types.Mixed },
  },
  {
    _id: false,
    versionKey: false,
    collection: 'contact_insights',
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  }
);

export const UserModel = (mongoose.models.FlowcheqUser ||
  mongoose.model('FlowcheqUser', userSchema)) as Model<Record<string, unknown>>;
export const AppSettingsModel = (mongoose.models.FlowcheqAppSettings ||
  mongoose.model('FlowcheqAppSettings', appSettingsSchema)) as Model<Record<string, unknown>>;
export const ContactInsightModel = (mongoose.models.FlowcheqContactInsight ||
  mongoose.model('FlowcheqContactInsight', contactInsightSchema)) as Model<Record<string, unknown>>;
