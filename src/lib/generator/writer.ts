import type { TestableAction } from './types';

export function urlToFilename(url: string): string {
  const { pathname } = new URL(url);
  const clean = pathname.replace(/^\/|\/$/g, ''); // strip leading/trailing slashes
  if (!clean) return 'index.spec.ts';
  return clean.replace(/\//g, '-') + '.spec.ts';
}

export function writeSpecFile(pageUrl: string, actions: TestableAction[]): string {
  const testBlocks = actions.map((action) => writeTestBlock(pageUrl, action)).join('\n\n');

  return `import { test, expect } from '@playwright/test';

test.describe('${pageUrl}', () => {
${testBlocks}
});
`;
}

function writeTestBlock(pageUrl: string, action: TestableAction): string {
  switch (action.type) {
    case 'smoke':
      return writeSmokeTest(pageUrl, action);
    case 'navigation':
      return writeNavigationTest(pageUrl, action);
    case 'form':
      return writeFormTest(pageUrl, action);
    case 'interaction':
      return writeInteractionTest(pageUrl, action);
  }
}

function writeSmokeTest(pageUrl: string, action: TestableAction): string {
  return `  test('${action.description}', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    await page.goto('${pageUrl}');
    await expect(page.locator('body')).toBeVisible();
    expect(consoleErrors).toHaveLength(0);
  });`;
}

function writeNavigationTest(pageUrl: string, action: TestableAction): string {
  const selector = action.selector ?? 'a';
  return `  test('${action.description}', async ({ page }) => {
    await page.goto('${pageUrl}');
    await page.locator('${selector}').first().click();
    await expect(page).toHaveURL(/${escapeRegex(action.expectedOutcome)}/);
  });`;
}

function writeFormTest(pageUrl: string, action: TestableAction): string {
  const selector = action.selector ?? 'form';
  return `  test('${action.description}', async ({ page }) => {
    await page.goto('${pageUrl}');
    const form = page.locator('${selector}').first();
    await form.locator('input[type="text"], input[type="email"], input:not([type])').first().fill('test@example.com');
    await form.locator('button[type="submit"], input[type="submit"], button').last().click();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeVisible();
  });`;
}

function writeInteractionTest(pageUrl: string, action: TestableAction): string {
  const selector = action.selector ?? 'button';
  return `  test('${action.description}', async ({ page }) => {
    await page.goto('${pageUrl}');
    await page.locator('${selector}').first().click();
    await expect(page.locator('body')).toBeVisible();
  });`;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
}
