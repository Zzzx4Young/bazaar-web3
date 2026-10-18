# Contributing to Bazaar Web3

This repository implements an **internal Alpha** marketplace. The frontend is
Next.js; the separate NestJS/Fastify API persists accounts, listings, orders,
and reviews in PostgreSQL. Payment and balances are simulated. Public signup,
real payment, and production high availability are outside the current accepted
scope. Start with the [project overview](README.md), the
[API contract](backend/openapi/alpha.json), and the relevant package README.

## Set up and run

Use Node.js 22.12 or newer, npm 10.9.8, and Docker Engine with Compose. Install
locked dependencies in both packages:

```bash
(cd backend && npm ci)
(cd frontend && npm ci)
./start.sh
```

`./start.sh` uses the persistent local development database and starts the API
and frontend. It requires the private backend runtime and migration environment
files; see the [backend setup](backend/README.md) and [database choices](infra/README.md)
before first use. The full Compose stack uses a separate database volume, so
data in one stack will not appear in the other.

## Make a change

- Keep business rules in the backend and the [OpenAPI contract](backend/openapi/alpha.json).
  The frontend must display API failures rather than substitute demo records.
- Preserve exact price amounts, order snapshots, account permissions, request
  idempotency, and private delivery data. Add an append-only migration for schema
  changes; do not rewrite migrations that have already run.
- Follow the existing TypeScript, Prettier, Tailwind, and `next-intl` conventions.
  Add or update translations for new user-facing copy.
- Keep credentials in ignored local environment/secret files. Do not commit
  passwords, tokens, browser state, test artifacts, or database dumps.
- `docs/` contains **local, Git-ignored** specifications and historical reports.
  A clone may not contain them. Put essential setup and current behavior in the
  tracked READMEs, code, or OpenAPI contract.

## Verify

Run checks for the package you changed:

```bash
(cd backend && npm run check:backend)
(cd frontend && npm run check:frontend)
```

For backend database behavior, use `npm run test:db` with the isolated
`postgres-test` database described in [infra/README.md](infra/README.md).
For affected browser journeys, run `npm run test:e2e:alpha` or
`npm run test:e2e:v2` from `frontend/`; these use the isolated test database.
Run browser acceptance **after stopping the frontend dev server**, because both
write to the same `.next` directory. Historical prototype-only Playwright tests
run through `test:e2e:demo` and are not Alpha acceptance.

In a PR, describe the changed user behavior, API or migration impact, and the
checks actually run. Include screenshots for visible UI changes. State any
untested production or public-deployment boundary explicitly.
