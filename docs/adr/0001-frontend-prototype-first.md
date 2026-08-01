# ADR-0001 — Ship the frontend prototype before any backend / contracts work

- **Status**: Accepted
- **Date**: 2026-08-01
- **Deciders**: Project lead
- **Supersedes**: None
- **Superseded by**: None (yet)

## Context

The project started with a full product spec
([`mvp-spec.md`](../mvp-spec.md)) and 20 vertical tickets
([`mvp-tickets.md`](../mvp-tickets.md)) targeting a chain-escrow MVP on
Sepolia, with Gnosis Safe multisig, email-only KYC, 1% platform fee, and
a 14-week delivery estimate for two engineers.

Before committing to that path, two facts on the ground demanded a smaller
first step:

1. **No funding.** The MVP budget of $50–120K for Phase 0 + $256–552K for
   Phase 1 (per [`07-mvp-roadmap.md`](../07-mvp-roadmap.md), now frozen)
   is unfunded. Self-funded solo / duo work cannot sustain a parallel
   contract audit + legal counsel + KYC vendor pipeline.
2. **No validated demand signal.** The 5-person · 4-month plan was
   arithmetic-valid but assumed user demand would exist once shipped. We
   had no UI to show prospective users, investors, or potential partners,
   and no UI feedback loop.

Reviewing the spec surfaced 3 blockers and 7 yellows
([`problem.md`](../problem.md)) — most notably the on-chain escrow timing
rules (P2) and Safe multisig signer composition (P1) — that needed answers
before any contracts work began.

## Decision

**Build a frontend prototype first, with mock data only. Defer the
chain-escrow MVP until prototype feedback justifies the 14-week
commitment.**

Specifically:

1. **Stand up a Next.js 14 + shadcn/ui + Tailwind project** with seven
   routes that walk the full user journey:
   `/`, `/explore`, `/listing/[id]`, `/publish`, `/me`, `/seller/[id]`.
2. **Populate with 25 mock items, 6 sellers, 12 orders, 5 banners**
   (see [`mock-data-spec.md`](../mock-data-spec.md)) so the prototype
   feels like a real product, not a wireframe.
3. **Wire BuyModal and ChatDrawer as in-page simulations** — no real
   wallet, no real messages, no real orders — so we can demo the full
   flow end-to-end without any backend.
4. **Preserve the full original spec as a decision archive** rather
   than deleting it. The endgame architecture (Sepolia + Gnosis Safe)
   remains the target if the prototype validates.
5. **Do not start contracts / backend / KYC / audit work** until at
   least one of these triggers fires:
   - 30 days with ≥ 20 real orders in any pilot
   - Direct user feedback expressing willingness to buy/sell that the
     prototype can't capture
   - A paying partner or investor commits to the chain-escrow path
   - Regulatory action in a target jurisdiction requires immediate
     compliance work

## Consequences

### Positive

- **Speed to feedback.** A complete UI shell with 25 mock items is
  deliverable in days, not weeks. Investors and partners can evaluate
  shape, not slides.
- **Zero capital risk.** No audit fees, no legal fees, no compliance
  vendor integration, no wallet-onboarding UX. Mistakes only cost
  engineering time.
- **Tech-stack validation.** Confirms Next.js + shadcn/ui + Zustand +
  localStorage is workable for the eventual real product. We already
  learned: (a) shadcn v4 CLI dropped `--base-color` flag, (b) Next.js
  App Router + Wagmi needs careful SSR hydration, (c) TanStack Query is
  unnecessary while data is static.
- **Defer hard problems.** P1 (Safe signer composition) and P2 (escrow
  timeout semantics) need product-side answers; the prototype gives us
  a UX to show those answers against instead of arguing abstractly.

### Negative

- **Two parallel mental models.** New contributors will wonder if
  `mvp-spec.md` is the active spec or just an archive. This ADR + the
  README structure are the mitigation; a `STATUS.md` on the project
  root might be needed if confusion persists.
- **Mock data seduction.** Polished mock flows can make the eventual
  real product feel close. It isn't. The BuyModal "auto-release after
  7 days" button is fiction. Don't sell the prototype as a product.
- **Frontend rework likely.** Once real auth, real wallet, and real
  backend land, several components will need rewriting: auth
  middleware, the publish form's deliverable upload, the order detail
  page's state machine mirror. Treat the prototype as throwable.

### Neutral

- **Time spent vs. contract MVP.** The prototype was ~4 engineering
  sessions. The chain-escrow MVP would be ~14 weeks. The prototype is
  cheap insurance either way: if the endgame is killed, the prototype
  still demonstrates product thinking; if it proceeds, the prototype
  is the UX baseline.

## Alternatives considered

### Alternative A — Execute mvp-spec.md directly

Rejected. Requires capital we don't have and a demand signal we can't
get without a UI.

### Alternative B — Telegram Bot prototype first

[`00-project-flow.md`](../00-project-flow.md) suggested this for the
"< 500K RMB MVP budget" branch. Rejected because Telegram Bot does
not demonstrate the marketplace UX we need to validate — the surface
area is too small to communicate the escrow + media + seller-profile
concept to a non-technical audience.

### Alternative C — Static HTML / Figma prototype

Rejected. No interactivity = no real user feedback. Static mockups
can't reveal the filter-sidebar-vs-grid-vs-detail-page flow issues.

## Trigger to revisit

If by **2026-11-01** (3 months from this ADR) the prototype has not
attracted any of:

- 5+ distinct users leaving feedback
- 1+ investor conversation beyond initial pitch
- 1+ partner candidate asking for the source code

…then the prototype thesis is failing and we should freeze further
prototype work and re-evaluate.

## References

- [`mvp-spec.md`](../mvp-spec.md) — full endgame spec, archived
- [`mvp-tickets.md`](../mvp-tickets.md) — 20 tickets, not started
- [`frontend-prototype-roadmap.md`](../frontend-prototype-roadmap.md) —
  what we actually built
- [`frontend-stack-recommendation.md`](../frontend-stack-recommendation.md) —
  why these choices
- [`problem.md`](../problem.md) — 10 review findings on the endgame
  spec
- [`hook-issues.md`](../hook-issues.md) — local Hermes config fix
  unrelated to this decision
- [`CHANGELOG.md`](../CHANGELOG.md) — per-session build history