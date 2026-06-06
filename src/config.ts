import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const defaultFrontendUrl = 'http://localhost:5173';

export const config = {
  port: Number(process.env.PORT || 3000),
  appUrl: process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`,
  frontendUrl: process.env.FRONTEND_URL || defaultFrontendUrl,
  cors: {
    allowedOrigins: (
      process.env.CORS_ORIGINS ||
      process.env.FRONTEND_URL ||
      defaultFrontendUrl
    )
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
  mongodb: {
    uri:
      process.env.MONGODB_URI ||
      process.env.MONGO_URI ||
      'mongodb://localhost:27017/voice_calls',
  },
  telnyx: {
    apiKey: process.env.TELNYX_API_KEY || '',
    phoneNumber: process.env.TELNYX_PHONE_NUMBER || '',
    connectionId: process.env.TELNYX_CONNECTION_ID || '',
    messagingProfileId: process.env.TELNYX_MESSAGING_PROFILE_ID || '',
    /** Credential-based SIP connection for WebRTC (create in Telnyx portal) */
    webrtcConnectionId: process.env.TELNYX_WEBRTC_CONNECTION_ID || '',
    webrtcCredentialId: process.env.TELNYX_WEBRTC_CREDENTIAL_ID || '',
    webhookBaseUrl: process.env.TELNYX_WEBHOOK_BASE_URL || process.env.APP_URL || '',
    /** E.164 mobile to ring on inbound calls (Call Control forward) */
    humanForwardNumber: process.env.HUMAN_FORWARD_NUMBER || '',
  },
  n8n: {
    outboundCallWebhook: process.env.N8N_OUTBOUND_CALL_WEBHOOK || '',
    voiceEventsWebhook: process.env.N8N_CALL_ROUTER_WEBHOOK || '',
    businessEnrichWebhook: process.env.N8N_BUSINESS_ENRICH_WEBHOOK || '',
    followUpWebhook: process.env.N8N_FOLLOW_UP_WEBHOOK || '',
  },
  auth: {
    disabled: process.env.AUTH_DISABLED === 'true',
    jwtSecret: process.env.JWT_SECRET || process.env.WEBHOOK_SECRET || 'flowcheq-change-me-in-production',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  campaign: {
    consultationUrl:
      process.env.CONSULTATION_URL || 'https://flowcheq.com/consultation',
  },
  /** Public base for short tracked links in SMS (not the API host). */
  linkTracking: {
    baseUrl:
      process.env.LINK_TRACKING_BASE_URL ||
      process.env.PUBLIC_APP_URL ||
      'https://flowcheq.com',
  },
  voice: {
    apiUrl: process.env.VOICE_API_URL || 'http://localhost:3001',
    internalApiKey: process.env.VOICE_INTERNAL_API_KEY || '',
  },
  webhooks: {
    secret: process.env.WEBHOOK_SECRET || process.env.INTERNAL_API_KEY || '',
  },
  sms: {
    simulateReplies: process.env.SMS_SIMULATE_REPLIES === 'true',
    fromNumber: process.env.TELNYX_PHONE_NUMBER || '+18449997700',
  },
};

export function telnyxConfigured(): boolean {
  return Boolean(config.telnyx.apiKey && config.telnyx.phoneNumber);
}

export function telnyxSmsWebhookUrl(): string {
  const base = (config.telnyx.webhookBaseUrl || config.appUrl).replace(/\/$/, '');
  return `${base}/webhook/inbound`;
}

export function telnyxVoiceWebhookUrl(): string {
  const base = (config.telnyx.webhookBaseUrl || config.appUrl).replace(/\/$/, '');
  return `${base}/webhook/telnyx/voice`;
}
