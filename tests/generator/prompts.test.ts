import { describe, it, expect } from 'vitest';
import { buildPagePrompt } from '@/lib/generator/prompts';
import type { PageCapture } from '@/lib/crawler/types';

function makeCapture(overrides: Partial<PageCapture> = {}): PageCapture {
  return {
    url: 'https://example.com/dashboard',
    title: 'Dashboard',
    screenshot: Buffer.from('fake'),
    accessibilityTree: '- heading "Dashboard"\n- button "Create Project"',
    links: ['https://example.com/settings'],
    forms: [],
    consoleErrors: [],
    ...overrides,
  };
}

describe('buildPagePrompt', () => {
  it('returns a messages array with system and user roles', () => {
    const messages = buildPagePrompt(makeCapture());
    const roles = messages.map((m) => m.role);
    expect(roles).toContain('user');
  });

  it('includes the page URL in the prompt', () => {
    const messages = buildPagePrompt(makeCapture());
    const text = JSON.stringify(messages);
    expect(text).toContain('https://example.com/dashboard');
  });

  it('includes the accessibility tree in the prompt', () => {
    const messages = buildPagePrompt(makeCapture());
    const text = JSON.stringify(messages);
    expect(text).toContain('Create Project');
  });

  it('includes the screenshot as a base64 image block', () => {
    const capture = makeCapture({ screenshot: Buffer.from('img-data') });
    const messages = buildPagePrompt(capture);
    const text = JSON.stringify(messages);
    expect(text).toContain('image');
    expect(text).toContain(Buffer.from('img-data').toString('base64'));
  });

  it('instructs Claude to return JSON', () => {
    const messages = buildPagePrompt(makeCapture());
    const text = JSON.stringify(messages);
    expect(text.toLowerCase()).toContain('json');
  });

  it('snapshot: prompt shape is stable', () => {
    const messages = buildPagePrompt(makeCapture());
    // Snapshot only the structure, not the base64 screenshot bytes
    const snapshot = messages.map((m) => ({
      role: m.role,
      contentTypes: Array.isArray(m.content)
        ? m.content.map((c: { type: string }) => c.type)
        : [typeof m.content],
    }));
    expect(snapshot).toMatchSnapshot();
  });
});
