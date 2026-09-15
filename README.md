# Bazaar Web3 — Internal Alpha Development

A C2C marketplace internal Alpha for physical secondhand goods and digital content.
The Next.js frontend connects through a same-origin proxy to an independent
NestJS/Fastify + Prisma/PostgreSQL backend. The Alpha implements pre-provisioned
accounts, shared listings, private orders, simulated settlement, physical delivery,
digital delivery and refund recovery. Wallets, blockchain and real settlement remain
outside the current scope.

Project status: I1—I8 and M1 Alpha release hardening are complete. Commit `113c1ee` passed both
GitHub Actions jobs, including PostgreSQL integration, deployment images, and Chromium acceptance.
See the [execution plan](docs/execution-plan.md),
[deployment runbook](docs/api-deployment-runbook.md), and
[stage report](docs/backend-stage-report.md) for the verified boundary.

## Frontend development server

Requirements: Node.js **>=22.12.0**, npm **10.9.8**.
Dependency versions are defined by [package.json](frontend/package.json) and its lockfile.

```bash
git clone https://github.com/Zzzx4Young/bazaar-web3.git
cd bazaar-web3/frontend
npm ci
npm run dev
```

Open http://localhost:3000/zh-CN or http://localhost:3000/en.
The root URL redirects to /zh-CN. This command starts the web process only. Current
pages load listings, accounts and orders from the backend, so use the complete startup
below for an operational Alpha. Browser GET requests for pages, React Server Components,
scripts and icons are normal; business API requests use the POST-only Alpha contract.

## Internal Alpha local start

1. Run `bash infra/scripts/init-secrets.sh` from the repository root.
2. Run `docker compose -f infra/compose.alpha.yaml up -d --build --wait`.
3. Open `http://localhost:3000/zh-CN`. Provision test accounts through the private-file workflow in
   [backend account provisioning](backend/README.md#预置账户与认证) when needed.

The backend never migrates, seeds or cleans the database during startup. Do not use
the temporary `postgres-test` service for data that must survive a container stop.

## Current pages

All routes below have a /zh-CN or /en prefix. Some business text is not yet translated.

| Route suffix | Implemented capability |
|---|---|
| / | Alpha introduction, fixed categories and server-backed product grids |
| /explore | Server-backed listings with keyword, category, type, currency and supported sorting controls |
| /listing/[id] | Server-backed detail and seller identity, local favorite preference and authenticated purchase |
| /publish | Authenticated Alpha publication with placeholder media; no image upload or draft saving |
| /me | Authenticated account, seller listing management and private buyer/seller orders |
| /me/orders/[id] | Private order history and role/state-specific payment, delivery, acceptance, issue and refund actions |
| /seller/[id] | Public seller identity derived from current server-backed listings |
| /favorites | Local favorite IDs resolved against current server-backed listings |
| /notifications | Explicit unavailable state; no synthetic notifications |

## Storage and limitations

Theme and favorite IDs remain browser preferences. Accounts, listings, orders and private
histories are PostgreSQL facts; API failures show an error and never switch to sample or
local business data. Unknown order-command results retain their payload and idempotency key
for safe retry.

Registration, image hosting, notifications, chat,
wallets, blockchain settlement and external digital-link availability checks are not
implemented. The Alpha uses simulated payment/settlement and pre-provisioned accounts.
The [Demo data contract](docs/mock-data-spec.md) documents the superseded prototype only.

## Development and verification

Run in frontend/:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run start
```

Stop the development server before building: dev and build share .next output.
Restart development after a build to avoid stale assets.

Historical Demo browser specs remain for traceability and are not Alpha acceptance. The
active Alpha browser flow runs from `backend/` against an isolated PostgreSQL schema:

```bash
npx playwright install chromium
cd ../backend
node scripts/with-test-db.mjs node scripts/check-i5-browser.mjs
```

Current [CI](.github/workflows/ci.yml) runs frontend/backend checks, PostgreSQL
integration tests, and the real Alpha Chromium acceptance flow. A local passing
test does not establish remote CI status until the workflow run is green.

It creates random accounts, a schema and a restricted runtime role, then cleans them
after the run. It uses fictitious delivery data and does not open external delivery links.

Other scripts: npm run format formats source; npm run screenshot creates manual
screenshots under docs/screenshots and may start a server on port 3737.

## Architecture and deployment status

Current stack: Next.js 14 App Router, React 18, TypeScript, Tailwind CSS,
Radix components, next-intl, React Hook Form and Zod.
Authentication and filter state use Zustand; only theme and favorite IDs use browser storage.

A standard Node runtime can serve a production build with npm run start.
Public deployment is outside the approved internal Alpha scope. The repository
Vercel configuration still needs review; do not assume a one-click deployment works.
No deployment or configuration change is included in this storage-hardening work.

## Documentation

- [Current documentation index](docs/README.md)
- [Alpha business specification](docs/server-alpha-spec.md)
- [Execution plan and remaining hardening](docs/execution-plan.md)
- [Frontend capabilities](docs/frontend-prototype-roadmap.md)
- [Frontend stack and startup](docs/frontend-stack-recommendation.md)
- [Change history](docs/CHANGELOG.md)
- [Historical archive](docs/archive/README.md) — unverified research and frozen testnet drafts, not current specifications
- [Contributing](CONTRIBUTING.md)
- [License](LICENSE)
