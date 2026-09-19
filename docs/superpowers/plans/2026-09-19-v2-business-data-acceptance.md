# V2 Business Data Stressing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Generate a dense, realistic Alpha dataset, harden listing pagination/search and order edge cases, and prove the result with one local and CI Playwright acceptance command.

**Architecture:** Keep V2 data generation as an explicit, loopback-only PostgreSQL script that uses the existing Prisma client and canonical domain states. Add only the API fields needed by the UI contract, then make the explore page consume server pagination instead of filtering a single in-memory page. The V2 browser verifier will create isolated data, run seller/buyer flows in separate contexts, and inspect final counts and event records through a read-only observer connection.

**Tech Stack:** NestJS 12, Fastify, Prisma 7, PostgreSQL, Next.js 14, React, TypeScript, Playwright, Node test runner.

**Spec:** `/home/zzzx47/.codex/attachments/d93f4404-d325-45c4-9432-8f5f566334da/pasted-text-1.txt`

## Global Constraints

- Use Node.js >=22.12 and npm 10.9.8.
- Frontend commands run from `frontend/`; backend commands run from `backend/`.
- Never commit populated environment files or credentials.
- V2 seed commands must refuse non-loopback database targets.
- Preserve the POST-only API contract and `X-Request-Id` response behavior.
- Keep `postgres-test` teardown automatic for acceptance runs.

## Review Focus

- More than 100 listings with long UTF-8 titles must remain readable through grid, detail, and pagination.
- Zero, high precision, crypto, and very large prices must never render as `NaN` or lose their exact string value.
- Server page boundaries must be deterministic and must not duplicate or skip rows when sorting by converted price.
- Out-of-stock and withdrawn/locked listings must fail safely with stable domain errors and no database trace leakage.
- Seeded disputed and refunded orders must expose only participant data and preserve the expected event/audit chain.

### Task 1: Define the V2 seed contract and deterministic dataset

**Files:**
- Create: `backend/scripts/v2-seed.mjs`
- Modify: `backend/package.json`
- Test: `backend/tests/v2-seed.test.mjs`

- [ ] Write tests for deterministic counts, state distribution, long Unicode data, supported currencies, and loopback target rejection.
- [ ] Run the focused test and observe the expected missing-export failure.
- [ ] Implement `seedV2(client, options)` with 12 active accounts, 100 listings, 60 orders, all canonical listing/order states, inventory rows, snapshots, deliveries, issues, refunds, settlements, and events.
- [ ] Add `npm run seed:v2` with an explicit `V2_DATABASE_URL`/`DATABASE_URL` guard and deterministic seed prefix.
- [ ] Run the focused and backend unit suites.

### Task 2: Complete server listing query coverage

**Files:**
- Modify: `backend/src/listings/listing.service.ts`
- Modify: `backend/tests/listings.integration.mjs`
- Modify: `frontend/src/lib/backend-api.ts`

- [ ] Add failing integration cases for keyword search, page boundary stability, zero/high precision values, and a missing/expired quote.
- [ ] Run the integration cases to verify the current contract rejects or ignores the requested fields.
- [ ] Add keyword filtering and explicit `total` metadata while preserving `hasMore`, quote validation, and deterministic tie breakers.
- [ ] Add tests for unsupported/withdrawn/out-of-stock direct API access and safe error payloads.
- [ ] Run the complete backend database suite.

### Task 3: Replace single-page frontend exploration with server pagination

**Files:**
- Modify: `frontend/src/hooks/use-backend-listings.ts`
- Modify: `frontend/src/app/[locale]/explore/page.tsx`
- Modify: `frontend/src/components/explore/filter-sidebar.tsx`
- Create: `frontend/src/components/explore/pagination.tsx`
- Modify: `frontend/src/lib/format.ts`
- Test: `frontend/tests/pages/explore.test.tsx`
- Test: `frontend/tests/components/pagination.test.tsx`

- [ ] Add failing component tests for page navigation, keyword forwarding, long-title rendering, and exact zero/crypto price display.
- [ ] Run the focused tests and confirm the current page has no pagination control.
- [ ] Make the hook expose `page`, `total`, `hasMore`, and refresh state; send keyword/category/type/currency/sort/page to the backend.
- [ ] Render accessible previous/next/page controls, reset page on filters, and clamp stale pages when results shrink.
- [ ] Remove client-side filtering that conflicts with server pagination while preserving loading and empty states.
- [ ] Run all frontend unit tests, typecheck, lint, and build.

### Task 4: Add V2 full-suite browser acceptance and observer assertions

**Files:**
- Create: `backend/scripts/check-v2-journey.mjs`
- Create: `frontend/scripts/run-v2-e2e.mjs`
- Modify: `frontend/package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `.gitignore`
- Test artifact: `frontend/e2e-results-v2/`

- [ ] Add `npm run test:e2e:v2` and a wrapper that starts isolated `postgres-test`, builds the backend, seeds the dataset, starts the API and Next app, and always tears down.
- [ ] Run seller and buyer Chromium contexts against explore search, category filter, price sort, pagination, listing detail, and long-title rendering at desktop and mobile viewports.
- [ ] Exercise a seeded disputed order through buyer issue, seller delivery/counter action, resolution, and final balance/audit checks using the current supported state machine.
- [ ] Query the observer connection for 100+ listings, 60+ orders, inventory consistency, event/request IDs, and no leaked private delivery data.
- [ ] Emit traces, screenshots, videos, and `acceptance-summary.json` under `frontend/e2e-results-v2/`.
- [ ] Run the complete V2 command locally and capture the exact result.

### Task 5: CI, documentation, and final verification

**Files:**
- Modify: `docs/backend-stage-report.md`
- Modify: `docs/execution-plan.md`
- Modify: `frontend/README.md`
- Modify: `docs/CHANGELOG.md`

- [ ] Document the seed contract, canonical state mapping, command, artifact location, and cleanup behavior.
- [ ] Change CI to run the V2 acceptance after the existing checks and upload its artifacts on every outcome.
- [ ] Run `git diff --check`, frontend checks, backend checks, and `npm run test:e2e:v2`.
- [ ] Verify the exact pushed SHA has green `verify` and `backend` jobs plus V2 artifact upload before claiming completion.
