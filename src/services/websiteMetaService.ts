import { normalizeWebsiteUrl } from '../utils/url';

export interface WebsiteMetaResult {
  url: string;
  reachable: boolean;
  error?: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}

const FETCH_TIMEOUT_MS = 12_000;
const MAX_HTML_BYTES = 512_000;

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function extractMetaContent(html: string, attr: 'property' | 'name', key: string): string | undefined {
  const patterns = [
    new RegExp(
      `<meta[^>]+${attr}=["']${key}["'][^>]+content=["']([^"']+)["']`,
      'i'
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+${attr}=["']${key}["']`,
      'i'
    ),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return decodeHtmlEntities(m[1].trim());
  }
  return undefined;
}

function extractTitle(html: string): string | undefined {
  const og = extractMetaContent(html, 'property', 'og:title');
  if (og) return og;
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m?.[1] ? decodeHtmlEntities(m[1].trim()) : undefined;
}

function parseHtmlMeta(html: string, pageUrl: string): Omit<WebsiteMetaResult, 'url' | 'reachable'> {
  const title =
    extractMetaContent(html, 'property', 'og:title') ||
    extractTitle(html);
  const description =
    extractMetaContent(html, 'property', 'og:description') ||
    extractMetaContent(html, 'name', 'description');
  let image = extractMetaContent(html, 'property', 'og:image');
  const siteName = extractMetaContent(html, 'property', 'og:site_name');

  if (image && !/^https?:\/\//i.test(image)) {
    try {
      image = new URL(image, pageUrl).href;
    } catch {
      image = undefined;
    }
  }

  return {
    title: title || undefined,
    description: description || undefined,
    image: image || undefined,
    siteName: siteName || undefined,
  };
}

export async function fetchWebsiteMeta(rawUrl: string): Promise<WebsiteMetaResult> {
  const url = normalizeWebsiteUrl(rawUrl);
  if (!url) {
    return {
      url: rawUrl,
      reachable: false,
      error: 'Invalid website URL',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'FlowcheqCRM/1.0 (website preview)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    if (!res.ok) {
      return {
        url,
        reachable: false,
        error: `HTTP ${res.status} ${res.statusText}`.trim(),
      };
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      return {
        url,
        reachable: true,
        title: url,
        description: 'No HTML metadata available for this URL',
      };
    }

    const raw = await res.text();
    const html = raw.slice(0, MAX_HTML_BYTES);

    const meta = parseHtmlMeta(html, url);
    if (!meta.title && !meta.description && !meta.image) {
      return {
        url,
        reachable: true,
        title: url,
        description: 'No meta tags found on this page',
      };
    }

    return { url, reachable: true, ...meta };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.name === 'AbortError'
          ? 'Request timed out'
          : err.message
        : 'Website unreachable';
    return {
      url,
      reachable: false,
      error: message || 'Website unreachable',
    };
  } finally {
    clearTimeout(timer);
  }
}
