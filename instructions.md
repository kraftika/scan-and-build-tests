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
|---|---|---|
| **Log in** | `npm run record -- --login --url https://your-app.com` | Only if session expires (redirected to login page) |
| **Record a session** | `npm run record -- --url https://your-app.com` | Each time you want to capture a new user flow |
| **Generate tests** | `npm run generate` | After each recording |
| **Run tests** | `npx playwright test output/` | Whenever you want to verify the app |

---

## Notes

- **Without `ANTHROPIC_API_KEY`** — `npm run generate` produces a mechanical translation: each click, fill, and navigation becomes a direct Playwright call.
- **With `ANTHROPIC_API_KEY`** — Claude groups your interactions into logical test cases with meaningful assertions. Add your key to `.env.local`:
  ```
  ANTHROPIC_API_KEY=sk-ant-your-key-here
  ```
- Sessions are saved to `.sessions/` and recordings to `.recordings/` — both are gitignored.
- Generated tests land in `./output/` as `recorded-<hostname>.spec.ts`.
