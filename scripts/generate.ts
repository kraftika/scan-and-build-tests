import { loadEnv } from '../src/lib/utils/env';
loadEnv();

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import type { Recording, RecordedEvent } from '../src/lib/recorder/types';

const RECORDINGS_DIR = join(process.cwd(), '.recordings');
const OUTPUT_DIR = join(process.cwd(), 'output');

// ── mechanical generator (no API key needed) ─────────────────────────────────

function generateMechanically(recording: Recording): string {
  const { startUrl, events } = recording;
  const hostname = new URL(startUrl).hostname;

  // Group events into flows by navigation boundaries
  const flows: RecordedEvent[][] = [];
  let current: RecordedEvent[] = [];
  for (const event of events) {
    if (event.type === 'navigate' && current.length > 0) {
      flows.push(current);
      current = [event];
    } else {
      current.push(event);
    }
  }
  if (current.length > 0) flows.push(current);

  const tests = flows.map((flow, i) => {
    const navigateEvent = flow.find((e) => e.type === 'navigate');
    const gotoUrl = navigateEvent?.url ?? startUrl;
    const label = `flow ${i + 1} on ${new URL(gotoUrl).pathname || '/'}`;

    const steps = flow.map((e) => eventToCode(e)).filter(Boolean).join('\n    ');

    return `  test('${label}', async ({ page }) => {
    await page.goto('${gotoUrl}');
    ${steps}
    await expect(page.locator('body')).toBeVisible();
  });`;
  });

  return `import { test, expect } from '@playwright/test';

// Generated from recording — ${new Date(recording.recordedAt).toLocaleString()}
// Source: ${hostname}

test.describe('recorded session — ${hostname}', () => {
${tests.join('\n\n')}
});
`;
}

function eventToCode(event: RecordedEvent): string {
  switch (event.type) {
    case 'navigate':
      return `await page.goto('${event.url}');`;
    case 'click':
      if (event.text) return `await page.getByText('${escape(event.text)}').first().click();`;
      if (event.selector) return `await page.locator('${escape(event.selector)}').first().click();`;
      return '';
    case 'fill':
      if (!event.selector || !event.value) return '';
      return `await page.locator('${escape(event.selector)}').fill('${escape(event.value)}');`;
    case 'select':
      // Native <select>: use selectOption; custom dropdown: click the option
      if (event.value && event.selector?.startsWith('select')) {
        return `await page.locator('${escape(event.selector)}').selectOption({ value: '${escape(event.value)}' });`;
      }
      if (event.text) return `await page.getByText('${escape(event.text)}').first().click();`;
      if (event.selector) return `await page.locator('${escape(event.selector)}').first().click();`;
      return '';
    case 'submit':
      return `await page.locator('${event.selector ?? "form"}').evaluate(f => f.requestSubmit());`;
    default:
      return '';
  }
}

function escape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// ── Claude-enhanced generator ─────────────────────────────────────────────────

async function generateWithClaude(recording: Recording): Promise<string> {
  const { startUrl, events } = recording;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `You are a Playwright test engineer. A user navigated a web application and recorded their interactions.
Convert these interactions into meaningful Playwright test cases.

Start URL: ${startUrl}
Recorded events:
${JSON.stringify(events, null, 2)}

Rules:
- Group related interactions into logical test cases (e.g. "user creates a project", "user fills login form")
- Each test should be independently runnable (starts with page.goto())
- Use Playwright best practices: getByRole, getByText, getByLabel over raw CSS selectors where possible
- Add await expect() assertions after key actions to verify the expected outcome
- Output ONLY valid TypeScript Playwright test code, no explanation, no markdown fences
- Use this exact structure:

import { test, expect } from '@playwright/test';

test.describe('<feature name>', () => {
  test('<test name>', async ({ page }) => {
    // test code
  });
});`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as Anthropic.TextBlock).text)
    .join('');
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const recFlag = args.indexOf('--recording');
  let recordingFile = recFlag !== -1 ? args[recFlag + 1] : undefined;

  if (!recordingFile) {
    const files = readdirSync(RECORDINGS_DIR).filter((f) => f.endsWith('.json')).sort();
    if (files.length === 0) {
      console.error('No recordings found. Run: npm run record -- --url <url>');
      process.exit(1);
    }
    recordingFile = join(RECORDINGS_DIR, files[files.length - 1]);
    console.log(`Using most recent recording: ${recordingFile}`);
  }

  const recording: Recording = JSON.parse(readFileSync(recordingFile, 'utf8'));
  console.log(`\nProcessing ${recording.events.length} recorded events…`);

  const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
  let code: string;

  if (hasApiKey) {
    console.log('ANTHROPIC_API_KEY found — generating with Claude (smarter grouping + assertions)…');
    code = await generateWithClaude(recording);
  } else {
    console.log('No ANTHROPIC_API_KEY — generating mechanically from recording…');
    code = generateMechanically(recording);
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const hostname = new URL(recording.startUrl).hostname.replace(/[^a-z0-9.-]/gi, '_');
  const dest = join(OUTPUT_DIR, `recorded-${hostname}.spec.ts`);
  writeFileSync(dest, code, 'utf8');

  console.log(`\n✓ Tests written to ${dest}`);
  console.log(`\nRun them with:\n  npx playwright test ${dest}`);
  if (!hasApiKey) {
    console.log('\nTip: add ANTHROPIC_API_KEY to .env.local for smarter Claude-generated tests.');
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
