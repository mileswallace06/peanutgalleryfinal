# CI Workflow — Manual Installation

Base44's GitHub sync app cannot create `.github/workflows/` files. To enable CI:

1. In your GitHub repository, create `.github/workflows/ci.yml`
2. Paste the content below:

```yaml
name: CI

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Run concurrency tests
        run: npm test

      - name: Lint backend functions
        run: npm run lint:backend
```

## Commands

| Command | Description |
|---|---|
| `npm test` | Runs `node tests/checkout-concurrency.test.mjs` |
| `npm run build` | Runs `vite build` |
| `npm run lint:backend` | ESLint on backend TypeScript/JS files with `@typescript-eslint/parser` |
| `npm run lint` | ESLint on frontend files |