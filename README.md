# Bazaar Web3 — Crypto-Powered C2C Marketplace (Frontend Prototype)

> A peer-to-peer marketplace prototype for crypto-native communities. Buy and sell
> physical goods and digital assets with USDT / ETH on a Sepolia testnet escrow mock.
> This commit ships the **frontend prototype only** — no backend, no contracts, no
> real wallet integration.

---

## ⚡ Quick Start

```bash
# 1. Clone
git clone https://github.com/Zzzx4Young/bazaar-web3.git
cd bazaar-web3/frontend

# 2. Install (≈ 1 minute, 422 MB)
npm install

# 3. Run dev server
npm run dev
# → http://localhost:3000
```

That's it. All mock data, sample images (placehold.co / picsum.photos), and wallet
flows are pre-wired. No `.env` required.

**Requirements**: Node.js ≥ 18.17.0 (the project ships `packageManager: npm@10.9.8`).

---

## 🗺️ What's in this prototype

| Route | Description |
|---|---|
| `/` | Hero banner carousel + category tabs + featured / digital / physical grids |
| `/explore` | Filter sidebar (keyword / category / type / currency / condition / sort) + infinite scroll-ready grid |
| `/listing/[id]` | Media carousel + Markdown description + seller card + **BuyModal** (3-step escrow sim) + **ChatDrawer** (local message log) |
| `/publish` | Physical / digital toggle, Zod cross-field validation, image upload, draft persisted to localStorage |
| `/me` | Profile header + buyer/seller order tabs + favorites |
| `/seller/[id]` | Public seller page with rating and active listings |

**Mock dataset**: 25 items · 6 sellers · 12 orders · 5 banners · 5 categories.

---

## 🧰 Tech stack

- **Framework**: Next.js 14 (App Router) + TypeScript 5
- **UI**: Tailwind CSS + shadcn/ui (Radix primitives + lucide-react)
- **State**: Zustand with `localStorage` persistence
- **Forms**: React Hook Form + Zod
- **Markdown**: react-markdown + remark-gfm
- **Media**: embla-carousel-react
- **Data**: static JSON imports under `src/mock/`

Full dependency list in [`frontend/package.json`](./frontend/package.json) — 25 runtime deps, 12 dev deps.

---

## 📜 Available scripts

Run from `frontend/`:

| Command | What it does |
|---|---|
| `npm run dev` | Start dev server on http://localhost:3000 |
| `npm run build` | Production build (Next.js) |
| `npm run start` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint with `next/core-web-vitals` |
| `npm run format` | Prettier across `src/` |

---

## ⚠️ What's NOT in this prototype

This is a UI prototype, not a product. Specifically:

- ❌ **No backend** — there is no API server, no Postgres, no S3
- ❌ **No smart contracts** — the on-chain escrow flow described in
  [`docs/mvp-spec.md`](./docs/mvp-spec.md) is **not implemented** here, only mocked
- ❌ **No real wallet** — no WalletConnect, no wagmi, no viem. Buttons simulate the flow
- ❌ **No real KYC / compliance** — see [`docs/03-compliance.md`](./docs/03-compliance.md)
  for what the eventual product must do
- ❌ **No audit** — never deploy the smart contracts described in `mvp-spec.md` without
  a third-party audit

Publish / buy / favorite / order actions only write to `localStorage`. Reload the tab
and they're gone (intentional — keeps the demo stateless).

---

## 🏗️ Project structure

```
bazaar-web3/
├── README.md                     ← you are here
├── LICENSE
├── .gitignore
├── frontend/                     ← Next.js 14 app (this is what you run)
│   ├── src/
│   │   ├── app/                  ← routes: 7 pages + globals.css + layout
│   │   ├── components/
│   │   │   ├── ui/               ← shadcn/ui primitives (button, card, dialog, ...)
│   │   │   ├── home/             ← hero, category tabs, item card, grid
│   │   │   ├── listing/          ← carousel, markdown, seller card, buy modal, chat drawer
│   │   │   ├── explore/          ← filter sidebar, sort dropdown
│   │   │   ├── publish/          ← publish form
│   │   │   └── me/               ← profile header, order table
│   │   ├── stores/               ← Zustand stores (items / filters / orders / user / favorites)
│   │   ├── lib/                  ← cn() / format / filter utils + mock-data loader
│   │   ├── hooks/                ← useLocalStorage
│   │   ├── types/                ← TS schemas (Item, Seller, Order, ...)
│   │   └── mock/                 ← 25 items + 6 sellers + 12 orders + 5 banners + 5 categories
│   ├── public/
│   ├── package.json
│   └── ...
└── docs/                         ← project documentation
    ├── frontend-prototype-roadmap.md    ← plan of record for this prototype
    ├── frontend-stack-recommendation.md ← tech choices with rationale
    ├── mock-data-spec.md                ← mock dataset schema and contents
    ├── mvp-spec.md                      ← product-endgame reference (chain escrow)
    ├── mvp-tickets.md                   ← vertical tickets for the endgame (decision archive)
    ├── problem.md                       ← review findings on the endgame spec
    ├── hook-issues.md                   ← Hermes verification-loop fix log
    ├── CHANGELOG.md                     ← day-by-day build log of this prototype
    └── 01-10*.md (frozen)               ← feasibility archive from the original spec pass
```

---

## 📚 Documentation index

### Active (this prototype)
- [`docs/frontend-prototype-roadmap.md`](./docs/frontend-prototype-roadmap.md) —
  what we built and why, by phase
- [`docs/frontend-stack-recommendation.md`](./docs/frontend-stack-recommendation.md) —
  dependency versions and rationale
- [`docs/mock-data-spec.md`](./docs/mock-data-spec.md) — 25-item mock dataset schema
- [`docs/hook-issues.md`](./docs/hook-issues.md) — local Hermes config tweaks
- [`docs/CHANGELOG.md`](./docs/CHANGELOG.md) — per-commit history of the prototype

### Reference / decision archive
- [`docs/mvp-spec.md`](./docs/mvp-spec.md) and
  [`docs/mvp-tickets.md`](./docs/mvp-tickets.md) — the **endgame** product spec
  (chain-escrow + Sepolia + Gnosis Safe + email-only KYC). **Not implemented in this
  commit.** Kept for traceability when the project graduates from prototype to product.
- [`docs/problem.md`](./docs/problem.md) — 10 review findings from walking through
  `mvp-spec.md` (3 blockers, 7 yellows). Most are N/A against the prototype path;
  see file for current status.
- [`docs/01-product-overview.md`](./docs/01-product-overview.md) through
  [`docs/10-references.md`](./docs/10-references.md) — the original feasibility pass
  (TAM/SAM/SOM, compliance, payment flow, risks, references). Frozen.

---

## 🎯 Project context

**Problem.** Roughly 500M people hold crypto, but very few places accept it for
real-world goods. Stripe, eBay, and Amazon have evaluated crypto payments for years
and shipped nothing for the C2C user.

**Where this prototype fits.** Before sinking budget into smart contracts, audits,
KYC vendors, and a payment-flow backend, we want to validate the *shape* of the
product: does the UI make sense, do the flows feel right, do mock transactions
behave the way a real user would expect?

**Endgame (see `mvp-spec.md`).** Real on-chain escrow on Sepolia (with optional
Gnosis Safe 2-of-3 multisig for admin operations), email-only KYC, 1% platform
fee, no Mainnet deployment without an audit.

**Geography.** The endgame product explicitly excludes mainland China users. This
prototype ships no region restrictions at all — it's a UI demo.

---

## 🤝 Contributing

This is a single-author prototype right now. If you want to extend it:

1. **Add a page**: route under `frontend/src/app/<segment>/page.tsx`, then wire it
   into the top nav in `frontend/src/app/layout.tsx`
2. **Add a mock item**: edit `frontend/src/mock/items.json` (see
   `docs/mock-data-spec.md` §4.1 for the schema)
3. **Add a shadcn component**: `cd frontend && npx shadcn@2.3.0 add <name>`

---

## 📞 Contact

TBD.

## 📄 License

See [`LICENSE`](./LICENSE).