import type { Page } from 'playwright';
import type { PageCapture, FormDescriptor } from './types';

export async function capturePage(page: Page): Promise<PageCapture> {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  const [ariaSnapshot, screenshot, links, forms] = await Promise.all([
    page.locator('html').ariaSnapshot().catch(() => ''),
    page.screenshot({ fullPage: true }),
    extractLinks(page),
    extractForms(page),
  ]);

  return {
    url: page.url(),
    title: await page.title(),
    screenshot,
    accessibilityTree: ariaSnapshot,
    links,
    forms,
    consoleErrors,
  };
}

async function extractLinks(page: Page): Promise<string[]> {
  const origin = new URL(page.url()).origin;
  return page.evaluate((pageOrigin) => {
    return Array.from(document.querySelectorAll('a[href]'))
      .map((el) => {
        try {
          return new URL((el as HTMLAnchorElement).href, window.location.href).toString();
        } catch {
          return null;
        }
      })
      .filter((href): href is string => href !== null && new URL(href).origin === pageOrigin)
      .filter((href) => !href.includes('#'))
      .filter((href, i, arr) => arr.indexOf(href) === i);
  }, origin);
}

async function extractForms(page: Page): Promise<FormDescriptor[]> {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll('form')).map((form) => ({
      action: form.getAttribute('action'),
      method: (form.getAttribute('method') ?? 'GET').toUpperCase(),
      fields: Array.from(form.querySelectorAll('input, select, textarea')).map((el) => ({
        name: (el as HTMLInputElement).name || (el as HTMLInputElement).id || '',
        type: (el as HTMLInputElement).type || el.tagName.toLowerCase(),
        required: (el as HTMLInputElement).required ?? false,
      })),
    }));
  });
}
