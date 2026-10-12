# Design — <Change title>

**Slug**: `<slug>`
**Proposal**: `./proposal.md`

## Read first

Where the next reader should start, and where this design started.

- `docs/CONTEXT.md` § <section>
- `docs/POLICIES.md` § <section>
- `docs/adr/ADR-0NN-<slug>.md` — <why it matters here>
- `openspec/specs/<capability>/spec.md` — current behaviour and rules this change must keep
- `openspec/changes/archive/<prior-slug>/design.md` — only for the why behind <decision>
- `src/modules/<module>/` — the code being modified

## ADR gate (walked, not skipped)

Every row is answered. Recording a "No" is what makes the decision *not* to write an ADR
reviewable rather than invisible.

| Trigger                                        | Hit? |
| ---------------------------------------------- | ---- |
| Datastore, broker or cache choice              | No   |
| Auth or payments provider                      | No   |
| Public API contract change or breaking change  | No   |
| New module boundary or cross-package split     | No   |
| Language, runtime or framework                 | No   |
| Contradicting an existing ADR                  | No   |

**Conclusion**: no ADR required.

<!-- If any row is Yes: stop, run /abet-adr, and link the ADR here before continuing.
     "Partially — assessed, not an ADR" is a legitimate answer when the reasoning is
     written out. Silence is not. -->

## Approach

Organised per acceptance criterion, so a reader can trace AC-3 to the paragraph that
explains how AC-3 is met.

### AC-1 — <criterion>

...

### AC-2 — <criterion>

...

## Backend

- **Module**: `backend/src/modules/<area>/<module>/`
- **Entities / migrations**: what changes, and whether a migration is generated or hand-written
- **Endpoints**: method, route, DTOs, response shape
- **i18n keys**: the keys added and where they are defined
- **Validation**: business-rule validation vs DTO validation, and the bound on every
  integer (`@Max`) and array (`@ArrayMaxSize`) the request carries

### Endpoints and scope

One row per route added or changed, **and every sibling route on the same entity** — the
unscoped write beside a scoped read is the gap audits keep finding.

| Route | Principals (JWT, machine) | Permission | Scope taken from | How a by-id route proves the row is the caller's | Not-yours response |
| ----- | ------------------------- | ---------- | ---------------- | ------------------------------------------------ | ------------------ |
|       |                           |            | `@SchoolId()` / global — why |                                  | same as not-found  |

### Concurrency

Delete when no write here takes a lock. For each locking write: what it serialises against,
the order its locks are taken in, and its `lock_timeout` — through the shared transaction
wrapper, not a new one.

## Frontend

- **Routes / screens**: ...
- **Components**: ...
- **Data**: query keys, cache invalidation, and every scope variable the key must include
- **Types**: how they stay in sync with `backend/openapi.json`

<!-- Keep both H2 sections when "Packages affected: both" in proposal.md — design.md is
     one file per change, not mirrored per package. Delete whichever section does not
     apply for a single-package change. -->

## Cross-package mode

Delete this section for a change touching only one package.

- **Mode**: sequential (default) | parallel — and why.
- **Contract**: `./contract.md` (parallel only), or `backend/openapi.json` on disk at HEAD
  (sequential — the default).
- **Ordering**: if split into two PRs, the backend PR merges into `develop` first. No
  requirement to reach `staging` first — `staging` is a deployed environment, not a gate.

## Testing strategy

| AC | Covered by | Kind |
| -- | ---------- | ---- |
| 1  | ...        | unit / integration / manual |

Anything marked manual must appear in `runbook.md`.

## Reuse

What this change builds on instead of re-deriving: shared helpers, SQL fragments, constants,
types and test fixtures, each with its path. A new CTE, constant or helper that encodes a
business rule something else already encodes is a design decision — say here why it cannot
reuse the existing one.

| Need | Existing | Path |
| ---- | -------- | ---- |
|      |          |      |

## Risks

| Risk | Mitigation |
| ---- | ---------- |
|      |            |

Include the per-request bound (rows, files, array size) for anything that loops, locks or
exports, and whether exports stream or buffer.

## Docs to update in this PR

Be specific — file and section. Vague entries here are why `docs/CONTEXT.md` goes stale.

- [ ] `docs/CONTEXT.md` § <section> — <what changes>
- [ ] ...
