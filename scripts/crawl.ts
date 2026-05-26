import { chromium } from 'playwright';
import { crawl } from '../src/lib/crawler/index';
import { generateTestSuite } from '../src/lib/generator/index';
import { sanitizeUrl } from '../src/lib/utils/sanitize';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';

const SESSIONS_DIR = join(process.cwd(), '.sessions');

function sessionPath(url: string): string {
  const hostname = new URL(url).hostname.replace(/[^a-z0-9.-]/gi, '_');
  return join(SESSIONS_DIR, `${hostname}.json`);
}

async function saveSession(url: string): Promise<void> {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(url);

  console.log('\nLog in, then come back here and press Enter to save your session...');
  await waitForEnter();

  mkdirSync(SESSIONS_DIR, { recursive: true });
  const dest = sessionPath(url);
  await context.storageState({ path: dest });
  await browser.close();
  console.log(`\nSession saved to ${dest}`);
}

function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question('', () => {
      rl.close();
      resolve();
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const urlFlag = args.indexOf('--url');
  const rawUrl = urlFlag !== -1 ? args[urlFlag + 1] : undefined;
  const loginMode = args.includes('--login');

  if (!rawUrl) {
    console.error('Usage: npm run crawl -- --url <url> [--login]');
    process.exit(1);
  }

  const sanitized = sanitizeUrl(rawUrl);
  if (!sanitized.ok) {
    console.error(`Invalid URL: ${sanitized.error}`);
    process.exit(1);
  }

  const url = sanitized.value;

  if (loginMode) {
    await saveSession(url);
    console.log('\nRun without --login to crawl with the saved session.');
    return;
  }

  const session = sessionPath(url);
  const hasSession = existsSync(session);

  if (hasSession) {
    console.log(`Using saved session from ${session}`);
  }

  console.log(`Crawling ${url} …`);

  const result = await crawl(url, {
    ...(hasSession ? { storageState: session } : {}),
  });

  console.log(`\nCrawl complete in ${result.durationMs}ms`);
  console.log(`Pages discovered: ${result.pages.length}`);
  result.pages.forEach((p, i) => {
    console.log(`  [${i + 1}] ${p.url} — ${p.links.length} links, ${p.forms.length} forms`);
  });

  console.log('\nGenerating Playwright tests via Claude API…');
  const suite = await generateTestSuite(result.pages);

  const outDir = join(process.cwd(), 'output');
  mkdirSync(outDir, { recursive: true });
  for (const [filename, content] of Object.entries(suite)) {
    const dest = join(outDir, filename);
    writeFileSync(dest, content, 'utf8');
    console.log(`  ✓ ${dest}`);
  }
  console.log(`\nDone — ${Object.keys(suite).length} test files written to ./output/`);
  console.log('Run them with: npx playwright test --config output/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
