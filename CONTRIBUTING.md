# Contributing

Single-author prototype right now — keep changes scoped.

## Setup
```bash
git clone https://github.com/Zzzx4Young/bazaar-web3.git
cd bazaar-web3/frontend
npm install
npm run dev   # http://localhost:3000
```

## Run the gate before opening a PR
```bash
cd frontend
npm run typecheck   # tsc --noEmit
npm run lint        # next lint
npm run test        # vitest run
npm run build       # next build
```
All four must exit 0. Mirror this in [.github/workflows/ci.yml](.github/workflows/ci.yml).

## Where things live
- Pages: `src/app/[locale]/<segment>/page.tsx`
- Components: `src/components/{home,listing,explore,publish,me,layout,ui}/`
- State (Zustand, localStorage-backed): `src/stores/`
- Mock data: `src/mock/`
- Schemas: `src/types/`
- Tests: `tests/` (Vitest in subfolders; Playwright e2e under `tests/e2e/`)

See [docs/frontend-prototype-roadmap.md](docs/frontend-prototype-roadmap.md) for the
plan of record and [docs/mock-data-spec.md](docs/mock-data-spec.md) for the mock
data schema.

## Style
- TypeScript strict (no `any` without justification)
- Tailwind utility classes; shadcn/ui primitives only — no other UI kit
- All copy is i18n via `next-intl`; never hardcode zh-CN / en strings in JSX
- New page → also add the route to top-nav in `src/app/[locale]/layout.tsx`
- New mock item → schema in `docs/mock-data-spec.md` §4.1

## Out of scope
This is a frontend prototype. Do not PR:
- Real backend code (Fastify / Postgres / S3)
- Solidity / Hardhat / smart contract code
- Real wallet integration (WalletConnect / wagmi / viem)
- KYC / compliance logic

The roadmap deliberately excludes these (see ADR-0001). If you think one is needed,
open an issue first — don't surprise the maintainer.
