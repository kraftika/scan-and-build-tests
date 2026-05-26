import { buildPagePrompt, callClaude } from './prompts';
import { writeSpecFile, urlToFilename } from './writer';
import type { PageCapture } from '@/lib/crawler/types';
import type { TestSuite } from './types';

const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 1000;

export async function generateTestSuite(pages: PageCapture[]): Promise<TestSuite> {
  const suite: TestSuite = {};

  for (let i = 0; i < pages.length; i += BATCH_SIZE) {
    const batch = pages.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (capture) => {
        try {
          const messages = buildPagePrompt(capture);
          const actions = await callClaude(messages);
          const filename = urlToFilename(capture.url);
          suite[filename] = writeSpecFile(capture.url, actions);
        } catch (err) {
          console.warn(`[generator] Skipping ${capture.url}: ${(err as Error).message}`);
        }
      }),
    );

    if (i + BATCH_SIZE < pages.length) {
      await delay(BATCH_DELAY_MS);
    }
  }

  return suite;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
