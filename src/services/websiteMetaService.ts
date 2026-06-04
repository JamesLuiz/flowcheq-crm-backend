import { normalizeWebsiteUrl } from '../utils/url';

export interface WebsiteMetaResult {
  url: string;
  /** Ping / HTTP check result */
  status: 'reachable' | 'unreachable';
  reachable: boolean;
  /** True when og:title, description, or og:image are present */
  hasMeta: boolean;
  error?: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}

const FETCH_TIMEOUT_MS = 12_000;
const MAX_HTML_BYTES = 512_000;

function cleanMetaValue(value?: string | null): string | undefined {
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  if (lower === 'null' || lower === 'undefined' || lower === 'n/a') return undefined;
  return trimmed;
}

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
    if (m?.[1]) return cleanMetaValue(decodeHtmlEntities(m[1].trim()));
  }
  return undefined;
}

function extractTitle(html: string): string | undefined {
  const og = extractMetaContent(html, 'property', 'og:title');
  if (og) return og;
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m?.[1] ? cleanMetaValue(decodeHtmlEntities(m[1].trim())) : undefined;
}

function parseHtmlMeta(
  html: string,
  pageUrl: string
): Pick<WebsiteMetaResult, 'title' | 'description' | 'image' | 'siteName' | 'hasMeta'> {
  const title =
    extractMetaContent(html, 'property', 'og:title') || extractTitle(html);
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

  const hasMeta = Boolean(title || description || image);

  return {
    title,
    description,
    image,
    siteName,
    hasMeta,
  };
}

async function pingUrl(url: string, signal: AbortSignal): Promise<{ ok: boolean; error?: string }> {
  const headers = {
    'User-Agent': 'FlowcheqCRM/1.0 (website preview)',
    Accept: 'text/html,application/xhtml+xml,*/*',
  };

  try {
    const headRes = await fetch(url, { method: 'HEAD', signal, redirect: 'follow', headers });
    if (headRes.ok || (headRes.status >= 300 && headRes.status < 400)) {
      return { ok: true };
    }
    if (headRes.status === 405 || headRes.status === 501) {
      const getRes = await fetch(url, {
        method: 'GET',
        signal,
        redirect: 'follow',
        headers: { ...headers, Range: 'bytes=0-0' },
      });
      if (getRes.ok || (getRes.status >= 300 && getRes.status < 400)) return { ok: true };
      return { ok: false, error: `HTTP ${getRes.status} ${getRes.statusText}`.trim() };
    }
    return { ok: false, error: `HTTP ${headRes.status} ${headRes.statusText}`.trim() };
  } catch {
    try {
      const getRes = await fetch(url, { method: 'GET', signal, redirect: 'follow', headers });
      if (getRes.ok || (getRes.status >= 300 && getRes.status < 400)) return { ok: true };
      return { ok: false, error: `HTTP ${getRes.status} ${getRes.statusText}`.trim() };
    } catch (err) {
      const message =
        err instanceof Error
          ? err.name === 'AbortError'
            ? 'Request timed out'
            : err.message
          : 'Website unreachable';
      return { ok: false, error: message };
    }
  }
}

export async function fetchWebsiteMeta(rawUrl: string): Promise<WebsiteMetaResult> {
  const url = normalizeWebsiteUrl(rawUrl) || rawUrl.trim();
  if (!normalizeWebsiteUrl(rawUrl)) {
    return {
      url: rawUrl,
      status: 'unreachable',
      reachable: false,
      hasMeta: false,
      error: 'Invalid website URL',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const ping = await pingUrl(url, controller.signal);
    if (!ping.ok) {
      return {
        url,
        status: 'unreachable',
        reachable: false,
        hasMeta: false,
        error: ping.error || 'Website unreachable',
      };
    }

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
        status: 'unreachable',
        reachable: false,
        hasMeta: false,
        error: `HTTP ${res.status} ${res.statusText}`.trim(),
      };
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      return {
        url,
        status: 'reachable',
        reachable: true,
        hasMeta: false,
      };
    }

    const raw = await res.text();
    const html = raw.slice(0, MAX_HTML_BYTES);
    const meta = parseHtmlMeta(html, url);

    return {
      url,
      status: 'reachable',
      reachable: true,
      hasMeta: meta.hasMeta,
      title: meta.title,
      description: meta.description,
      image: meta.image,
      siteName: meta.siteName,
    };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.name === 'AbortError'
          ? 'Request timed out'
          : err.message
        : 'Website unreachable';
    return {
      url,
      status: 'unreachable',
      reachable: false,
      hasMeta: false,
      error: message || 'Website unreachable',
    };
  } finally {
    clearTimeout(timer);
  }
}
