# ts-playwright-framework

TypeScript + Playwright test automation framework. Built as a deliberate deep dive into Playwright-native concepts, not a port of an existing Selenium or Cypress suite. Tests run against a real external site ([the-internet.herokuapp.com](https://the-internet.herokuapp.com)) and a real public API, so some of what's documented here is genuine transient network behavior, not code bugs; that distinction is called out explicitly where it matters.

## Why This Repo

Playwright ranks ahead of Selenium in most current Tier A/B automation JDs. My existing portfolio already covered Selenium (Java), API testing (Python), data-driven testing (Python), and Cypress (JavaScript). TS + Playwright was the genuine gap, not a rebrand of something already proven. The goal was to understand what Playwright does architecturally differently from Selenium and Cypress, and demonstrate that difference, not just describe it.

## Tech Stack

TypeScript
Playwright
xlsx (SheetJS), data-driven testing
GitHub Actions (CI/CD, Docker-based, sharded matrix)
Docker, hand-authored Dockerfile on Playwright's official base image

## Project Structure

```
pages/            → Page classes (LoginPage)
tests/
  ├── api.spec.ts → API-only tests (request fixture, no browser)
  └── ui.spec.ts  → UI tests: DDT login suite, isolation, network
                     interception, trace demo, visual regression
data/
  └── login-cases.xlsx  → 20-row DDT dataset
.github/workflows/
  └── playwright.yml    → Docker-based, 2-shard CI matrix
Dockerfile
playwright.config.ts
```

## How To Run

Run the full suite:
```
npx playwright test
```

Run inside Docker (same environment as CI):
```
docker build -t ts-playwright-framework .
docker run --rm -v "${PWD}:/app" ts-playwright-framework
```
The volume mount matters. Without it, any file the container writes (including visual regression baselines) is discarded when the container exits. See "Known Limitation" below.

View a trace after a failure:
```
npx playwright show-trace <path-to-trace.zip>
```

---

## Architecture: Selenium vs Playwright

### Waiting
**Selenium** needs explicit `WebDriverWait` calls scattered through test code, or you get flaky stale-element failures. **Playwright** auto-waits on every action (`.click()`, `.fill()`, etc.) up to a configured timeout before failing. This removes an entire class of test code, and an entire class of flakiness, that Selenium requires you to manage yourself.

### Parallelism and Isolation
**Why This Matters:** In Java/Selenium, safe parallel execution requires `ThreadLocal<WebDriver>`. A raw `WebDriver` is not thread-safe, so without manual isolation, parallel tests can silently share and corrupt driver state. I hit this exact bug in my Selenium repo (shared-driver issue, fixed with explicit `.remove()` in `@AfterMethod`).

**How Playwright Differs:** The problem doesn't need solving. It doesn't exist. Every test gets its own isolated `BrowserContext` automatically: separate cookies, storage, cache, with zero manual isolation code.

```typescript
test('context isolation - session not leaked across tests', async ({ page }) => {
  // no login performed here, if a previous test's session leaked
  // into this context, we'd land on /secure instead of /login
  await page.goto('/login');
  await expect(page).toHaveURL(/login/);
  await expect(page.locator('h2')).toHaveText('Login Page');
});
```
This test doesn't just assert isolation exists. It proves it, by checking that a prior test's login session never leaks into a fresh context, regardless of worker or run order.

### Locators
Selenium's `WebElement` is a live reference that goes stale if the DOM changes underneath it. Playwright's `Locator` is lazy, re-resolved fresh on every action, so there's no staleness to manage.

### File I/O From Test Code
My Cypress repo needed a `cy.task` Node bridge to read Excel files, because Cypress test code runs inside the browser sandbox with no file-system access. Playwright test code runs in a real Node.js process. No sandbox, no bridge required:

```typescript
import * as XLSX from 'xlsx';
import path from 'path';

const workbook = XLSX.readFile(path.join(__dirname, '../data/login-cases.xlsx'));
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const loginCases = XLSX.utils.sheet_to_json<{ username: string; password: string; expectSuccess: boolean }>(sheet);
```

---

## Trace Viewer

**Why This Exists:** Answers "how do you debug a failing test," near-certain in an interview, and is fast to build and visually demonstrable.

**How It Works:** A deliberately-broken test targets a selector that doesn't exist, triggering `trace: 'on-first-retry'` in config. The resulting trace file opens with `npx playwright show-trace` and shows DOM snapshots, the network waterfall, and console output at the exact moment of failure.

```typescript
test('trace demo - deliberately broken selector', async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await page.locator('.this-selector-does-not-exist').click();
});
```

**Bugs Hit Building This:**
- A `test()` block was accidentally nested inside another `test()`'s callback instead of declared as a sibling. It silently never ran. Playwright's `test()` calls must be top-level.
- `trace: 'on-first-retry'` was planned but never actually added to `playwright.config.ts`. No trace was captured at all until this was caught.

---

## Network Interception

**Why This Exists:** The original mocked-failure test only ever replaced a response wholesale. Real interception work is broader than that.

**Timeout / hung request**, proves the suite can exercise loading-state handling, not just error handling:
```typescript
await page.route('**/posts/1', async route => {
  await new Promise(() => {}); // never resolves
});
```

**Malformed JSON**, a different failure mode than an HTTP error; the app has to fail at parse time, not status-check time:
```typescript
route.fulfill({ status: 200, contentType: 'application/json', body: '{ this is not valid json' });
```

**Intercept-and-modify**: the real request completes via `route.fetch()`, then the response is mutated before being returned. Different from a full mock: the real network call still happens, only the data is altered afterward.
```typescript
const response = await route.fetch();
const json = await response.json();
json.title = 'INTERCEPTED: ' + json.title;
await route.fulfill({ response, json });
```

---

## Data-Driven Testing (Excel)

**Design Decision:** Uses `xlsx` (SheetJS), the same library as the Cypress repo, but read natively in Node here, no task-bridge required (see Architecture section above).

`data/login-cases.xlsx` holds 20 rows: valid credentials, invalid combinations, empty/whitespace-only fields, case-sensitivity checks, leading/trailing whitespace, an intentionally duplicated row, long strings, a default-credentials guess, and SQL-injection- and XSS-shaped strings as negative tests.

```typescript
loginCases.forEach(({ username, password, expectSuccess }, index) => {
  test(`[${index}] login with username="${username}" expects ${expectSuccess ? 'success' : 'failure'}`, async ({ page }) => {
    // ...
  });
});
```

**Key Lesson:** Playwright requires unique test titles within a file, unlike `pytest.mark.parametrize` or JUnit's `@ParameterizedTest`, which disambiguate parametrized instances internally. Several data rows produced identical generated titles and caused a hard "duplicate test title" error. Fixed by switching from `for...of` to `.forEach(..., index)` and prefixing each title with its row index.

---

## Visual Regression

**Design Decision:** Snapshots the `#login` form container specifically, not the full page. A full-page screenshot on an external site not under my control is fragile; an unrelated content change (banner, timestamp, ad) breaks the baseline for reasons that have nothing to do with the code under test. Element-level snapshotting is also the more realistic real-world choice; most production visual regression suites snapshot components, not entire pages.

```typescript
test('visual regression - login form appearance', async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await expect(page.locator('#login')).toHaveScreenshot('login-form.png');
});
```

**Key Lesson:** Baseline images are platform-specific by filename (`login-form-win32.png` on Windows, `login-form-linux.png` on Linux/Docker). This is Playwright's own automatic behavior, reflecting a real constraint: font/anti-aliasing rendering differs subtly between operating systems, so a baseline from one platform isn't valid on another.

---

## Docker + CI Sharding

Two distinct levels of Docker involvement, worth naming separately:

**1. CI runs inside Playwright's official image.** GitHub Actions' `container:` key pulls `mcr.microsoft.com/playwright` directly. No `npx playwright install --with-deps` step needed, and CI's browser versions are guaranteed to match what Playwright's own team tests against.

**2. A hand-authored `Dockerfile`**, this repo's own, not just a reference to someone else's image:
```dockerfile
FROM mcr.microsoft.com/playwright:v1.62.0-noble

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

CMD ["npx", "playwright", "test"]
```
Dependency files are copied and installed *before* the rest of the code, deliberately. This ordering preserves Docker's layer cache, so an unrelated code change doesn't force a full `npm ci` re-run on every build.

Proven locally, not just written and assumed correct. `docker build` produces a real image, `docker run` executes the full suite inside the container's own Linux filesystem and network namespace.

**Sharding:** CI runs a 2-shard matrix (`strategy.matrix.shard: [1, 2]`, `fail-fast: false`), splitting the suite across two parallel jobs.

**Design Decision:** Kept at 2 shards, not 4. With a live external site as the test target, more concurrent shards means more concurrent load against a site I don't control, for limited additional demonstration value at this suite's current size.

**Known Limitation:** Running `docker run --rm` without a volume mount discards any file the container writes, including a newly-generated visual regression baseline, the moment the container exits. This caused CI to fail repeatedly: the Linux baseline was generated inside a `--rm` container, never persisted to host disk, and therefore never committed. CI kept regenerating a fresh baseline every run and reporting it as a failure, indefinitely. Fixed by mounting the project directory (`-v "${PWD}:/app"`) so generated files land on real disk, then committing the resulting baseline.

---

## On Flakiness, Stated Plainly, Not Hidden

This suite hits a real external website and a real public API. During development it surfaced genuine transient failures: DNS resolution errors, mid-test network interface changes, full page-load timeouts, both on local WiFi and once inside Docker's own network namespace (`ERR_NAME_NOT_RESOLVED`, recovered on retry). None were code or logic bugs; every one was caught and resolved by `retries: 2`, exactly as retries are meant to work. A suite depending on a live external system will show this behavior. Configuring retries to absorb it is the correct response, not a workaround to explain away.

## Status

Phase 1 (foundational fluency) and Phase 2, originally scoped as 2-3 items, four were built: trace viewer, network interception, parallel execution/isolation, Excel-driven DDT, are complete. Phase 3 was scoped as one hard integration; two were built: visual regression and Docker/CI sharding with a hand-authored Dockerfile, proven via local build and run. CI is green apart from the intentionally-failing trace-demo test, which is designed to fail.