# Bazaar Web3 — Internal Alpha Development

A C2C marketplace internal Alpha for physical secondhand goods and digital content.
The Next.js frontend connects through a same-origin proxy to an independent
NestJS/Fastify + Prisma/PostgreSQL backend. The Alpha implements pre-provisioned
accounts, shared listings, private orders, simulated settlement, physical delivery,
digital delivery and refund recovery. Wallets, blockchain and real settlement remain
outside the current scope.

Project status: I1—I7 and the I8-0/I8-1 database operations milestones are complete. The current code
baseline is `a1c95cc`; its GitHub Actions `verify` and `backend` jobs passed. The next unstarted
milestone is I8-2 deployable API packaging. See the [execution plan](docs/execution-plan.md) and
[stage report](docs/backend-stage-report.md) for the verified boundary.

## Frontend Demo quick start

Requirements: Node.js **>=22.12.0**, npm **10.9.8**.
Dependency versions are defined by [package.json](frontend/package.json) and its lockfile.

```bash
git clone https://github.com/Zzzx4Young/bazaar-web3.git
cd bazaar-web3/frontend
npm ci
npm run dev
```

Open http://localhost:3000/zh-CN or http://localhost:3000/en.
The root URL redirects to /zh-CN. Without a running backend, only the explicitly
labelled unauthenticated Demo content is available.
Cards use local placeholders by default; some detail images and avatars require
external image services. Optional NEXT_PUBLIC_USE_PLACEHOLDER=0 enables card image requests.

## Internal Alpha local start

1. Follow [the infrastructure guide](infra/README.md#docker-compose-启动) to create
   ignored local secrets and start the persistent `postgres` service.
2. Follow [the backend database-role procedure](docs/backend-core-contract.md#数据库角色)
   to create `bazaar_migrate` and `bazaar_runtime`, deploy every checked-in migration,
   and grant runtime permissions.
3. Create accounts with the private-file workflow in
   [backend account provisioning](backend/README.md#预置账户与认证), then start the backend
   with its runtime-role `DATABASE_URL`. Its default address is `127.0.0.1:3001`.
4. Start the frontend with `BACKEND_ORIGIN=http://127.0.0.1:3001`. Set backend
   `APP_ORIGIN` to the exact browser origin, normally `http://localhost:3000`.

The backend never migrates, seeds or cleans the database during startup. Do not use
the temporary `postgres-test` service for data that must survive a container stop.

## Current pages

All routes below have a /zh-CN or /en prefix. Some business text is not yet translated.

| Route suffix | Implemented capability |
|---|---|
| / | Banners, categories and product grids, including local publications |
| /explore | Keyword, category, type, currency, condition and sorting controls |
| /listing/[id] | Media, seller information, favorites, local chat and authenticated Alpha purchase |
| /publish | Authenticated Alpha publication with placeholder media; no image upload or draft saving |
| /me | Authenticated account, seller listing management and private buyer/seller orders; unauthenticated Demo profile |
| /me/orders/[id] | Private order history and role/state-specific payment, delivery, acceptance, issue and refund actions |
| /seller/[id] | Demo seller profile and matching static/local products |
| /favorites | Locally saved favorites |
| /notifications | Static sample notifications |

Mock data: 25 products, 6 sellers, 12 orders, 5 banners and 5 categories.
Demo samples do not establish which assets are authorized for future trading.
Displayed currencies and fees do not represent connected payment channels.

## Storage and limitations

Unauthenticated Demo products, favorites and old simulated orders persist in
localStorage on the same browser and origin. They do not synchronize across devices.
Authenticated Alpha accounts, listings, orders and private histories are PostgreSQL
facts and are never reconstructed from those Demo records.

Order actions save before updating in-memory state. A failed purchase returns to
confirmation with an error and allows retry. Invalid cached products are excluded
from the in-memory list while valid entries remain usable. Reading a corrupt cache
does not overwrite it; a later successful publication saves the recovered valid
list plus the new product.

Chat messages only live in component memory. Registration, image hosting, notifications,
wallets, blockchain settlement and external digital-link availability checks are not
implemented. The Alpha uses simulated payment/settlement and pre-provisioned accounts.
See the [Demo data contract](docs/mock-data-spec.md) for exact storage formats.

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

Legacy Demo browser tests, run from `frontend/`:

```bash
npx playwright install chromium
npm run test:e2e
```

Playwright starts or reuses the development server on port 3737.
Current [CI](.github/workflows/ci.yml) runs frontend/backend checks, PostgreSQL
integration tests, and the real Alpha Chromium acceptance flow. A local passing
test does not establish remote CI status until the workflow run is green.

The real Alpha browser flow runs from `backend/` with the isolated `postgres-test`
service available:

```bash
node scripts/check-i5-browser.mjs
```

It creates random accounts, a schema and a restricted runtime role, then cleans them
after the run. It uses fictitious delivery data and does not open external delivery links.

Other scripts: npm run format formats source; npm run screenshot creates manual
screenshots under docs/screenshots and may start a server on port 3737.

## Architecture and deployment status

Current stack: Next.js 14 App Router, React 18, TypeScript, Tailwind CSS,
Radix components, next-intl, React Hook Form and Zod.
User/filter/order stores use Zustand; products/favorites use a shared localStorage hook.
This describes the checked-in implementation, not a recommendation to retain its
framework version for the planned authenticated Alpha.

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
