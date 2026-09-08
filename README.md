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

Full dependency list in [`frontend/package.json`](frontend/package.json) — 25 runtime deps, 12 dev deps.

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
  [`docs/mvp-spec.md`](docs/archive/mvp-spec.md) is **not implemented** here, only mocked
- ❌ **No real wallet** — no WalletConnect, no wagmi, no viem. Buttons simulate the flow
- ❌ **No real KYC / compliance** — see [`docs/03-compliance.md`](docs/archive/03-compliance.md)
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
└── docs/                         ← current index: docs/README.md
    ├── server-alpha-spec.md      ← confirmed Alpha business baseline
    ├── execution-plan.md         ← dependencies, deliverables and hardening
    ├── frontend-prototype-roadmap.md
    ├── frontend-stack-recommendation.md
    ├── mock-data-spec.md
    ├── adr/                     ← decision records
    ├── review-corrections.md     ← review disposition
    ├── CHANGELOG.md              ← concise change history
    └── archive/                 ← historical research and frozen testnet drafts
```

---

## 📚 Documentation index

Start with [the current docs index](docs/README.md).

- [Alpha business specification](docs/server-alpha-spec.md): confirmed internal-test scope; server-side features are not implemented yet.
- [Execution plan](docs/execution-plan.md): next deliverables, dependencies and Demo hardening.
- [Frontend baseline](docs/frontend-prototype-roadmap.md), [startup guide](docs/frontend-stack-recommendation.md) and [mock data contract](docs/mock-data-spec.md): current implementation.
- [Decisions](docs/adr/0002-server-alpha.md), [review disposition](docs/review-corrections.md) and [changelog](docs/CHANGELOG.md): rationale and traceability.
- [Historical archive](docs/archive/README.md): unverified research and frozen testnet drafts, not current specifications or executable tickets.

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

## 🚀 Deployment

This is a Next.js 14 App Router app; the only deploy shape it supports today is
**Vercel**. The repo root includes a checked-in [`vercel.json`](vercel.json) that
pins `rootDirectory: frontend` so a one-click import from GitHub just works.

```bash
# Either: import the GitHub repo in the Vercel UI (recommended)
#     https://github.com/Zzzx4Young/bazaar-web3 → Vercel "New Project"
# Or, manually:
npm i -g vercel
cd frontend && vercel        # preview deployment
cd frontend && vercel --prod # production
```

There is no backend yet, so no env vars, no secrets, no database URL. Public S3 /
R2 / Postgres only enter the picture when we graduate from prototype to product
(see [`docs/mvp-spec.md`](docs/archive/mvp-spec.md) and [`docs/03-compliance.md`](docs/archive/03-compliance.md)).

Continuous integration: see [`.github/workflows/ci.yml`](.github/workflows/ci.yml) —
a push to `main` runs the same 4-step gate locally (`typecheck → lint → test → build`).

## 📸 Screenshots

Refreshed locally with `npm run screenshot` (script: [`frontend/scripts/screenshot.mjs`](frontend/scripts/screenshot.mjs),
uses the Playwright already in dev deps). Output lands in
[`docs/screenshots/`](docs/screenshots).

```bash
cd frontend
npm run screenshot     # writes 5 PNGs into ../docs/screenshots/
```

The script auto-starts the dev server on `:3737` if nothing is up, and tears it
down at the end. It is **not** wired into CI — screenshots are a manual artifact
and would go stale if auto-regenerated.

---

## 🤝 Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for setup, the gate commands, and the
short list of things that are out of scope for this prototype.

---

## 📞 Contact

TBD.

## 📄 License

See [`LICENSE`](LICENSE).
