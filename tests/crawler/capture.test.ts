import { describe, it, expect, vi, type MockedObject } from 'vitest';
import type { Page } from 'playwright';
import { capturePage } from '@/lib/crawler/capture';

const MOCK_ARIA = '- heading "About"\n- paragraph "Welcome"';

function makeMockPage(overrides: Partial<MockedObject<Page>> = {}): MockedObject<Page> {
  const mockLocator = {
    ariaSnapshot: vi.fn().mockResolvedValue(MOCK_ARIA),
  };
  const mockPage = {
    url: vi.fn().mockReturnValue('https://example.com/about'),
    title: vi.fn().mockResolvedValue('About Us'),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('fake-screenshot')),
    locator: vi.fn().mockReturnValue(mockLocator),
    evaluate: vi.fn().mockResolvedValue([]),
    on: vi.fn(),
    goto: vi.fn(),
    waitForLoadState: vi.fn(),
    ...overrides,
  } as unknown as MockedObject<Page>;
  return mockPage;
}

describe('capturePage', () => {
  it('returns the current page URL', async () => {
    const page = makeMockPage();
    const result = await capturePage(page as unknown as Page);
    expect(result.url).toBe('https://example.com/about');
  });

  it('returns the page title', async () => {
    const page = makeMockPage();
    const result = await capturePage(page as unknown as Page);
    expect(result.title).toBe('About Us');
  });

  it('returns screenshot as a Buffer', async () => {
    const page = makeMockPage();
    const result = await capturePage(page as unknown as Page);
    expect(Buffer.isBuffer(result.screenshot)).toBe(true);
  });

  it('returns accessibility tree as a non-empty string', async () => {
    const page = makeMockPage();
    const result = await capturePage(page as unknown as Page);
    expect(typeof result.accessibilityTree).toBe('string');
    expect(result.accessibilityTree.length).toBeGreaterThan(0);
    expect(result.accessibilityTree).toContain('heading');
  });

  it('returns empty string for accessibility tree when ariaSnapshot throws', async () => {
    const failLocator = { ariaSnapshot: vi.fn().mockRejectedValue(new Error('no snapshot')) };
    const page = makeMockPage({ locator: vi.fn().mockReturnValue(failLocator) } as unknown as Partial<MockedObject<Page>>);
    const result = await capturePage(page as unknown as Page);
    expect(result.accessibilityTree).toBe('');
  });

  it('returns links as an array', async () => {
    const page = makeMockPage({
      evaluate: vi.fn().mockResolvedValueOnce([
        'https://example.com/contact',
        'https://example.com/blog',
      ]).mockResolvedValue([]),
    });
    const result = await capturePage(page as unknown as Page);
    expect(Array.isArray(result.links)).toBe(true);
    expect(result.links).toContain('https://example.com/contact');
  });

  it('returns an empty links array when page has no links', async () => {
    const page = makeMockPage({
      evaluate: vi.fn().mockResolvedValue([]),
    });
    const result = await capturePage(page as unknown as Page);
    expect(result.links).toEqual([]);
  });

  it('returns forms as an array', async () => {
    const page = makeMockPage({
      evaluate: vi.fn()
        .mockResolvedValueOnce([]) // links
        .mockResolvedValueOnce([   // forms
          { action: '/submit', method: 'POST', fields: [{ name: 'email', type: 'email', required: true }] },
        ]),
    });
    const result = await capturePage(page as unknown as Page);
    expect(Array.isArray(result.forms)).toBe(true);
    expect(result.forms[0].action).toBe('/submit');
    expect(result.forms[0].fields[0].name).toBe('email');
  });

  it('returns empty forms array when page has no forms', async () => {
    const page = makeMockPage({
      evaluate: vi.fn().mockResolvedValue([]),
    });
    const result = await capturePage(page as unknown as Page);
    expect(result.forms).toEqual([]);
  });

  it('returns consoleErrors as an array', async () => {
    const page = makeMockPage();
    const result = await capturePage(page as unknown as Page);
    expect(Array.isArray(result.consoleErrors)).toBe(true);
  });
});
