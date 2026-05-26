export interface FormField {
  name: string;
  type: string;
  required: boolean;
}

export interface FormDescriptor {
  action: string | null;
  method: string;
  fields: FormField[];
}

export interface PageCapture {
  url: string;
  title: string;
  screenshot: Buffer;
  accessibilityTree: string;
  links: string[];
  forms: FormDescriptor[];
  consoleErrors: string[];
}

export interface CrawlResult {
  origin: string;
  pages: PageCapture[];
  durationMs: number;
}

export class CrawlTimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`Crawl of ${url} exceeded timeout of ${timeoutMs}ms`);
    this.name = 'CrawlTimeoutError';
  }
}
