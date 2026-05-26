import { loadEnv } from '../src/lib/utils/env';
loadEnv();

import { chromium } from 'playwright';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';
import { sanitizeUrl } from '../src/lib/utils/sanitize';
import type { RecordedEvent, Recording } from '../src/lib/recorder/types';

const SESSIONS_DIR = join(process.cwd(), '.sessions');
const RECORDINGS_DIR = join(process.cwd(), '.recordings');

function sessionPath(url: string): string {
  const hostname = new URL(url).hostname.replace(/[^a-z0-9.-]/gi, '_');
  return join(SESSIONS_DIR, `${hostname}.json`);
}

function recordingPath(url: string): string {
  const hostname = new URL(url).hostname.replace(/[^a-z0-9.-]/gi, '_');
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return join(RECORDINGS_DIR, `${hostname}_${ts}.json`);
}

// Injected into every page — derives a human-readable selector for a clicked element
const RECORDER_SCRIPT = `
(function() {
  if (window.__recorderInstalled) return;
  window.__recorderInstalled = true;

  function bestSelector(el) {
    if (el.dataset.testid) return '[data-testid="' + el.dataset.testid + '"]';
    if (el.getAttribute('aria-label')) return '[aria-label="' + el.getAttribute('aria-label') + '"]';
    const role = el.getAttribute('role');
    const text = (el.innerText || el.value || '').trim().slice(0, 40);
    if (role && text) return role + ':has-text("' + text + '")';
    if (el.tagName === 'BUTTON' && text) return 'button:has-text("' + text + '")';
    if (el.tagName === 'A' && text) return 'a:has-text("' + text + '")';
    if (el.name) return el.tagName.toLowerCase() + '[name="' + el.name + '"]';
    if (el.id) return '#' + el.id;
    return el.tagName.toLowerCase();
  }

  document.addEventListener('click', function(e) {
    const el = e.target.closest('a, button, [role="button"], [role="link"], input[type="submit"], input[type="button"]');
    if (!el) return;
    window.__recordEvent({
      type: 'click',
      selector: bestSelector(el),
      text: (el.innerText || el.value || '').trim().slice(0, 80),
      url: window.location.href,
      timestamp: Date.now(),
    });
  }, true);

  // Debounced input tracking — captures final typed value even without blur
  var _inputTimers = {};
  document.addEventListener('input', function(e) {
    var el = e.target;
    if (!['INPUT','SELECT','TEXTAREA'].includes(el.tagName)) return;
    if (['password','hidden'].includes(el.type)) return;
    var key = bestSelector(el);
    clearTimeout(_inputTimers[key]);
    _inputTimers[key] = setTimeout(function() {
      delete _inputTimers[key];
      window.__recordEvent({
        type: 'fill',
        selector: key,
        value: el.value.slice(0, 100),
        url: window.location.href,
        timestamp: Date.now(),
      });
    }, 600);
  }, true);

  // Also capture on blur to catch any missed final values
  document.addEventListener('blur', function(e) {
    var el = e.target;
    if (!['INPUT','SELECT','TEXTAREA'].includes(el.tagName)) return;
    if (['password','hidden'].includes(el.type)) return;
    if (!el.value) return;
    var key = bestSelector(el);
    clearTimeout(_inputTimers[key]);
    delete _inputTimers[key];
    window.__recordEvent({
      type: 'fill',
      selector: key,
      value: el.value.slice(0, 100),
      url: window.location.href,
      timestamp: Date.now(),
    });
  }, true);

  document.addEventListener('submit', function(e) {
    const form = e.target;
    window.__recordEvent({
      type: 'submit',
      selector: form.id ? '#' + form.id : 'form',
      url: window.location.href,
      timestamp: Date.now(),
    });
  }, true);
})();
`;

function waitForEnter(prompt: string): Promise<void> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, () => { rl.close(); resolve(); });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const urlFlag = args.indexOf('--url');
  const rawUrl = urlFlag !== -1 ? args[urlFlag + 1] : undefined;

  if (!rawUrl) {
    console.error('Usage: npm run record -- --url <url>');
    process.exit(1);
  }

  const sanitized = sanitizeUrl(rawUrl);
  if (!sanitized.ok) {
    console.error(`Invalid URL: ${sanitized.error}`);
    process.exit(1);
  }

  const url = sanitized.value;
  const session = sessionPath(url);
  const hasSession = existsSync(session);

  const events: RecordedEvent[] = [];

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    ...(hasSession ? { storageState: session } : {}),
  });

  // Expose a function the injected script can call to record events
  await context.exposeFunction('__recordEvent', (event: RecordedEvent) => {
    // For fill events: replace the previous entry for the same selector+url
    // so rapid typing produces one final-value entry, not dozens
    if (event.type === 'fill') {
      const prev = events.findLastIndex(
        (e) => e.type === 'fill' && e.selector === event.selector && e.url === event.url,
      );
      if (prev !== -1) { events.splice(prev, 1); }
    }
    events.push(event);
    const label = event.type === 'fill'
      ? `${event.selector} = "${event.value}"`
      : event.text ? `"${event.text}"` : event.selector ?? '';
    console.log(`  [${event.type.padEnd(8)}] ${label}`);
  });

  // Inject recorder into every page (including after navigation)
  await context.addInitScript(RECORDER_SCRIPT);

  const page = await context.newPage();

  // Record navigation events when URL changes
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return;
    events.push({ type: 'navigate', url: frame.url(), timestamp: Date.now() });
    console.log(`  [navigate ] ${frame.url()}`);
  });

  console.log('\n─────────────────────────────────────────');
  console.log('  Recording started. Navigate your app.');
  console.log('  Every click, fill, and navigation is captured.');
  console.log('  Press Enter here when done.');
  console.log('─────────────────────────────────────────\n');

  await page.goto(url);
  await waitForEnter('');

  await browser.close();

  if (events.length === 0) {
    console.log('\nNo events recorded.');
    return;
  }

  mkdirSync(RECORDINGS_DIR, { recursive: true });
  const dest = recordingPath(url);
  const recording: Recording = {
    startUrl: url,
    recordedAt: new Date().toISOString(),
    events,
  };
  writeFileSync(dest, JSON.stringify(recording, null, 2), 'utf8');

  console.log(`\n✓ ${events.length} events recorded → ${dest}`);
  console.log('\nGenerate tests with:');
  console.log(`  npm run generate -- --recording ${dest}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
