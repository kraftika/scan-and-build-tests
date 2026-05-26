# Implementation Plan: Autonomous UI Test Generator

## Overview

Build a SaaS web app that takes a URL, autonomously crawls it with Playwright, feeds each page to Claude API for analysis, and produces a downloadable `.zip` of runnable `.spec.ts` Playwright test files — no source code access, no manual recording, no app ownership required.

---

## Architecture Decisions

1. **In-memory job model for MVP.** No database. The API route runs the full pipeline synchronously (or with SSE streaming for progress), returns a download URL backed by a temporary in-memory buffer. Acceptable for MVP; add persistence in v2.

2. **Playwright runs server-side inside the Next.js API route.** This keeps the crawler co-located with the generator. Playwright is a Node.js library — it runs fine in a Next.js API route on Node runtime (not Edge).

3. **One `.spec.ts` file per crawled page.** Each file is self-contained and independently runnable. The test file name is derived from the page path (e.g., `/dashboard` → `dashboard.spec.ts`).

4. **Claude API called once per page.** Input: accessibility tree (text) + screenshot (base64 vision). Output: structured JSON of testable behaviors, which the writer converts to Playwright test code. Batched 5 pages at a time to respect rate limits.

5. **BFS crawl capped at depth 3, max 30 pages.** Prevents runaway jobs. Same-origin only — never follow external links.

6. **Vitest for unit tests, Playwright for e2e.** Vitest is faster and lighter for unit/integration. Playwright is already a dependency, so reuse it for the SaaS UI e2e tests.

---

## Dependency Graph

```
[1] Project scaffold
        │
        ├── [2] URL sanitize module
        │
        └── [3] Crawler types + capture (single page)
                │
                └── [4] BFS spider + crawl orchestrator
                        │
                        ├── [5] Claude API client + prompts
                        │       │
                        │       └── [6] .spec.ts writer
                        │               │
                        │               └── [7] Generator orchestrator
                        │                       │
                        │                       ├── [8] ZIP packager
                        │                       │
                        │                       └── [9] API route (POST /api/generate)
                        │                               │
                        │                               └── [10] Web UI — URL form
                        │                                       │
                        │                                       ├── [11] Job status UI
                        │                                       │
                        │                                       └── [12] Results + download
```

---

## Phase 1: Foundation

### Task 1: Project Scaffold

**Description:** Initialize the Next.js 14 project with TypeScript strict mode, Tailwind CSS, Vitest, Playwright, and all required dependencies. Set up all config files so `npm run dev`, `npm test`, `npm run typecheck`, and `npm run lint` all succeed on an empty project.

**Acceptance criteria:**
- [ ] `npm run dev` starts the dev server without errors
- [ ] `npm run build` succeeds
- [ ] `npm run typecheck` passes with zero errors
- [ ] `npm run lint` passes with zero errors
- [ ] `npm test` runs and reports 0 tests (no failures)
- [ ] `npm run test:e2e` runs and reports 0 tests (no failures)
- [ ] Directory structure matches `SPECs.md` (all dirs created, placeholder files in place)

**Verification:**
- [ ] Run: `npm run dev` — server starts at localhost:3000
- [ ] Run: `npm run typecheck && npm run lint && npm test`

**Dependencies:** None

**Files touched:**
- `package.json`
- `tsconfig.json`
- `next.config.ts`
- `vitest.config.ts`
- `playwright.config.ts`
- `tailwind.config.ts`
- `src/app/layout.tsx`
- `src/app/page.tsx` (placeholder)
- `.env.example`
- `.gitignore`

**Estimated scope:** M

---

### Task 2: URL Sanitization Module

**Description:** Build `src/lib/utils/sanitize.ts` with full validation: reject private IPs (10.x, 172.16-31.x, 192.168.x, 127.x), localhost, `file://`, non-http(s) schemes, and malformed URLs. Return a typed `Result<string, ValidationError>` so callers handle errors explicitly.

**Acceptance criteria:**
- [ ] `sanitizeUrl('https://example.com')` → returns the normalized URL
- [ ] `sanitizeUrl('http://localhost:3000')` → returns an error
- [ ] `sanitizeUrl('http://192.168.1.1')` → returns an error
- [ ] `sanitizeUrl('http://10.0.0.1/admin')` → returns an error
- [ ] `sanitizeUrl('file:///etc/passwd')` → returns an error
- [ ] `sanitizeUrl('not a url')` → returns an error
- [ ] `sanitizeUrl('https://app.example.com/path?q=1')` → normalizes and returns it
- [ ] 100% branch coverage on the sanitize module

**Verification:**
- [ ] Run: `npm test -- --coverage tests/utils/sanitize.test.ts`

**Dependencies:** Task 1

**Files touched:**
- `src/lib/utils/sanitize.ts`
- `tests/utils/sanitize.test.ts`

**Estimated scope:** S

---

## Phase 2: Crawler Core

### Task 3: Crawler Types + Single-Page Capture

**Description:** Define all shared crawler types in `src/lib/crawler/types.ts`, then implement `src/lib/crawler/capture.ts` which opens a single URL in Playwright headless Chromium and returns a fully populated `PageCapture` object: URL, title, screenshot buffer, accessibility tree JSON, all same-origin links, all form descriptors, console errors, and network requests.

**Acceptance criteria:**
- [ ] `capturePage(page)` returns a `PageCapture` with all required fields populated
- [ ] Screenshots are returned as `Buffer` (not file path)
- [ ] Accessibility tree is a non-empty JSON string for any real page
- [ ] Links array contains only same-origin absolute URLs (no anchors, no external)
- [ ] Form descriptors include action, method, and all input field names/types
- [ ] Console errors array captures any `console.error` calls on the page
- [ ] A page with no forms returns an empty array (not null/undefined)
- [ ] Tests mock the Playwright `Page` object — no live browser in unit tests

**Verification:**
- [ ] Run: `npm test tests/crawler/capture.test.ts`

**Dependencies:** Task 1

**Files touched:**
- `src/lib/crawler/types.ts`
- `src/lib/crawler/capture.ts`
- `tests/crawler/capture.test.ts`

**Estimated scope:** M

---

### Task 4: BFS Spider + Crawl Orchestrator

**Description:** Build `src/lib/crawler/spider.ts` (BFS link discovery) and `src/lib/crawler/index.ts` (orchestrator that launches Playwright, runs the spider, respects `robots.txt`, enforces depth=3/max=30/timeout=90s limits, and returns a `CrawlResult`). Add a `scripts/crawl.ts` dev shortcut runnable via `npm run crawl`.

**Acceptance criteria:**
- [ ] Crawling `https://example.com` visits the root page and follows links BFS up to depth 3
- [ ] Never visits more than 30 pages total, regardless of how many links are found
- [ ] Never follows links to external origins (e.g., `https://other.com`)
- [ ] Respects `robots.txt` — skips disallowed paths (tested with a mock)
- [ ] Sets `User-Agent: scan-and-build-tests/1.0` on all requests
- [ ] Returns a `CrawlResult` containing all `PageCapture` objects
- [ ] Completes within `timeout` ms (90s default); throws `CrawlTimeoutError` if exceeded
- [ ] `npm run crawl -- --url https://example.com` runs without error and logs discovered pages

**Verification:**
- [ ] Run: `npm test tests/crawler/spider.test.ts`
- [ ] Run: `npm run crawl -- --url https://playwright.dev` (real network, sanity check)

**Dependencies:** Task 3

**Files touched:**
- `src/lib/crawler/spider.ts`
- `src/lib/crawler/index.ts`
- `scripts/crawl.ts`
- `tests/crawler/spider.test.ts`

**Estimated scope:** M

---

## Checkpoint 1 — Crawler Pipeline

Before proceeding to Phase 3:
- [ ] `npm run typecheck` — zero errors
- [ ] `npm test` — all tests pass, crawler coverage ≥ 80%
- [ ] `npm run crawl -- --url https://playwright.dev` — produces visible output (page list + screenshot count)
- [ ] Human reviews captured output quality before proceeding

---

## Phase 3: Test Generation

### Task 5: Claude API Client + Prompt Templates

**Description:** Build the Claude API integration in `src/lib/generator/prompts.ts`. Define the system prompt and per-page user prompt that takes a `PageCapture` and returns a structured JSON array of `TestableAction` objects (e.g., `{ type: "navigation", description: "...", selector: "...", expectedOutcome: "..." }`). Include a typed Claude API wrapper that enforces the response schema.

**Acceptance criteria:**
- [ ] `buildPagePrompt(capture)` returns a well-formed messages array for the Claude API
- [ ] The system prompt instructs Claude to return only valid JSON matching `TestableAction[]`
- [ ] The user prompt includes: page URL, accessibility tree text, and screenshot as base64 vision input
- [ ] `callClaude(messages)` returns a parsed `TestableAction[]` or throws `LLMParseError`
- [ ] If Claude returns malformed JSON, `LLMParseError` is thrown (not a silent empty array)
- [ ] Prompt templates are tested with snapshot tests — changes require explicit snapshot update
- [ ] API key is read from `process.env.ANTHROPIC_API_KEY` — never hardcoded

**Verification:**
- [ ] Run: `npm test tests/generator/prompts.test.ts`
- [ ] Manual: run against one real `PageCapture` to verify Claude returns valid JSON

**Dependencies:** Task 3

**Files touched:**
- `src/lib/generator/types.ts`
- `src/lib/generator/prompts.ts`
- `tests/generator/prompts.test.ts`
- `.env.example` (add `ANTHROPIC_API_KEY=`)

**Estimated scope:** M

---

### Task 6: Playwright `.spec.ts` File Writer

**Description:** Build `src/lib/generator/writer.ts` that takes a page URL + `TestableAction[]` and returns a string containing a valid, formatted Playwright `.spec.ts` test file. The writer is a pure function — no LLM, no I/O, just string transformation. This is the most testable component in the system.

**Acceptance criteria:**
- [ ] Output is valid TypeScript that compiles without errors
- [ ] Each `TestableAction` maps to exactly one `test('description', ...)` block
- [ ] File always includes the correct Playwright imports at the top
- [ ] Navigation tests use `expect(page).toHaveURL(...)` and `expect(response.status()).toBe(200)`
- [ ] Form tests use `page.fill(selector, value)` + `page.click(submitSelector)` + `expect(page).not.toHaveURL(currentUrl)` (form moved on)
- [ ] Interaction tests use `page.click(selector)` + a relevant assertion
- [ ] Smoke tests check `expect(page.locator('body')).toBeVisible()` and no console errors
- [ ] File name is derived from URL path: `/dashboard/settings` → `dashboard-settings.spec.ts`
- [ ] Snapshot tests lock the output format — changes require explicit update

**Verification:**
- [ ] Run: `npm test tests/generator/writer.test.ts`
- [ ] Run: generate a sample spec file, then `npx tsc --noEmit` on it to verify it compiles

**Dependencies:** Task 5

**Files touched:**
- `src/lib/generator/writer.ts`
- `tests/generator/writer.test.ts`

**Estimated scope:** M

---

### Task 7: Generator Orchestrator

**Description:** Build `src/lib/generator/index.ts` that takes a `CrawlResult`, calls Claude API for each page (batched 5 at a time with 1s delay between batches to respect rate limits), and returns a `TestSuite` — a map of filename → spec file content string.

**Acceptance criteria:**
- [ ] Takes a `CrawlResult` (array of `PageCapture`) and returns `TestSuite` (map of filename → string)
- [ ] Processes pages in batches of 5 with a 1-second pause between batches
- [ ] If one page's LLM call fails, logs the error and continues — does not abort the whole suite
- [ ] A `CrawlResult` with 12 pages produces 12 spec files (or fewer if some pages fail gracefully)
- [ ] Integration test: mock the Claude client, feed 3 `PageCapture` objects, assert 3 spec files returned with correct filenames

**Verification:**
- [ ] Run: `npm test tests/generator/index.test.ts`

**Dependencies:** Task 5, Task 6

**Files touched:**
- `src/lib/generator/index.ts`
- `tests/generator/index.test.ts`

**Estimated scope:** M

---

## Checkpoint 2 — Full Pipeline (CLI)

Before proceeding to Phase 4:
- [ ] `npm run typecheck` — zero errors
- [ ] `npm test` — all tests pass
- [ ] Manual end-to-end: run `npm run crawl`, pipe output manually to generator, verify spec files are produced and compile with `npx tsc --noEmit`
- [ ] Human reviews one generated `.spec.ts` file for quality before proceeding

---

## Phase 4: API + Packaging

### Task 8: ZIP Packager

**Description:** Build `src/lib/utils/zip.ts` — a pure utility that takes a `TestSuite` (map of filename → string content) and returns a `Buffer` containing a valid `.zip` archive. Also include a `playwright.config.ts` template that is always added to the zip, so the user can run `npx playwright test` immediately after extracting.

**Acceptance criteria:**
- [ ] `buildZip(testSuite)` returns a `Buffer`
- [ ] The returned buffer is a valid ZIP (magic bytes `PK\x03\x04`)
- [ ] Each key in `testSuite` becomes a file in the zip with correct content
- [ ] Zip always includes a `playwright.config.ts` with sensible defaults (chromium, baseURL from env)
- [ ] Zip always includes a `README.md` with one-paragraph instructions
- [ ] Empty `testSuite` produces a zip with just the config + readme

**Verification:**
- [ ] Run: `npm test tests/utils/zip.test.ts`
- [ ] Manual: extract the zip and run `npx playwright test` on a real output

**Dependencies:** Task 7

**Files touched:**
- `src/lib/utils/zip.ts`
- `tests/utils/zip.test.ts`

**Estimated scope:** S

---

### Task 9: API Route — POST /api/generate

**Description:** Build `src/app/api/generate/route.ts`. Accepts `{ url: string }` JSON body. Validates the URL, runs the full pipeline (crawl → generate → zip), and returns the zip as a binary download response with `Content-Type: application/zip`. Rate-limit by IP: max 3 requests per minute per IP.

**Acceptance criteria:**
- [ ] `POST /api/generate { "url": "https://example.com" }` returns a 200 with `Content-Type: application/zip`
- [ ] `POST /api/generate { "url": "http://localhost" }` returns 400 with `{ "error": "..." }`
- [ ] `POST /api/generate { "url": "http://192.168.1.1" }` returns 400
- [ ] Missing `url` field returns 400
- [ ] 4th request from the same IP within 60s returns 429
- [ ] Response header includes `Content-Disposition: attachment; filename="tests.zip"`
- [ ] The route uses Node.js runtime (not Edge) — required for Playwright
- [ ] Integration test: mock crawler + generator, assert correct response headers and status codes

**Verification:**
- [ ] Run: `npm test tests/api/generate.test.ts`
- [ ] Manual: `curl -X POST http://localhost:3000/api/generate -H 'Content-Type: application/json' -d '{"url":"https://playwright.dev"}' --output tests.zip`

**Dependencies:** Task 2, Task 4, Task 7, Task 8

**Files touched:**
- `src/app/api/generate/route.ts`
- `tests/api/generate.test.ts`

**Estimated scope:** M

---

## Checkpoint 3 — API Works End-to-End

Before proceeding to Phase 5:
- [ ] `npm run typecheck` — zero errors
- [ ] `npm test` — all tests pass
- [ ] `curl` smoke test: full pipeline runs against a real URL and produces a downloadable zip
- [ ] Human reviews the zip contents before proceeding to UI

---

## Phase 5: Web UI

### Task 10: Landing Page + URL Form

**Description:** Build `src/app/page.tsx` and `src/components/UrlForm.tsx`. A clean single-purpose page: a URL input field, a "Generate Tests" button, and basic client-side validation (non-empty, starts with http/https). On submit, calls `POST /api/generate` and handles the response.

**Acceptance criteria:**
- [ ] Page renders at `/` with a URL input and submit button
- [ ] Submitting an empty field shows an inline validation error (no API call made)
- [ ] Submitting a non-http URL shows an inline validation error
- [ ] Valid submission disables the button and shows a loading state
- [ ] On success (200), triggers a file download of the zip
- [ ] On error (400/429/500), shows a human-readable error message below the form
- [ ] Keyboard accessible: Enter key submits the form

**Verification:**
- [ ] Start `npm run dev`, test in browser: submit valid URL, confirm download triggers
- [ ] Test error state: submit `http://localhost`, confirm error message appears

**Dependencies:** Task 9

**Files touched:**
- `src/app/page.tsx`
- `src/components/UrlForm.tsx`

**Estimated scope:** S

---

### Task 11: Progress / Status UI

**Description:** The current API route is synchronous — crawling 30 pages takes 60-90s and the browser appears frozen. Upgrade the API to stream Server-Sent Events (SSE) with progress updates (`crawling`, `analyzing`, `generating`, `packaging`, `done`). Update `UrlForm` to display a live progress indicator.

**Acceptance criteria:**
- [ ] `POST /api/generate` streams SSE events: `{ event: "progress", data: { stage, pagesFound, pagesProcessed } }`
- [ ] Final event is `{ event: "done", data: { downloadUrl } }` where `downloadUrl` is a one-time temp endpoint
- [ ] UI shows a progress bar or step indicator during processing
- [ ] Each pipeline stage label is visible in the UI as it starts
- [ ] If the stream closes unexpectedly, the UI shows "Something went wrong, please try again"

**Verification:**
- [ ] Start `npm run dev`, submit a real URL, observe progress updates in the UI

**Dependencies:** Task 10

**Files touched:**
- `src/app/api/generate/route.ts` (upgrade to SSE)
- `src/app/api/download/[token]/route.ts` (temp download endpoint)
- `src/components/UrlForm.tsx` (add progress display)
- `src/components/JobStatus.tsx`

**Estimated scope:** M

---

### Task 12: Results Page + E2E Tests

**Description:** Add `src/app/results/[jobId]/page.tsx` and `src/components/TestPreview.tsx` showing a list of the generated test files with syntax-highlighted previews. Add the e2e Playwright test for the full user journey: paste URL → see progress → download zip.

**Acceptance criteria:**
- [ ] Results page shows each generated `.spec.ts` filename and a preview of its content
- [ ] Download button re-triggers the zip download
- [ ] "Generate for another URL" button resets the form
- [ ] E2e test: paste a URL → wait for completion → assert download was triggered
- [ ] E2e test: paste `http://localhost` → assert error message visible

**Verification:**
- [ ] Run: `npm run test:e2e`
- [ ] Manual browser review of the results page with a real URL

**Dependencies:** Task 11

**Files touched:**
- `src/app/results/[jobId]/page.tsx`
- `src/components/TestPreview.tsx`
- `e2e/generate-flow.spec.ts`

**Estimated scope:** M

---

## Checkpoint 4 — Complete MVP

Final acceptance gate:
- [ ] `npm run typecheck` — zero errors
- [ ] `npm test` — all unit/integration tests pass
- [ ] `npm run lint` — zero errors
- [ ] `npm run test:e2e` — e2e tests pass against local dev server
- [ ] `npm run build` — production build succeeds
- [ ] Manual: paste `https://playwright.dev`, download zip, extract, run `npx playwright test`, see results
- [ ] All success criteria in `SPECs.md` are met

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Playwright can't run inside Next.js API route on some hosts | High | Test locally first; document that Node.js runtime (not Edge) is required; consider extracting crawler to a separate process if needed |
| Claude API rate limits at 30 pages | Medium | Batch pages 5 at a time with 1s delay; add exponential backoff on 429 |
| Dynamic SPAs don't render content without interaction | Medium | After navigation, wait for `networkidle`; scroll to bottom; click visible tab elements |
| 90s pipeline is too slow for a synchronous HTTP response | High | SSE streaming (Task 11) solves this — user sees progress, no timeout |
| ZIP download doesn't trigger in all browsers | Low | Use `Content-Disposition: attachment` header; test Chrome + Firefox + Safari |
| Generated tests are syntactically invalid | Medium | Writer is a pure function with snapshot tests; also run `tsc --noEmit` in CI on sample output |

---

## Open Questions (from SPECs.md)

These need a decision before v2 (not MVP blockers):
- Job persistence: add a database or use Redis for job storage?
- Auth / abuse prevention: what auth provider (Clerk? Auth.js?)
- Pricing model: per-crawl, subscription, or free tier?
