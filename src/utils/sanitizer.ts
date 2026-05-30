export function sanitizeHTML(html: string): string {
  if (!html) return '';
  let sanitized = html;
  sanitized = sanitized.replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, '');
  const dangerousTags = ['iframe', 'object', 'embed', 'link', 'style', 'meta', 'applet', 'base', 'form', 'svg'];
  dangerousTags.forEach((tag) => {
    sanitized = sanitized.replace(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi'), '');
    sanitized = sanitized.replace(new RegExp(`<${tag}[^>]*>`, 'gi'), '');
  });
  sanitized = sanitized.replace(/on\w+\s*=\s*(['"])(.*?)\1/gi, '');
  sanitized = sanitized.replace(/href\s*=\s*(['"])javascript:(.*?)\1/gi, '');
  return sanitized;
}
