import { chromium } from 'playwright';
import { spider } from './spider';
import { capturePage } from './capture';
import { parseRobotsTxt, isAllowedByRobots } from './robots';
import { CrawlTimeoutError } from './types';
import type { CrawlResult } from './types';

export interface CrawlOptions {
  maxPages?: number;
  maxDepth?: number;
  timeoutMs?: number;
}

const USER_AGENT = 'scan-and-build-tests/1.0';

export async function crawl(startUrl: string, options: CrawlOptions = {}): Promise<CrawlResult> {
  const timeoutMs = options.timeoutMs ?? 90_000;
  const origin = new URL(startUrl).origin;
  const start = Date.now();

  const robotsUrl = `${origin}/robots.txt`;
  const disallowed = await fetchRobots(robotsUrl);

  const isAllowed = (url: string): boolean => {
    if (!url.startsWith(origin)) return false;
    return isAllowedByRobots(url, disallowed);
  };

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    extraHTTPHeaders: { 'User-Agent': USER_AGENT },
  });

  try {
    const crawlPage = async (url: string) => {
      if (Date.now() - start > timeoutMs) {
        throw new CrawlTimeoutError(startUrl, timeoutMs);
      }
      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 15_000 });
        return await capturePage(page);
      } finally {
        await page.close();
      }
    };

    const pagesPromise = spider(startUrl, crawlPage, isAllowed, {
      maxPages: options.maxPages,
      maxDepth: options.maxDepth,
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new CrawlTimeoutError(startUrl, timeoutMs)), timeoutMs),
    );

    const pages = await Promise.race([pagesPromise, timeoutPromise]);

    return { origin, pages, durationMs: Date.now() - start };
  } finally {
    await browser.close();
  }
}

async function fetchRobots(url: string): Promise<Set<string>> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return new Set();
    return parseRobotsTxt(await res.text());
  } catch {
    return new Set();
  }
}
