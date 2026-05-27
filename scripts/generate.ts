import { loadEnv } from '../src/lib/utils/env';
loadEnv();

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { Recording, RecordedEvent } from '../src/lib/recorder/types';

const SESSIONS_DIR = join(process.cwd(), '.sessions');

const RECORDINGS_DIR = join(process.cwd(), '.recordings');
const OUTPUT_DIR = join(process.cwd(), 'output');
const POPOVER_PANEL_ROLES = ['dialog', 'menu', 'listbox', 'tree', 'grid', 'combobox'];

// ── mechanical generator (no API key needed) ─────────────────────────────────

function sessionPathFor(url: string): string {
  const hostname = new URL(url).hostname.replace(/[^a-z0-9.-]/gi, '_');
  return join(SESSIONS_DIR, `${hostname}.json`);
}

function generateMechanically(recording: Recording): string {
  const { startUrl, events } = recording;
  const hostname = new URL(startUrl).hostname;
  const sessionFile = sessionPathFor(startUrl);
  const hasSession = existsSync(sessionFile);

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

    // Skip the leading navigate event — the test already opens the URL via page.goto()
    const steps = flow
      .filter((e) => e.type !== 'navigate')
      .map((e) => eventToCode(e))
      .filter(Boolean)
      .join('\n    ');

    return `  test('${label}', async ({ page }) => {
    await page.goto('${gotoUrl}');
    ${steps}
  });`;
  });

  const sessionLine = hasSession
    ? `\ntest.use({ storageState: '${sessionFile}' });\n`
    : '';

  return `import { test, expect } from '../support/fixtures';

// Generated from recording — ${new Date(recording.recordedAt).toLocaleString()}
// Source: ${hostname}
${sessionLine}
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
      if (event.text) return `await page.getByText('${escape(firstLine(event.text))}').first().click();`;
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
      if (event.text) return `await page.getByText('${escape(firstLine(event.text))}').first().click();`;
      if (event.selector) return `await page.locator('${escape(event.selector)}').first().click();`;
      return '';
    case 'submit':
      return `await page.locator('${event.selector ?? "form"}').evaluate((f: HTMLFormElement) => f.requestSubmit());`;
    case 'hover':
      if (!event.selector) return '';
      return [
        `await page.locator('${escape(event.selector)}').hover();`,
        event.text
          ? `await expect(page.locator('[role="tooltip"]')).toContainText('${escape(event.text.slice(0, 60))}');`
          : `await expect(page.locator('[role="tooltip"]')).toBeVisible();`,
      ].join('\n      ');
    case 'popover': {
      if (!event.selector) return '';
      // value holds the detected role (dialog/menu/listbox/…); fall back to generic popover roles
      const popoverRole = event.value ?? 'dialog';
      const panelSelector = POPOVER_PANEL_ROLES.includes(popoverRole)
        ? `[role="${escape(popoverRole)}"]`
        : '[role="dialog"],[role="menu"],[role="listbox"]';
      return `await expect(page.locator('${escape(event.selector)}')).toHaveAttribute('aria-expanded', 'true');\n      await expect(page.locator('${panelSelector}').first()).toBeVisible();`;
    }
    default:
      return '';
  }
}

function escape(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r?\n/g, '\\n')
    .replace(/\t/g, '\\t');
}

// Returns the first non-empty line — used for getByText to avoid fragile multi-line selectors
function firstLine(s: string): string {
  return s.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? s;
}

// ── Claude-enhanced generator ─────────────────────────────────────────────────

async function generateWithClaude(recording: Recording): Promise<string> {
  const { startUrl, events } = recording;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const sessionFile = sessionPathFor(startUrl);
  const hasSession = existsSync(sessionFile);
  const sessionInstruction = hasSession
    ? `\n- Add \`test.use({ storageState: '${sessionFile}' });\` before the describe block (the app requires authentication)`
    : '';

  // Build a page map: url → domSnapshot for Claude context
  const pageSnapshots = events
    .filter((e) => e.type === 'navigate' && e.domSnapshot)
    .map((e) => `### ${e.url}\n${e.domSnapshot}`)
    .join('\n\n');

  const prompt = `You are a Playwright test engineer. A user navigated a web application and recorded their interactions.
Convert these interactions into meaningful Playwright test cases.

Start URL: ${startUrl}

${pageSnapshots ? `DOM structure of visited pages (use this to write precise selectors and assertions):\n${pageSnapshots}\n` : ''}
Recorded events:
${JSON.stringify(events.map(({ domSnapshot: _, ...e }) => e), null, 2)}

Rules:
- Group related interactions into logical test cases (e.g. "user creates a project", "user fills login form")
- Each test should be independently runnable (starts with page.goto())
- Use Playwright best practices: getByRole, getByText, getByLabel over raw CSS selectors where possible
- Add await expect() assertions after key actions to verify the expected outcome
- Output ONLY valid TypeScript Playwright test code, no explanation, no markdown fences${sessionInstruction}
- Use this exact structure:

import { test, expect } from '../support/fixtures';

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

async function processRecording(recordingFile: string, hasApiKey: boolean, includeTimestamp = false): Promise<void> {
  const recording: Recording = JSON.parse(readFileSync(recordingFile, 'utf8'));
  console.log(`\nProcessing ${recording.events.length} events from ${recordingFile}…`);

  const code = hasApiKey
    ? await generateWithClaude(recording)
    : generateMechanically(recording);

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const hostname = new URL(recording.startUrl).hostname.replace(/[^a-z0-9.-]/gi, '_');
  const ts = includeTimestamp
    ? '_' + new Date(recording.recordedAt).toISOString().replace(/[:.]/g, '-').slice(0, 19)
    : '';
  const dest = join(OUTPUT_DIR, `recorded-${hostname}${ts}.spec.ts`);
  writeFileSync(dest, code, 'utf8');
  console.log(`✓ ${dest}`);
}

async function main() {
  const args = process.argv.slice(2);
  const recFlag = args.indexOf('--recording');
  const allFlag = args.includes('--all');
  const hasApiKey = !!process.env.ANTHROPIC_API_KEY;

  const allFiles = readdirSync(RECORDINGS_DIR).filter((f) => f.endsWith('.json')).sort();
  if (allFiles.length === 0) {
    console.error('No recordings found. Run: npm run record -- --url <url>');
    process.exit(1);
  }

  let filesToProcess: string[];

  if (allFlag) {
    filesToProcess = allFiles.map((f) => join(RECORDINGS_DIR, f));
    console.log(`Generating tests for all ${filesToProcess.length} recording(s)…`);
  } else if (recFlag !== -1) {
    filesToProcess = [args[recFlag + 1]];
  } else {
    filesToProcess = [join(RECORDINGS_DIR, allFiles[allFiles.length - 1])];
    console.log(`Using most recent recording: ${filesToProcess[0]}`);
  }

  if (hasApiKey) {
    console.log('ANTHROPIC_API_KEY found — generating with Claude…');
  } else {
    console.log('No ANTHROPIC_API_KEY — generating mechanically…');
  }

  for (const file of filesToProcess) {
    await processRecording(file, hasApiKey, allFlag);
  }

  console.log(`\nRun tests with:\n  npx playwright test output/`);
  if (!hasApiKey) {
    console.log('\nTip: add ANTHROPIC_API_KEY to .env.local for smarter Claude-generated tests.');
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
