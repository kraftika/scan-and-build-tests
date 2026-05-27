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

  var INTERACTIVE = 'a, button, [role="button"], [role="link"], [role="option"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="tab"], input[type="submit"], input[type="button"], [aria-haspopup], [aria-expanded]';
  var OPTION_ROLES = ['option','menuitem','menuitemradio','menuitemcheckbox'];
  var SKIP_TAGS = ['HTML','BODY','MAIN','HEADER','FOOTER','SECTION','ARTICLE','NAV','ASIDE'];
  var _lastPopoverTrigger = null;
  var _lastPopoverEventTs = 0;
  var _pointerdownSel = null;
  var _pointerdownTs = 0;

  function _resolveEl(target) {
    var el = target.closest(INTERACTIVE);
    if (!el) {
      var text = (target.innerText || target.value || target.getAttribute('aria-label') || '').trim();
      var hasPopupAttr = target.hasAttribute('aria-haspopup') || target.hasAttribute('aria-expanded');
      if (!text && !target.id && !hasPopupAttr) return null;
      if (SKIP_TAGS.includes(target.tagName)) return null;
      el = target;
    }
    return el;
  }

  function _emitClick(el) {
    var isOption = OPTION_ROLES.includes(el.getAttribute('role') || '');
    var sel = bestSelector(el);
    var text = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 80);
    if (el.hasAttribute('aria-haspopup') || el.hasAttribute('aria-expanded') || el.hasAttribute('aria-controls')) {
      _lastPopoverTrigger = { selector: sel, ts: Date.now() };
    }
    window.__recordEvent({
      type: isOption ? 'select' : 'click',
      selector: sel,
      text: text,
      url: window.location.href,
      timestamp: Date.now(),
    });
    return sel;
  }

  // pointerdown fires before the library opens the popper, so _lastPopoverTrigger is set
  // before the MutationObserver sees the new portal node.
  // Also records the click in case the library calls stopImmediatePropagation and 'click' never fires.
  document.addEventListener('pointerdown', function(e) {
    var el = _resolveEl(e.target);
    if (!el) return;
    _pointerdownSel = _emitClick(el);
    _pointerdownTs = Date.now();
  }, true);

  // click handler — skip if pointerdown already recorded the same element within 400ms
  document.addEventListener('click', function(e) {
    var el = _resolveEl(e.target);
    if (!el) return;
    var sel = bestSelector(el);
    if (sel === _pointerdownSel && Date.now() - _pointerdownTs < 400) {
      _pointerdownSel = null;
      return; // already recorded via pointerdown
    }
    _emitClick(el);
  }, true);

  // Native <select> — record chosen option text alongside value
  document.addEventListener('change', function(e) {
    var el = e.target;
    if (el.tagName !== 'SELECT') return;
    var selected = el.options[el.selectedIndex];
    window.__recordEvent({
      type: 'select',
      selector: bestSelector(el),
      value: el.value,
      text: selected ? selected.text : el.value,
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

  // Hover capture — fires when cursor enters an element that has a title attribute
  // or an aria-describedby pointing to a tooltip, and when role="tooltip" nodes appear
  var _hoverTimer = null;
  document.addEventListener('mouseover', function(e) {
    var el = e.target;
    var title = el.getAttribute('title') || el.getAttribute('aria-label');
    var describedBy = el.getAttribute('aria-describedby');
    if (!title && !describedBy) return;
    clearTimeout(_hoverTimer);
    _hoverTimer = setTimeout(function() {
      window.__recordEvent({
        type: 'hover',
        selector: bestSelector(el),
        text: title || describedBy,
        url: window.location.href,
        timestamp: Date.now(),
      });
    }, 400);
  }, true);

  document.addEventListener('mouseout', function() {
    clearTimeout(_hoverTimer);
  }, true);

  // aria-expanded observer — inline panels (accordion, disclosure)
  // Sets _lastPopoverTrigger so the portal observer can link back to it
  new MutationObserver(function(mutations) {
    mutations.forEach(function(m) {
      if (m.type !== 'attributes') return;
      var el = m.target;
      if (el.getAttribute('aria-expanded') !== 'true') return;
      _lastPopoverTrigger = { selector: bestSelector(el), ts: Date.now() };
      if (Date.now() - _lastPopoverEventTs < 200) return; // dedupe with portal observer
      _lastPopoverEventTs = Date.now();
      window.__recordEvent({
        type: 'popover',
        selector: bestSelector(el),
        text: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('aria-controls') || '').trim().slice(0, 80),
        url: window.location.href,
        timestamp: Date.now(),
      });
    });
  }).observe(document.body, { attributes: true, attributeFilter: ['aria-expanded'], subtree: true });

  // Portal observer — watches direct children of <body> and <html> only (no subtree).
  // Any popover library (Popper.js, Floating UI, Radix, MUI, etc.) appends panels there.
  // No role requirement — a plain <div> portal is detected by position in the tree + visibility.
  var _seenPopovers = new WeakSet();
  function _checkPortal(node) {
    if (node.nodeType !== 1) return;
    var parent = node.parentElement;
    if (parent !== document.body && parent !== document.documentElement) return;
    if (_seenPopovers.has(node)) return;
    // Delay one tick so the browser applies inline styles before we check visibility
    setTimeout(function() {
      try {
        var cs = window.getComputedStyle(node);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return;
      } catch(ignore) { return; }
      if (_seenPopovers.has(node)) return;
      _seenPopovers.add(node);
      if (Date.now() - _lastPopoverEventTs < 300) return; // already recorded via aria-expanded
      _lastPopoverEventTs = Date.now();
      var triggerSelector = (_lastPopoverTrigger && Date.now() - _lastPopoverTrigger.ts < 2000)
        ? _lastPopoverTrigger.selector : null;
      var role = node.getAttribute('role') || 'popover';
      var label = (node.getAttribute('aria-label') || role).slice(0, 80);
      window.__recordEvent({
        type: 'popover',
        selector: triggerSelector || ('[role="' + role + '"]'),
        text: label,
        value: role,
        url: window.location.href,
        timestamp: Date.now(),
      });
    }, 50);
  }
  // Two separate observers — one for <html> direct children, one for <body> direct children.
  // document.body can be null when addInitScript runs, so guard before observing it.
  function _watchPortals(root) {
    new MutationObserver(function(mutations) {
      mutations.forEach(function(m) { m.addedNodes.forEach(_checkPortal); });
    }).observe(root, { childList: true });
  }
  _watchPortals(document.documentElement);
  if (document.body) {
    _watchPortals(document.body);
  } else {
    document.addEventListener('DOMContentLoaded', function() { _watchPortals(document.body); });
  }

  // MutationObserver — records tooltip text when role="tooltip" elements appear in the DOM
  var _seenTooltips = new WeakSet();
  new MutationObserver(function(mutations) {
    mutations.forEach(function(m) {
      m.addedNodes.forEach(function(node) {
        if (node.nodeType !== 1) return;
        var tooltip = node.getAttribute && node.getAttribute('role') === 'tooltip'
          ? node
          : node.querySelector && node.querySelector('[role="tooltip"]');
        if (!tooltip || _seenTooltips.has(tooltip)) return;
        _seenTooltips.add(tooltip);
        var text = (tooltip.innerText || tooltip.textContent || '').trim().slice(0, 120);
        if (!text) return;
        // Find the element that triggered the tooltip via aria-describedby
        var id = tooltip.id;
        var trigger = id ? document.querySelector('[aria-describedby="' + id + '"]') : null;
        window.__recordEvent({
          type: 'hover',
          selector: trigger ? bestSelector(trigger) : '[role="tooltip"]',
          text: text,
          url: window.location.href,
          timestamp: Date.now(),
        });
      });
    });
  }).observe(document.body, { childList: true, subtree: true });
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

  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized'],
  });
  const context = await browser.newContext({
    viewport: null,
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
      : event.type === 'select'
      ? `${event.selector} → "${event.text ?? event.value}"`
      : event.text ? `"${event.text}"` : event.selector ?? '';
    console.log(`  [${event.type.padEnd(8)}] ${label}`);
  });

  // Inject recorder into every page (including after navigation)
  await context.addInitScript(RECORDER_SCRIPT);

  const page = await context.newPage();

  // Record navigation events + DOM snapshot when URL changes
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return;
    const url = frame.url();
    const navEvent: RecordedEvent = { type: 'navigate', url, timestamp: Date.now() };
    events.push(navEvent);
    console.log(`  [navigate ] ${url}`);

    // Capture DOM snapshot after page settles (non-blocking)
    page.waitForLoadState('domcontentloaded').then(() =>
      page.locator('html').ariaSnapshot()
    ).then((snapshot) => {
      navEvent.domSnapshot = snapshot;
      console.log(`  [dom      ] ${snapshot.split('\n').length} nodes captured`);
    }).catch(() => { /* snapshot failed — skip silently */ });
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
