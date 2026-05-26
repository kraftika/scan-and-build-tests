import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PageCapture } from '@/lib/crawler/types';
import type { TestableAction } from '@/lib/generator/types';

// Mock callClaude before importing the module under test
vi.mock('@/lib/generator/prompts', () => ({
  buildPagePrompt: vi.fn().mockReturnValue([]),
  callClaude: vi.fn(),
  LLMParseError: class LLMParseError extends Error {},
}));

const MOCK_ACTIONS: TestableAction[] = [
  { type: 'smoke', description: 'page loads', selector: null, expectedOutcome: 'visible' },
];

function makeCapture(url: string): PageCapture {
  return { url, title: url, screenshot: Buffer.from(''), accessibilityTree: '', links: [], forms: [], consoleErrors: [] };
}

describe('generateTestSuite', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns one spec file per page capture', async () => {
    const { callClaude } = await import('@/lib/generator/prompts');
    vi.mocked(callClaude).mockResolvedValue(MOCK_ACTIONS);

    const { generateTestSuite } = await import('@/lib/generator/index');
    const suite = await generateTestSuite([
      makeCapture('https://example.com/'),
      makeCapture('https://example.com/about'),
    ]);

    expect(Object.keys(suite)).toHaveLength(2);
    expect(suite['index.spec.ts']).toBeDefined();
    expect(suite['about.spec.ts']).toBeDefined();
  });

  it('each spec file contains test code', async () => {
    const { callClaude } = await import('@/lib/generator/prompts');
    vi.mocked(callClaude).mockResolvedValue(MOCK_ACTIONS);

    const { generateTestSuite } = await import('@/lib/generator/index');
    const suite = await generateTestSuite([makeCapture('https://example.com/')]);

    expect(suite['index.spec.ts']).toContain("from '@playwright/test'");
    expect(suite['index.spec.ts']).toContain('page loads');
  });

  it('skips a page gracefully when callClaude throws', async () => {
    const { callClaude } = await import('@/lib/generator/prompts');
    vi.mocked(callClaude)
      .mockRejectedValueOnce(new Error('API error'))
      .mockResolvedValueOnce(MOCK_ACTIONS);

    const { generateTestSuite } = await import('@/lib/generator/index');
    const suite = await generateTestSuite([
      makeCapture('https://example.com/'),
      makeCapture('https://example.com/about'),
    ]);

    // One failed, one succeeded
    expect(Object.keys(suite)).toHaveLength(1);
    expect(suite['about.spec.ts']).toBeDefined();
  });

  it('calls Claude once per page', async () => {
    const { callClaude } = await import('@/lib/generator/prompts');
    vi.mocked(callClaude).mockResolvedValue(MOCK_ACTIONS);

    const { generateTestSuite } = await import('@/lib/generator/index');
    await generateTestSuite([
      makeCapture('https://example.com/'),
      makeCapture('https://example.com/about'),
      makeCapture('https://example.com/contact'),
    ]);

    expect(callClaude).toHaveBeenCalledTimes(3);
  });
});
