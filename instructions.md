# Scan & Build Tests — Usage Guide

## Setup (once)

```bash
# Install dependencies
npm install

# Install Playwright browser
npx playwright install chromium

# Create env file (add API key later if you have one)
echo "ANTHROPIC_API_KEY=" > .env.local
```

---

## Log in to your app (once per app)

```bash
npm run record -- --login --url https://your-app.com/dashboard
```

Browser opens → log in → press **Enter** → session saved to `.sessions/`.

---

## Workflow

| Step | Command | When to repeat |
| ---- | ------- | -------------- |
| **Log in** | `npm run record -- --login --url https://your-app.com` | Only if session expires (redirected to login page) |
| **Record a session** | `npm run record -- --url https://your-app.com` | Each time you want to capture a new user flow |
| **Generate tests** | `npm run generate` | After each recording |
| **Generate all** | `npm run generate -- --all` | Generates a separate spec file for every recording |
| **Run tests** | `npx playwright test output/` | Whenever you want to verify the app |

---

## Recording

```bash
npm run record -- --url https://your-app.com
```

A headed, maximised Chromium browser opens. Interact with the app as a real user would. The recorder captures:

- **clicks** — buttons, links, and any interactive element (detected on `pointerdown`)
- **fill** — text typed into inputs and textareas (debounced to final value)
- **select** — native `<select>` dropdowns and custom dropdown options
- **submit** — form submissions
- **hover** — elements with `title` / `aria-describedby`, and `role="tooltip"` appearances
- **popover** — panels opened via `aria-expanded` or portal `<div>` appended to `<body>`
- **navigate** — URL changes, each with a full ARIA tree snapshot of the page

Press **Enter** in the terminal when done. Recording saved to `.recordings/`.

---

## Generating tests

```bash
# Most recent recording
npm run generate

# Specific recording file
npm run generate -- --recording .recordings/your-app_2026-01-01T00-00-00.json

# All recordings at once
npm run generate -- --all
```

Output: `output/recorded-<hostname>.spec.ts`

If a saved session exists for the hostname, `test.use({ storageState: '...' })` is added automatically so tests run authenticated.

**Without `ANTHROPIC_API_KEY`** — mechanical translation: each recorded event becomes a direct Playwright call.

**With `ANTHROPIC_API_KEY`** — Claude groups interactions into logical test cases with meaningful assertions. Add your key to `.env.local`:

```
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

---

## Running tests

```bash
# Run all generated tests
npx playwright test output/

# Watch the browser execute steps
npx playwright test output/ --headed

# Step through actions one by one
npx playwright test output/ --debug

# Open the HTML report (includes browser console logs per test)
npx playwright show-report
```

Browser console logs (`console.error`, uncaught exceptions, etc.) are automatically captured and attached to each test in the HTML report. Errors are also printed to the terminal immediately.

---

## Notes

- Sessions are saved to `.sessions/` and recordings to `.recordings/` — both are gitignored.
- Generated tests land in `./output/` as `recorded-<hostname>.spec.ts` — also gitignored.
- `npm run generate` (default) writes `recorded-<hostname>.spec.ts` — reruns overwrite the same file.
- `npm run generate -- --all` writes `recorded-<hostname>_<timestamp>.spec.ts` per recording — each gets its own file, nothing is overwritten.
- The `e2e/` folder is for hand-written tests and is picked up by the same `npx playwright test` command.
