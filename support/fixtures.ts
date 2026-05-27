import { test as base, expect } from '@playwright/test';

const API_RESOURCE_TYPES = new Set(['xhr', 'fetch']);

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const consoleLogs: string[] = [];
    const networkLogs: string[] = [];
    const failedRequests: string[] = [];

    // Console logs
    page.on('console', (msg) => {
      consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
    });

    page.on('pageerror', (err) => {
      consoleLogs.push(`[pageerror] ${err.message}`);
    });

    // Network calls (XHR / fetch only — skips static assets)
    page.on('request', (request) => {
      if (!API_RESOURCE_TYPES.has(request.resourceType())) return;
      networkLogs.push(`→ ${request.method()} ${request.url()}`);
    });

    page.on('response', (response) => {
      if (!API_RESOURCE_TYPES.has(response.request().resourceType())) return;
      const status = response.status();
      const line = `← ${status} ${response.url()}`;
      networkLogs.push(line);
      if (status >= 400) failedRequests.push(line);
    });

    page.on('requestfailed', (request) => {
      if (!API_RESOURCE_TYPES.has(request.resourceType())) return;
      const line = `✗ ${request.method()} ${request.url()} — ${request.failure()?.errorText ?? 'failed'}`;
      networkLogs.push(line);
      failedRequests.push(line);
    });

    await use(page);

    if (consoleLogs.length > 0) {
      await testInfo.attach('browser-console', {
        body: consoleLogs.join('\n'),
        contentType: 'text/plain',
      });
      const errors = consoleLogs.filter(
        (l) => l.startsWith('[error]') || l.startsWith('[pageerror]'),
      );
      if (errors.length > 0) {
        console.log('\nBrowser errors in ' + testInfo.title + ':\n' + errors.join('\n'));
      }
    }

    if (networkLogs.length > 0) {
      await testInfo.attach('network', {
        body: networkLogs.join('\n'),
        contentType: 'text/plain',
      });
      if (failedRequests.length > 0) {
        console.log('\nFailed requests in ' + testInfo.title + ':\n' + failedRequests.join('\n'));
      }
    }
  },
});

export { expect };
