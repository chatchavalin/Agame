# Tests

Regression tests for the A-Math core rule engine. They load the **real** browser
modules from `../js` into a tiny Node `window` shim (see `harness.js`), so the
code under test is exactly what ships — no duplicated logic.

## Run

```bash
node tests/run.js     # or:  npm test
```

Each file prints its own pass/fail count; the runner exits non-zero if anything fails.

## What's covered

- **evaluator.test.js** — A-Math equation validity: arithmetic, precedence,
  multi-equals, digit concatenation, leading-zero ban, division-by-zero, unary
  signs, structural rules, 3-digit limit, fractions.
- **scoring.test.js** — tile/equation premium multipliers (new tiles only),
  `premiumUsed` not re-triggering, and the +40 bingo bonus at RACK_SIZE.
- **bingo-solver.test.js** — the Calculator solver: solution-object API
  (`faces`/`blankVals`/`blankIdx`), blank tracking, unary-minus bingos,
  `choicesFor`, and the 9-tile hook search.

## Adding a test

Add a `*.test.js` file that requires `./harness`, calls `T(label, condition)`
for each check, and ends with `process.exit(summary())`. The runner picks it up
automatically.
