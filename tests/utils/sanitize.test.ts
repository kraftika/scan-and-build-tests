import { describe, it, expect } from 'vitest';
import { sanitizeUrl } from '@/lib/utils/sanitize';

describe('sanitizeUrl', () => {
  describe('valid URLs', () => {
    it('accepts a plain https URL', () => {
      const result = sanitizeUrl('https://example.com');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe('https://example.com/');
    });

    it('accepts https with path and query string', () => {
      const result = sanitizeUrl('https://app.example.com/path?q=1');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe('https://app.example.com/path?q=1');
    });

    it('accepts http URLs', () => {
      const result = sanitizeUrl('http://example.com');
      expect(result.ok).toBe(true);
    });

    it('strips trailing fragments', () => {
      const result = sanitizeUrl('https://example.com/page#section');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).not.toContain('#');
    });
  });

  describe('blocked: private / loopback IPs', () => {
    it('rejects localhost hostname', () => {
      const result = sanitizeUrl('http://localhost:3000');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('private');
    });

    it('rejects 127.0.0.1', () => {
      expect(sanitizeUrl('http://127.0.0.1').ok).toBe(false);
    });

    it('rejects 10.x.x.x', () => {
      expect(sanitizeUrl('http://10.0.0.1/admin').ok).toBe(false);
    });

    it('rejects 192.168.x.x', () => {
      expect(sanitizeUrl('http://192.168.1.1').ok).toBe(false);
    });

    it('rejects 172.16.x.x', () => {
      expect(sanitizeUrl('http://172.16.0.1').ok).toBe(false);
    });

    it('rejects 172.31.x.x', () => {
      expect(sanitizeUrl('http://172.31.255.255').ok).toBe(false);
    });

    it('allows 172.15.x.x (not in private range)', () => {
      expect(sanitizeUrl('http://172.15.0.1').ok).toBe(true);
    });

    it('allows 172.32.x.x (not in private range)', () => {
      expect(sanitizeUrl('http://172.32.0.1').ok).toBe(true);
    });
  });

  describe('blocked: disallowed schemes', () => {
    it('rejects file:// URLs', () => {
      const result = sanitizeUrl('file:///etc/passwd');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('scheme');
    });

    it('rejects ftp:// URLs', () => {
      expect(sanitizeUrl('ftp://example.com').ok).toBe(false);
    });

    it('rejects javascript: URLs', () => {
      expect(sanitizeUrl('javascript:alert(1)').ok).toBe(false);
    });
  });

  describe('blocked: malformed input', () => {
    it('rejects empty string', () => {
      expect(sanitizeUrl('').ok).toBe(false);
    });

    it('rejects plain text', () => {
      expect(sanitizeUrl('not a url').ok).toBe(false);
    });

    it('rejects URL with no host', () => {
      expect(sanitizeUrl('https://').ok).toBe(false);
    });
  });
});
