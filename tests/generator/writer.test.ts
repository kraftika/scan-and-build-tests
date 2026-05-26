import { describe, it, expect } from 'vitest';
import { writeSpecFile, urlToFilename } from '@/lib/generator/writer';
import type { TestableAction } from '@/lib/generator/types';

const ACTIONS: TestableAction[] = [
  { type: 'smoke', description: 'page loads without errors', selector: null, expectedOutcome: 'no console errors' },
  { type: 'navigation', description: 'clicking Settings navigates to settings page', selector: 'a[href="/settings"]', expectedOutcome: 'URL contains /settings' },
  { type: 'form', description: 'login form submits with valid credentials', selector: 'form', expectedOutcome: 'user is redirected after submit' },
  { type: 'interaction', description: 'Create button opens modal', selector: 'button:has-text("Create")', expectedOutcome: 'modal is visible' },
];

describe('urlToFilename', () => {
  it('converts root URL to index.spec.ts', () => {
    expect(urlToFilename('https://example.com/')).toBe('index.spec.ts');
  });

  it('converts path to kebab-case filename', () => {
    expect(urlToFilename('https://example.com/dashboard/settings')).toBe('dashboard-settings.spec.ts');
  });

  it('strips query strings', () => {
    expect(urlToFilename('https://example.com/page?q=1')).toBe('page.spec.ts');
  });

  it('handles single path segment', () => {
    expect(urlToFilename('https://example.com/about')).toBe('about.spec.ts');
  });
});

describe('writeSpecFile', () => {
  it('includes playwright imports', () => {
    const output = writeSpecFile('https://example.com/', ACTIONS);
    expect(output).toContain("from '@playwright/test'");
    expect(output).toContain('test');
    expect(output).toContain('expect');
  });

  it('generates one test block per action', () => {
    const output = writeSpecFile('https://example.com/', ACTIONS);
    const testCount = (output.match(/^\s+test\(/gm) ?? []).length;
    expect(testCount).toBe(ACTIONS.length);
  });

  it('uses action description as test name', () => {
    const output = writeSpecFile('https://example.com/', ACTIONS);
    expect(output).toContain("'page loads without errors'");
    expect(output).toContain("'clicking Settings navigates to settings page'");
  });

  it('smoke test checks for no console errors', () => {
    const output = writeSpecFile('https://example.com/', ACTIONS);
    expect(output).toContain('consoleErrors');
    expect(output).toContain('toHaveLength(0)');
  });

  it('navigation test uses toHaveURL', () => {
    const output = writeSpecFile('https://example.com/', ACTIONS);
    expect(output).toContain('toHaveURL');
    expect(output).toContain('/settings');
  });

  it('form test fills and submits', () => {
    const output = writeSpecFile('https://example.com/', ACTIONS);
    expect(output).toContain('page.locator');
    expect(output).toContain('click');
  });

  it('interaction test clicks selector', () => {
    const output = writeSpecFile('https://example.com/', ACTIONS);
    expect(output).toContain('Create');
  });

  it('output is valid TypeScript (no obvious syntax errors)', () => {
    const output = writeSpecFile('https://example.com/', ACTIONS);
    const openBraces = (output.match(/{/g) ?? []).length;
    const closeBraces = (output.match(/}/g) ?? []).length;
    expect(openBraces).toBe(closeBraces);
  });

  it('snapshot: output is stable', () => {
    const output = writeSpecFile('https://example.com/dashboard', ACTIONS);
    expect(output).toMatchSnapshot();
  });
});
