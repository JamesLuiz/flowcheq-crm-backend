export interface Contact {
  _id: string;
  name: string;
  phoneNumber: string;
  businessName: string;
  location: string;
  website: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  _id: string;
  contactId: string;
  lastMessageAt: string;
  unreadCount: number;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  _id: string;
  conversationId: string;
  contactId: string;
  direction: 'inbound' | 'outbound';
  content: string;
  contentType: 'text' | 'html';
  read: boolean;
  providerMessageId: string;
  status?: 'pending' | 'sent' | 'failed';
  sendError?: string;
  trackLinks?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TrackedLink {
  _id: string;
  slug: string;
  messageId: string;
  contactId: string;
  conversationId: string;
  originalUrl: string;
  clickCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface LinkClick {
  _id: string;
  linkId: string;
  messageId: string;
  contactId: string;
  userAgent: string;
  referer: string;
  ip: string;
  clickedAt: string;
}

export interface LinkAnalyticsRow {
  linkId: string;
  slug: string;
  originalUrl: string;
  messageId: string;
  contactId: string;
  contactName: string;
  clickCount: number;
  lastClickedAt: string | null;
  recentClicks: LinkClick[];
}

export interface LinkAnalyticsSummary {
  totalClicks: number;
  totalLinks: number;
  linksWithClicks: number;
}

export interface Notification {
  _id: string;
  type: 'new_message' | 'system' | 'call';
  message: string;
  read: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CallRecord {
  _id: string;
  contactId: string;
  direction: 'inbound' | 'outbound';
  status: 'completed' | 'missed' | 'no-answer' | 'ringing' | 'in-progress';
  duration: number;
  createdAt: string;
  notes?: string;
  providerCallId?: string;
  telnyxCallControlId?: string;
  handledBy?: 'human' | 'ai';
  summary?: string;
  leadScore?: number;
  transcript?: string;
}

export interface VoiceCallCompletedPayload {
  call_id: string;
  caller_number: string;
  direction?: 'inbound' | 'outbound';
  status?: CallRecord['status'];
  duration?: number;
  handled_by?: 'human' | 'ai';
  summary?: string;
  lead_score?: number;
  transcript?: string;
  structured_fields?: Record<string, unknown>;
}
