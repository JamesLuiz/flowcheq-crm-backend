import { config } from '../config';
import { db } from '../store/db';
import type { TrackedLink, LinkClick } from '../types';

const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/gi;
const HREF_REGEX = /href\s*=\s*["']([^"']+)["']/gi;

function trackingBaseUrl(): string {
  return (config.telnyx.webhookBaseUrl || config.appUrl).replace(/\/$/, '');
}

function extractUrls(content: string, contentType: 'text' | 'html'): string[] {
  const found = new Set<string>();
  if (contentType === 'html') {
    let match: RegExpExecArray | null;
    const hrefRe = new HREF_REGEX;
    while ((match = hrefRe.exec(content)) !== null) {
      const url = match[1].trim();
      if (/^https?:\/\//i.test(url)) found.add(url);
    }
  }
  let match: RegExpExecArray | null;
  const urlRe = new URL_REGEX;
  while ((match = urlRe.exec(content)) !== null) {
    found.add(match[0].replace(/[.,;:!?)]+$/, ''));
  }
  return [...found];
}

export async function wrapLinksInMessage(params: {
  content: string;
  contentType: 'text' | 'html';
  messageId: string;
  contactId: string;
  conversationId: string;
}): Promise<string> {
  const urls = extractUrls(params.content, params.contentType);
  if (urls.length === 0) return params.content;

  const base = trackingBaseUrl();
  let output = params.content;

  for (const originalUrl of urls) {
    const link = await db.createTrackedLink({
      slug: '',
      messageId: params.messageId,
      contactId: params.contactId,
      conversationId: params.conversationId,
      originalUrl,
    });
    const tracked = `${base}/r/${link.slug}`;
    output = output.split(originalUrl).join(tracked);
  }

  return output;
}

export async function recordClick(
  slug: string,
  meta: { userAgent?: string; referer?: string; ip?: string }
): Promise<{ link: TrackedLink; click: LinkClick } | null> {
  const link = await db.getTrackedLinkBySlug(slug);
  if (!link) return null;

  const click = await db.createLinkClick({
    linkId: link._id,
    messageId: link.messageId,
    contactId: link.contactId,
    userAgent: meta.userAgent || '',
    referer: meta.referer || '',
    ip: meta.ip || '',
  });

  await db.incrementTrackedLinkClicks(link._id);
  return { link, click };
}

export async function getLinkAnalytics() {
  return db.getLinkAnalytics();
}
