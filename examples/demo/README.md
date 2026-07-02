# pw-self-heal demo

A tiny page (`app.html`) that simulates a UI refactor: load it with `?v=2` and
the data-testids + an id are renamed and a button is reworded — exactly the
drift that breaks selectors but not the page. `demo.spec.ts` keeps asking for the
*original* locators and self-heals each one.

## Run it

```bash
npm install -D @vijaypjavvadi/pw-self-heal @playwright/test
npx playwright install chromium
npx playwright test
```

Expected console output (heuristic mode, no model needed):

```
[pw-self-heal] HEALED getByTestId('add-to-cart') -> getByTestId('add-to-cart-btn') (score=…, heuristic)
[pw-self-heal] HEALED getByRole('button', { name: 'Sign in' }) -> getByRole('button', { name: 'Log in' }) (…)
  1 passed
```

## See the report

```bash
npx pw-self-heal report --html .pwheal/report.html
open .pwheal/report.html
```

## Record the README GIF

Run headed and capture the terminal + browser:

```bash
npx playwright test --headed
```

Use any screen recorder (e.g. `asciinema` for the terminal, or a screen-capture
tool for the browser) on the run above; the heal lines stream live as the test
recovers. Trim to ~5 seconds: test asks for the old locator → console prints
`HEALED …` → test passes green.
