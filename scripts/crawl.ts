import { crawl } from '../src/lib/crawler/index';
import { sanitizeUrl } from '../src/lib/utils/sanitize';

async function main() {
  const args = process.argv.slice(2);
  const urlFlag = args.indexOf('--url');
  const rawUrl = urlFlag !== -1 ? args[urlFlag + 1] : undefined;

  if (!rawUrl) {
    console.error('Usage: npm run crawl -- --url <url>');
    process.exit(1);
  }

  const sanitized = sanitizeUrl(rawUrl);
  if (!sanitized.ok) {
    console.error(`Invalid URL: ${sanitized.error}`);
    process.exit(1);
  }

  console.log(`Crawling ${sanitized.value} …`);

  const result = await crawl(sanitized.value);

  console.log(`\nCrawl complete in ${result.durationMs}ms`);
  console.log(`Pages discovered: ${result.pages.length}`);
  result.pages.forEach((p, i) => {
    console.log(`  [${i + 1}] ${p.url} — ${p.links.length} links, ${p.forms.length} forms`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
