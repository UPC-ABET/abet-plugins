---
name: abet-design-feature
description: "Turn an agreed proposal.md into design.md plus a vertically-sliced tasks.md, walking the mandatory ADR gate on the way. Use after /abet-define-task and before /abet-implement. Handles single-package and cross-package (backend + frontend) changes. Cost: medium — one planning pass; reads the rules and ADRs once."
---

# Design a feature

Takes the ticket and produces the plan: `design.md` (how it will be built and why) and
`tasks.md` (the executable slices). This is where architectural decisions are caught,
before code exists to defend them.

## Preconditions

`openspec/changes/<slug>/proposal.md` must exist and its ACs must be unambiguous. If it
does not exist, run `/abet-define-task` first. If the ACs still contain open questions,
stop — designing against unresolved ACs wastes the design.

Resolve `<slug>` from the branch name; see the slug inference rules in
`plugins/abet-common/reference/conventions.md`.

## Steps

### 1. Load context

Read, in this order: `proposal.md`; root `docs/POLICIES.md` and, for whichever package(s)
`proposal.md` marks as affected, `backend/docs/POLICIES.md` and/or `frontend/docs/POLICIES.md`
— **each in full**, because they hold every convention the design must respect;
`openspec/specs/<capability>/spec.md` for every capability on `proposal.md`'s **Specs
affected** line — **in full**, because its rules, invariants and known edge cases are what
the design must keep true (or knowingly change, saying so in the proposal); and every ADR
in `docs/adr/` (and the package's `adr/`) that those specs link to or whose title touches
this area.

Read an archived change (`openspec/changes/archive/<slug>/`, or legacy
`openspec/specs/<slug>/` — a folder with `proposal.md` and no `spec.md`) only for the
history behind one specific decision a spec or the proposal points at. It is never current
behaviour: a later change may have superseded it, and the capability spec is where that
shows.

Do not read `CONTEXT.md` whole — the backend's is ~100KB. Search root and package
`CONTEXT.md` for the terms the proposal involves (modules, integrations, domain words).

Then read the code. Design that has not read the code it modifies is fiction.

Record what you read as a **Read first** list at the top of `design.md`, so the next
person — and `/abet-implement` — starts where you started.

### 2. Decide single-package or cross-package

Backend and frontend are packages in one repository (`backend/`, `frontend/`), read from
`proposal.md`'s **Packages affected** line.

**Single-package** — one `tasks.md`, no contract file, no H2 sectioning. Each task is a
vertical slice: schema + endpoint + tests + docs together, never a horizontal "all the
entities" layer.

**Both** — one change folder, same as always, with `design.md` and `tasks.md` split into
`## Backend` and `## Frontend` H2 sections in the **same file**. `proposal.md` stays a
single copy; there is nothing to duplicate across repositories anymore.

Then pick the contract mode. This is a real decision, not a formality:

| | **Sequential** — prefer this | **Parallel** |
| --- | --- | --- |
| When | One person does the backend, then the frontend, usually one PR | Two people, or the frontend cannot wait for the backend to land |
| `contract.md` | **Do not create it.** `backend/openapi.json` on disk at HEAD is the contract | **Optional**, agreed before either side writes code |

Sequential is the lower-ceremony default and usually the right answer. Only write a
`contract.md` when the frontend genuinely cannot wait — otherwise you have created a
second source of truth that will drift from the implementation.

For parallel mode, write `contract.md` from
`plugins/abet-common/templates/contract.md` **before** either side's tasks: endpoints,
request and response shapes, scope headers, error keys with statuses, pagination. Say
explicitly what is *not* in the contract, so neither side builds against it speculatively.
One copy, in this change's folder — not duplicated anywhere.

State in `design.md` which mode this change is in and why.

### 3. Walk the ADR gate — mandatory, and record it

This is a checklist, not a judgement call. Walk every row and write the result into
`design.md` as a table:

```markdown
## ADR gate (walked, not skipped)

| Trigger                                          | Hit? |
| ------------------------------------------------ | ---- |
| Datastore, broker or cache choice                 | No   |
| Auth or payments provider                         | No   |
| Public API contract change or breaking change     | ...  |
| New module boundary or cross-package split        | ...  |
| Language, runtime or framework                    | No   |
| Contradicting an existing ADR                     | ...  |

Conclusion: no ADR required.
```

Any **Yes** → stop, run `/abet-adr`, and link the resulting ADR from `design.md` before
continuing. `/abet-design-feature` never writes an ADR itself.

Recording the table even when nothing is hit is the point: it makes the decision *not*
to write an ADR reviewable, instead of invisible. "Partially — assessed, not an ADR"
with the reasoning spelled out is a legitimate answer; silence is not.

### 4. Write design.md

From `plugins/abet-common/templates/design.md`. Sections:

- **Read first** — the pointer list from step 1.
- **ADR gate** — the table from step 3.
- **Approach** — organised per AC, not per layer. A reader should be able to trace
  AC-3 to the paragraph that explains how AC-3 is met.
- **Backend** / **Frontend** — module, entity, migration, endpoint, guard, i18n keys. Use
  both H2 sections when `proposal.md` says both packages are affected; keep just the one
  that applies for a single-package change. `design.md` is one file, never duplicated.
- **Endpoints and scope** (backend) — the table, one row per route added or changed **and
  every sibling route on the same entity**: who may call it (JWT, machine), the permission,
  where the scope comes from (or why the entity is global), how a by-id route proves the row
  belongs to the caller's school, and that "not yours" answers like "not found". Read the
  sibling routes to fill it; do not infer them. Scope gaps on sibling and machine routes are
  the most frequent blocker the audit ledger records, and they are a design omission, not
  a coding slip.
- **Concurrency** — for each locking write: what it serialises against, lock order, and
  its `lock_timeout` through the shared transaction wrapper. Delete when nothing locks.
- **Reuse** — the shared helpers, SQL fragments, constants, types and test fixtures the
  change will use, each with its path, found by `git grep` now rather than by the audit
  later. A new CTE or constant that re-derives a business rule something else encodes is a
  decision: justify it here or reuse the existing one.
- **Cross-package mode** — sequential or parallel and why, where the contract lives (if
  any), and the ordering rule. Delete the section for a single-package change.
- **Testing strategy** — which ACs get unit tests, which need integration, which are
  only verifiable by hand (those go in the runbook).
- **Risks** — and the mitigation for each, including the per-request bound (rows, files,
  array size) for anything that loops, locks or exports.
- **Docs to update in this PR** — be specific. Vague entries here are why
  `docs/CONTEXT.md` goes stale.

### 5. Write tasks.md

Vertical milestones. Each milestone delivers something demonstrable; each task inside it
is one commit-sized unit. Use `plugins/abet-common/templates/tasks.md`.

**Every task block carries its own `- [ ]` checkbox.** Headings alone break the
completeness gate that `/abet-audit-pr` and `/abet-create-pr` depend on — see the task
checkbox rule in `reference/conventions.md`. This is not optional formatting.

Each task states its **Files** (with modify/create/test marked), its **Steps** in TDD
order with the exact command to run, and its proposed **Commit** subject.
Every new file in **Files** is named by its kind, which decides its one folder (the kind
table in the stack rules: `core/<name>.calc.ts`, `core/<name>.mapper.ts`, ... — never
`.functions.ts`, `.utils.ts` or a frontend `*Helpers.ts`). A planned name the gate would
refuse is a plan that fails at the first commit.

The preamble is addressed to whoever executes it, and carries the repo's execution
rules: how tests are run, what must not be run, and that commits are never autonomous.

**tasks.md is a plan, not a work log.** Write tasks, not narrative, and leave out query
output, logs and exploration notes — they belong in the design's reasoning or nowhere. If
the file you are writing (or extending) is past **~50 KB**, flag it: that is a smell that
it is carrying history it should not.

### 6. Decide whether a runbook is needed

Create `runbook.md` when the change carries any of:

- a data migration or backfill,
- a permission or seed sync that must run at deploy time,
- manual verification steps that no test covers,
- anything that needs a documented way to revert.

Given how much of this platform is migration- and seed-driven, most non-trivial backend
changes need one. Lead it with the deploy prerequisite if there is one — that is the
line someone will miss at 6pm on a Friday.

### 7. Report and stop

Show the milestone breakdown, the ADR gate conclusion, and whether a runbook was created.
Then stop. **Do not implement, do not create the branch, do not commit.**
