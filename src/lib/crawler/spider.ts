import type { PageCapture } from './types';

export interface SpiderOptions {
  maxPages?: number;
  maxDepth?: number;
}

export type CrawlPageFn = (url: string) => Promise<PageCapture>;

export async function spider(
  startUrl: string,
  crawlPage: CrawlPageFn,
  isAllowed: (url: string) => boolean,
  options: SpiderOptions = {},
): Promise<PageCapture[]> {
  const maxPages = options.maxPages ?? 30;
  const maxDepth = options.maxDepth ?? 3;

  const visited = new Set<string>();
  const results: PageCapture[] = [];

  // BFS queue: [url, depth]
  const queue: Array<[string, number]> = [[startUrl, 0]];
  visited.add(startUrl);

  while (queue.length > 0 && results.length < maxPages) {
    const [url, depth] = queue.shift()!;

    let capture: PageCapture;
    try {
      capture = await crawlPage(url);
    } catch {
      continue;
    }

    results.push(capture);

    if (depth < maxDepth) {
      for (const link of capture.links) {
        if (!visited.has(link) && isAllowed(link)) {
          visited.add(link);
          queue.push([link, depth + 1]);
        }
      }
    }
  }

  return results;
}
