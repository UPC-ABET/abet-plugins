# Design — <Change title>

**Slug**: `<slug>`
**Proposal**: `./proposal.md`

## Read first

Where the next reader should start, and where this design started.

- `docs/CONTEXT.md` § <section>
- `docs/POLICIES.md` § <section>
- `docs/adr/ADR-0NN-<slug>.md` — <why it matters here>
- `openspec/specs/<prior-slug>/design.md` — prior art for <what>
- `src/modules/<module>/` — the code being modified

## ADR gate (walked, not skipped)

Every row is answered. Recording a "No" is what makes the decision *not* to write an ADR
reviewable rather than invisible.

| Trigger                                        | Hit? |
| ---------------------------------------------- | ---- |
| Datastore, broker or cache choice              | No   |
| Auth or payments provider                      | No   |
| Public API contract change or breaking change  | No   |
| New module boundary or cross-repo split        | No   |
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

- **Module**: `src/modules/<area>/<module>/`
- **Entities / migrations**: what changes, and whether a migration is generated or hand-written
- **Endpoints**: method, route, DTOs, response shape
- **Guards / scope**: which guard, which scope headers apply
- **i18n keys**: the keys added and where they are defined
- **Validation**: business-rule validation vs DTO validation

## Frontend

- **Routes / screens**: ...
- **Components**: ...
- **Data**: query keys, cache invalidation, and every scope variable the key must include
- **Types**: how they stay in sync with the backend contract

<!-- Keep only the section for this repo's own side. design.md is not mirrored across
     repositories — proposal.md and contract.md are the shared copies. -->

## Cross-repo mode

Delete this section for a single-repo change.

- **Mode**: sequential | parallel — and why.
- **Contract**: `./contract.md` (parallel), or the backend's committed `openapi.json`
  (sequential).
- **Ordering**: the backend PR merges and reaches `staging` before the frontend PR merges.

## Testing strategy

| AC | Covered by | Kind |
| -- | ---------- | ---- |
| 1  | ...        | unit / integration / manual |

Anything marked manual must appear in `runbook.md`.

## Risks

| Risk | Mitigation |
| ---- | ---------- |
|      |            |

## Docs to update in this PR

Be specific — file and section. Vague entries here are why `docs/CONTEXT.md` goes stale.

- [ ] `docs/CONTEXT.md` § <section> — <what changes>
- [ ] ...
