export type SanitizeResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

const ALLOWED_SCHEMES = new Set(['https:', 'http:']);

export function sanitizeUrl(raw: string): SanitizeResult {
  if (!raw) {
    return { ok: false, error: 'URL must not be empty' };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: 'Invalid URL format' };
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return { ok: false, error: `Disallowed scheme: ${parsed.protocol}. Only http and https are allowed.` };
  }

  if (!parsed.hostname) {
    return { ok: false, error: 'URL must include a hostname' };
  }

  if (isPrivateHost(parsed.hostname)) {
    return { ok: false, error: 'Crawling private or loopback addresses is not allowed' };
  }

  // Strip fragment — it has no server-side meaning
  parsed.hash = '';

  return { ok: true, value: parsed.toString() };
}

function isPrivateHost(hostname: string): boolean {
  if (hostname === 'localhost') return true;

  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return false;

  const [a, b] = parts;

  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;

  return false;
}
