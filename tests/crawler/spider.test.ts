import { describe, it, expect, vi } from 'vitest';
import { spider } from '@/lib/crawler/spider';
import type { PageCapture } from '@/lib/crawler/types';

function makeCapture(url: string, links: string[] = []): PageCapture {
  return {
    url,
    title: url,
    screenshot: Buffer.from(''),
    accessibilityTree: '',
    links,
    forms: [],
    consoleErrors: [],
  };
}

describe('spider', () => {
  it('visits the start URL', async () => {
    const crawlPage = vi.fn().mockResolvedValue(makeCapture('https://example.com/'));
    const pages = await spider('https://example.com/', crawlPage, () => true);
    expect(crawlPage).toHaveBeenCalledWith('https://example.com/');
    expect(pages).toHaveLength(1);
  });

  it('follows links discovered on the start page (depth 1)', async () => {
    const crawlPage = vi.fn()
      .mockResolvedValueOnce(makeCapture('https://example.com/', ['https://example.com/about']))
      .mockResolvedValueOnce(makeCapture('https://example.com/about'));
    const pages = await spider('https://example.com/', crawlPage, () => true);
    expect(pages).toHaveLength(2);
    expect(pages.map((p) => p.url)).toContain('https://example.com/about');
  });

  it('does not visit the same URL twice', async () => {
    const crawlPage = vi.fn()
      .mockResolvedValueOnce(makeCapture('https://example.com/', [
        'https://example.com/about',
        'https://example.com/about', // duplicate
      ]))
      .mockResolvedValueOnce(makeCapture('https://example.com/about', ['https://example.com/']));
    const pages = await spider('https://example.com/', crawlPage, () => true);
    expect(crawlPage).toHaveBeenCalledTimes(2);
    expect(pages).toHaveLength(2);
  });

  it('respects maxPages limit', async () => {
    // Each page links to the next
    const crawlPage = vi.fn().mockImplementation((url: string) => {
      const n = parseInt(url.split('/').pop() ?? '0');
      return Promise.resolve(makeCapture(url, [`https://example.com/${n + 1}`]));
    });
    const pages = await spider('https://example.com/0', crawlPage, () => true, { maxPages: 5, maxDepth: 10 });
    expect(pages).toHaveLength(5);
    expect(crawlPage).toHaveBeenCalledTimes(5);
  });

  it('respects maxDepth limit', async () => {
    // depth 0: root → links to depth-1
    // depth 1: two pages → each links to depth-2
    // depth 2: should not be followed at maxDepth=1
    const crawlPage = vi.fn()
      .mockResolvedValueOnce(makeCapture('https://example.com/', ['https://example.com/a', 'https://example.com/b']))
      .mockResolvedValueOnce(makeCapture('https://example.com/a', ['https://example.com/deep-a']))
      .mockResolvedValueOnce(makeCapture('https://example.com/b', ['https://example.com/deep-b']));
    const pages = await spider('https://example.com/', crawlPage, () => true, { maxDepth: 1 });
    expect(pages).toHaveLength(3); // root + a + b
    expect(pages.map((p) => p.url)).not.toContain('https://example.com/deep-a');
  });

  it('does not follow links that the isAllowed function rejects', async () => {
    const crawlPage = vi.fn()
      .mockResolvedValueOnce(makeCapture('https://example.com/', [
        'https://example.com/public',
        'https://example.com/admin',
      ]))
      .mockResolvedValueOnce(makeCapture('https://example.com/public'));
    const isAllowed = (url: string) => !url.includes('/admin');
    const pages = await spider('https://example.com/', crawlPage, isAllowed);
    expect(pages.map((p) => p.url)).not.toContain('https://example.com/admin');
    expect(crawlPage).toHaveBeenCalledTimes(2);
  });

  it('continues if one page crawl throws, skipping that page', async () => {
    const crawlPage = vi.fn()
      .mockResolvedValueOnce(makeCapture('https://example.com/', ['https://example.com/broken', 'https://example.com/ok']))
      .mockRejectedValueOnce(new Error('navigation failed'))
      .mockResolvedValueOnce(makeCapture('https://example.com/ok'));
    const pages = await spider('https://example.com/', crawlPage, () => true);
    expect(pages).toHaveLength(2); // root + ok (broken is skipped)
    expect(pages.map((p) => p.url)).not.toContain('https://example.com/broken');
  });

  it('uses BFS order (breadth-first)', async () => {
    const visited: string[] = [];
    const crawlPage = vi.fn().mockImplementation((url: string) => {
      visited.push(url);
      if (url === 'https://example.com/') {
        return Promise.resolve(makeCapture(url, ['https://example.com/a', 'https://example.com/b']));
      }
      if (url === 'https://example.com/a') {
        return Promise.resolve(makeCapture(url, ['https://example.com/a1']));
      }
      return Promise.resolve(makeCapture(url, []));
    });
    await spider('https://example.com/', crawlPage, () => true);
    // BFS: root, a, b, then a1
    expect(visited.indexOf('https://example.com/a')).toBeLessThan(visited.indexOf('https://example.com/a1'));
    expect(visited.indexOf('https://example.com/b')).toBeLessThan(visited.indexOf('https://example.com/a1'));
  });
});
