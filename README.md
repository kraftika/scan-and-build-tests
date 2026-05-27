# Scan & Build Tests

Automated Playwright test generator for web applications you don't own or control. Record a user session in a real browser, then generate runnable `.spec.ts` test files — either mechanically or enhanced by Claude AI.

---

## How it works

```
Record (headed browser)  →  JSON recording  →  Generate  →  .spec.ts  →  npx playwright test
```

1. **Record** — a headed Chromium browser opens. You interact with the app normally. Every click, fill, select, form submit, hover, and popover open is captured to a JSON file in `.recordings/`.
2. **Generate** — the recording is converted to a Playwright test file in `output/`. With an Anthropic API key, Claude groups interactions into logical test cases with meaningful assertions. Without a key, a direct mechanical translation is produced.
3. **Run** — standard `npx playwright test` executes the generated tests.

---

## What gets captured

| Event | Description |
|---|---|
| `navigate` | URL changes, with a full ARIA tree snapshot of the page |
| `click` | Clicks on buttons, links, and interactive elements (captured on `pointerdown`) |
| `fill` | Text input — debounced to capture the final typed value |
| `select` | Native `<select>` dropdowns and custom dropdown options |
| `submit` | Form submissions |
| `hover` | Elements with `title` or `aria-describedby`, plus `role="tooltip"` appearances |
| `popover` | Panels opened via `aria-expanded` or portal divs appended to `<body>` |

Sessions (cookies, localStorage) are saved per hostname in `.sessions/` so authenticated apps work without re-logging in on every run.

---

## Setup

```bash
# Install dependencies
npm install

# Install Playwright browser
npx playwright install chromium

# Create env file
echo "ANTHROPIC_API_KEY=" > .env.local
```

Add your Anthropic API key to `.env.local` if you have one — it enables smarter test generation. The tool works without it.

---

## Workflow

| Step | Command | When to repeat |
|---|---|---|
| **Log in** | `npm run record -- --login --url https://your-app.com` | Only when session expires |
| **Record a session** | `npm run record -- --url https://your-app.com` | Each new user flow |
| **Generate tests** | `npm run generate` | After each recording |
| **Run tests** | `npx playwright test output/` | Whenever you want to verify the app |

### Log in to your app (once per hostname)

```bash
npm run record -- --login --url https://your-app.com/dashboard
```

Browser opens → log in manually → press **Enter** → session saved to `.sessions/`.

### Record a session

```bash
npm run record -- --url https://your-app.com/dashboard
```

Browser opens maximized. Navigate, click, fill forms as a real user would. Press **Enter** in the terminal when done. Recording saved to `.recordings/`.

### Generate tests

```bash
# Uses the most recent recording automatically
npm run generate

# Or point to a specific recording
npm run generate -- --recording .recordings/your-app.com_2026-01-01T00-00-00.json
```

Output: `output/recorded-<hostname>.spec.ts`

If a session exists for the hostname, `test.use({ storageState: '...' })` is added automatically so tests run authenticated.

### Run tests

```bash
npx playwright test output/

# Headed mode — watch the browser execute the steps
npx playwright test output/ --headed

# Debug mode — step through actions one by one
npx playwright test output/ --debug
```

---

## Autonomous crawl mode

Instead of recording manually, you can crawl a site automatically:

```bash
npm run crawl -- --url https://your-app.com
```

Discovers up to 30 pages (BFS, max depth 3), captures ARIA trees and screenshots, then calls Claude to generate tests for every discovered page. Requires `ANTHROPIC_API_KEY`.

---

## Generated test quality

| Mode | Selectors | Assertions | Best for |
|---|---|---|---|
| **Mechanical** (no API key) | Direct translation of recorded selectors | None | Quick smoke check, stable flows |
| **Claude-enhanced** | `getByRole`, `getByLabel`, `getByText` preferred | Meaningful assertions after key actions | Regression testing, CI |

---

## Project structure

```
scripts/
  record.ts       — headed recorder (browser + event injection)
  generate.ts     — test file generator (mechanical + Claude)
  crawl.ts        — autonomous crawler pipeline

src/lib/
  recorder/       — RecordedEvent types
  crawler/        — BFS spider, page capture, robots.txt
  generator/      — Claude prompts, spec file writer
  utils/          — URL sanitisation, env loader

output/           — generated .spec.ts files (gitignored)
.recordings/      — raw JSON recordings (gitignored)
.sessions/        — saved browser sessions / cookies (gitignored)
e2e/              — hand-written Playwright tests
```

---

## Tech stack

- [Playwright](https://playwright.dev) — browser automation and test runner
- [Claude API](https://anthropic.com) — AI-powered test generation (`claude-sonnet-4-6`)
- [Next.js](https://nextjs.org) — application shell
- [Vitest](https://vitest.dev) — unit tests for library code
- TypeScript throughout
