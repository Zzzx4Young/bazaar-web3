# Bazaar Web3 — Frontend Demo

A C2C marketplace demo for physical secondhand goods and digital content.
The current implementation is frontend-only: no backend, authentication,
wallet, blockchain, real payment, delivery or refund service.

The next phase is an internal server Alpha with simulated settlement.
Its business scope is confirmed, but server-side features are not implemented.

## Quick start

Requirements: Node.js **>=22.12.0**, npm **10.9.8**.
Dependency versions are defined by [package.json](frontend/package.json) and its lockfile.

```bash
git clone https://github.com/Zzzx4Young/bazaar-web3.git
cd bazaar-web3/frontend
npm ci
npm run dev
```

Open http://localhost:3000/zh-CN or http://localhost:3000/en.
The root URL redirects to /zh-CN. No environment file is required for the Demo.
Cards use local placeholders by default; some detail images and avatars require
external image services. Optional NEXT_PUBLIC_USE_PLACEHOLDER=0 enables card image requests.

## Current pages

All routes below have a /zh-CN or /en prefix. Some business text is not yet translated.

| Route suffix | Implemented capability |
|---|---|
| / | Banners, categories and product grids, including local publications |
| /explore | Keyword, category, type, currency, condition and sorting controls |
| /listing/[id] | Media, Markdown, seller information, favorites, local chat and simulated purchase |
| /publish | Validated publication with placeholder media; no image upload or draft saving |
| /me | Fixed demo profile and buyer/seller order lists |
| /seller/[id] | Demo seller profile and matching static/local products |
| /favorites | Locally saved favorites |
| /notifications | Static sample notifications |

Mock data: 25 products, 6 sellers, 12 orders, 5 banners and 5 categories.
Demo samples do not establish which assets are authorized for future trading.
Displayed currencies and fees do not represent connected payment channels.

## Storage and limitations

Published products, favorites and simulated orders persist in localStorage across
refreshes on the same browser and origin. They do not synchronize across devices.
Clearing site data removes local additions; static samples remain. Local product
links cannot be used by another browser that does not have that data.

Order actions save before updating in-memory state. A failed purchase returns to
confirmation with an error and allows retry. Invalid cached products are excluded
from the in-memory list while valid entries remain usable. Reading a corrupt cache
does not overwrite it; a later successful publication saves the recovered valid
list plus the new product.

Chat messages only live in component memory. Product inventory, shared accounts,
server permissions, shipment, download authorization and refunds are not implemented.
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

Browser tests:

```bash
npx playwright install chromium
npm run test:e2e
```

Playwright starts or reuses the development server on port 3737.
Current [CI](.github/workflows/ci.yml) runs typecheck, lint, unit tests and build;
E2E is not yet included. A local passing test does not establish remote CI status.

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
