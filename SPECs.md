# Spec: Autonomous UI Test Generator

## Objective

Build a SaaS web application that autonomously generates Playwright test suites for any web application — without requiring access to source code, manual recording, or app ownership.

**Primary user:** A tester or QA engineer who needs to validate a third-party or client application they do not own.

**Core value:** Paste a URL → receive a runnable Playwright test suite that covers navigation, forms, interactions, and visual structure. The tests act as a regression net: they always pass on first run; their value appears when something breaks.

**Success looks like:**
- User enters a URL and receives a `.zip` of `.spec.ts` Playwright test files within 2 minutes
- The generated tests run with `npx playwright test` without modification
- Tests cover: all discovered pages, all forms, all interactive elements, no broken links
- Tests include clear descriptions so a human can read what each test verifies

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Frontend | Next.js 14 (App Router) + TypeScript | SaaS UI, eat your own dog food |
| Backend | Node.js + TypeScript | Native Playwright support, same language throughout |
| Crawler | Playwright (Chromium headless) | Industry standard, TypeScript-native |
| LLM | Claude API (claude-sonnet-4-6) | Best-in-class code generation, vision support for screenshots |
| Styling | Tailwind CSS | Fast UI iteration |
| Runtime | Node.js 20+ | LTS, required by Playwright |

---

## Commands

```bash
# Install dependencies
npm install

# Development server
npm run dev

# Build for production
npm run build

# Run production build
npm start

# Run unit tests
npm test

# Run unit tests with coverage
npm test -- --coverage

# Run e2e tests (against local dev server)
npm run test:e2e

# Lint
npm run lint

# Type check
npm run typecheck

# Run the crawler against a URL (development shortcut)
npm run crawl -- --url https://example.com --output ./output
```

---

## Project Structure

```
scan-and-build-tests/
├── src/
│   ├── app/                        → Next.js App Router pages
│   │   ├── page.tsx                → Landing page / URL input form
│   │   ├── results/[jobId]/        → Results page (test download)
│   │   └── api/
│   │       └── generate/route.ts   → POST /api/generate — kicks off job
│   ├── components/                 → React UI components
│   │   ├── UrlForm.tsx             → URL input + submit
│   │   ├── JobStatus.tsx           → Progress indicator
│   │   └── TestPreview.tsx         → Preview generated test files
│   └── lib/
│       ├── crawler/
│       │   ├── index.ts            → Crawler orchestrator
│       │   ├── spider.ts           → BFS link/state discovery
│       │   ├── capture.ts          → Screenshot + DOM + network capture
│       │   └── types.ts            → CrawlResult, PageState types
│       ├── generator/
│       │   ├── index.ts            → Test generation orchestrator
│       │   ├── prompts.ts          → LLM prompt templates
│       │   ├── writer.ts           → Playwright .spec.ts file writer
│       │   └── types.ts            → GeneratedTest, TestSuite types
│       └── utils/
│           ├── zip.ts              → Bundle test files into .zip
│           └── sanitize.ts         → URL validation and sanitization
├── tests/                          → Unit tests (mirrors src/lib structure)
│   ├── crawler/
│   └── generator/
├── e2e/                            → Playwright e2e tests for the SaaS UI itself
├── output/                         → Local dev output (gitignored)
├── public/
├── SPECs.md                        → This file
├── SPEC.md                         → Original idea brief
├── next.config.ts
├── tsconfig.json
├── playwright.config.ts
└── package.json
```

---

## Code Style

TypeScript strict mode throughout. No `any`. Prefer explicit return types on exported functions.

**Example — a well-formed lib module:**

```typescript
// src/lib/crawler/capture.ts

import type { Page } from 'playwright';

export interface PageCapture {
  url: string;
  title: string;
  screenshot: Buffer;
  accessibilityTree: string;
  links: string[];
  forms: FormDescriptor[];
  consoleErrors: string[];
  networkRequests: NetworkRequest[];
}

export interface FormDescriptor {
  action: string | null;
  method: string;
  fields: { name: string; type: string; required: boolean }[];
}

export async function capturePage(page: Page): Promise<PageCapture> {
  const [accessibilityTree, screenshot] = await Promise.all([
    page.accessibility.snapshot().then(snap => JSON.stringify(snap, null, 2)),
    page.screenshot({ fullPage: true }),
  ]);

  return {
    url: page.url(),
    title: await page.title(),
    screenshot,
    accessibilityTree: accessibilityTree ?? '',
    links: await extractLinks(page),
    forms: await extractForms(page),
    consoleErrors: [],
    networkRequests: [],
  };
}
```

**Conventions:**
- File names: `kebab-case.ts`
- Types/interfaces: `PascalCase`
- Functions: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- No barrel `index.ts` re-exports — import directly from the file
- Async functions over callbacks everywhere
- `Promise.all` for parallel async work
- Named exports only (no default exports except Next.js pages)

---

## Testing Strategy

**Framework:** Vitest (unit) + Playwright (e2e for the SaaS UI)

**Test locations:**
- Unit tests: `tests/` — mirrors `src/lib/` structure
- E2e tests: `e2e/` — tests the web app itself

**Coverage expectations:**
- `src/lib/crawler/` — 80%+ unit coverage (deterministic logic)
- `src/lib/generator/` — snapshot tests for prompt templates; integration tests for LLM output shape
- `src/app/api/` — integration tests with mocked crawler + generator

**Test levels and what they cover:**

| Level | Framework | What it tests |
|---|---|---|
| Unit | Vitest | Crawler extraction logic, URL sanitization, test file writer formatting |
| Integration | Vitest | Crawler → generator pipeline with a real (local) test app |
| E2e | Playwright | SaaS UI: URL input → job status → download |

**Key testing rule:** The crawler and generator are the core product. They get the most test coverage. The Next.js UI is thin — test the happy path e2e only.

---

## Pipeline: How It Works

```
User submits URL
      │
      ▼
1. VALIDATE — sanitize URL, confirm reachable
      │
      ▼
2. CRAWL — Playwright headless Chromium
   - BFS discovery (max depth: 3, max pages: 30)
   - Per page: screenshot + accessibility tree + links + forms + console errors
   - Respect robots.txt
      │
      ▼
3. ANALYZE — Claude API (per page)
   - Input: accessibility tree + screenshot + page URL
   - Output: structured list of testable behaviors
      │
      ▼
4. GENERATE — Write .spec.ts files
   - One spec file per discovered page
   - Test types: navigation, form submission, interaction, no-errors
      │
      ▼
5. PACKAGE — Bundle into .zip
      │
      ▼
6. RETURN — Download link to user
```

---

## Boundaries

**Always do:**
- Validate and sanitize URLs before crawling (block private IPs, localhost, file://)
- Set a User-Agent header identifying the crawler (`scan-and-build-tests/1.0`)
- Respect `robots.txt` — skip disallowed paths
- Enforce crawl limits (max 30 pages, max depth 3, timeout 90s) to prevent runaway jobs
- Run `npm run typecheck && npm test` before considering any feature complete

**Ask first:**
- Changing the LLM model or provider
- Increasing crawl depth/page limits
- Adding persistent storage (database, job queue)
- Adding user authentication to the SaaS itself
- Changing the Playwright test output format or structure

**Never do:**
- Store crawled content, screenshots, or session tokens beyond the duration of a single job
- Follow redirects to external domains outside the original origin
- Submit forms that look destructive (DELETE actions, checkout flows, account deletion)
- Generate tests that make real write operations against the crawled app
- Commit API keys or secrets

---

## Success Criteria (MVP)

- [ ] User can paste any public URL and receive a `.zip` within 2 minutes
- [ ] The zip contains at least one `.spec.ts` file per discovered page (up to 30 pages)
- [ ] `npx playwright test` runs the generated files without syntax errors
- [ ] Each test has a human-readable `test()` description
- [ ] Tests cover: page load (no console errors), all links reachable, forms submit without crashing, interactive elements respond
- [ ] Invalid URLs (private IPs, unreachable hosts) return a clear error message, not a 500
- [ ] The web UI shows a progress indicator during crawl + generation

---

## Open Questions

- **LLM rate limits:** Claude API has per-minute token limits. With 30 pages, each with a screenshot + accessibility tree, we may hit limits. Mitigation: process pages in batches of 5 with backoff.
- **Dynamic SPAs:** Some pages only render content after user interaction (infinite scroll, lazy tabs). The spider needs a strategy for triggering these — options: wait for network idle, scroll to bottom, click visible tabs.
- **Job persistence:** MVP has no database. Jobs run in-memory and results are ephemeral. A user who navigates away loses their results. Acceptable for MVP, needs a decision before v2.
- **Pricing / abuse prevention:** Without auth, the endpoint is open to abuse. MVP mitigation: rate-limit by IP. Real fix: add auth before public launch.
