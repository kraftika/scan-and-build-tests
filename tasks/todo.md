# Task List: Autonomous UI Test Generator

## Phase 1: Foundation

- [ ] **Task 1** — Project scaffold (Next.js 14 + TS + Tailwind + Vitest + Playwright + all deps)
  - Verify: `npm run dev` starts, `npm run typecheck && npm run lint && npm test` all pass
  - Scope: M | Deps: none

- [ ] **Task 2** — URL sanitization module + full test coverage
  - Verify: `npm test tests/utils/sanitize.test.ts` — 100% branch coverage
  - Scope: S | Deps: Task 1

## Phase 2: Crawler Core

- [ ] **Task 3** — Crawler types + single-page capture (screenshot, a11y tree, links, forms, console errors)
  - Verify: `npm test tests/crawler/capture.test.ts`
  - Scope: M | Deps: Task 1

- [ ] **Task 4** — BFS spider + crawl orchestrator (depth 3, max 30 pages, robots.txt, timeout)
  - Verify: `npm test tests/crawler/spider.test.ts` + `npm run crawl -- --url https://playwright.dev`
  - Scope: M | Deps: Task 3

### ✅ Checkpoint 1 — Crawler pipeline works
- `npm run typecheck && npm test` — zero errors, crawler coverage ≥ 80%
- Human reviews crawl output quality

## Phase 3: Test Generation

- [ ] **Task 5** — Claude API client + prompt templates (returns typed `TestableAction[]`)
  - Verify: `npm test tests/generator/prompts.test.ts` + manual LLM call sanity check
  - Scope: M | Deps: Task 3

- [ ] **Task 6** — Playwright `.spec.ts` file writer (pure function, snapshot tested)
  - Verify: `npm test tests/generator/writer.test.ts` + `npx tsc --noEmit` on sample output
  - Scope: M | Deps: Task 5

- [ ] **Task 7** — Generator orchestrator (CrawlResult → batched Claude calls → TestSuite)
  - Verify: `npm test tests/generator/index.test.ts`
  - Scope: M | Deps: Task 5, Task 6

### ✅ Checkpoint 2 — Full pipeline works via CLI
- `npm run typecheck && npm test` — zero errors
- Human reviews one generated `.spec.ts` file for quality

## Phase 4: API + Packaging

- [ ] **Task 8** — ZIP packager (TestSuite → Buffer, includes playwright.config.ts + README)
  - Verify: `npm test tests/utils/zip.test.ts` + manual zip extraction
  - Scope: S | Deps: Task 7

- [ ] **Task 9** — API route `POST /api/generate` (validate → crawl → generate → zip, IP rate limit)
  - Verify: `npm test tests/api/generate.test.ts` + `curl` smoke test
  - Scope: M | Deps: Task 2, Task 4, Task 7, Task 8

### ✅ Checkpoint 3 — API works end-to-end
- `curl` test: full pipeline against real URL produces downloadable zip
- Human reviews zip contents

## Phase 5: Web UI

- [ ] **Task 10** — Landing page + URL form (client validation, submit → download on success)
  - Verify: browser test — valid URL triggers download, invalid shows error
  - Scope: S | Deps: Task 9

- [ ] **Task 11** — SSE progress streaming + live status UI (crawling → analyzing → done)
  - Verify: browser test — progress stages visible during real crawl
  - Scope: M | Deps: Task 10

- [ ] **Task 12** — Results page + test previews + e2e test suite
  - Verify: `npm run test:e2e` passes
  - Scope: M | Deps: Task 11

### ✅ Checkpoint 4 — Complete MVP
- `npm run typecheck && npm test && npm run lint && npm run test:e2e && npm run build`
- Manual: paste URL → download zip → `npx playwright test` runs clean
- All success criteria in `SPECs.md` checked off
