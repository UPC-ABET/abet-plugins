---
name: abet-quick
description: "The lean lane for a small, low-risk change — plan and build it in one session instead of three. Same gates as the full pipeline (rules read in full, testable acceptance criteria, ADR gate, TDD, checkboxes the audit counts), minus the ceremony (no design.md or runbook, one context, one read of the rules). Refuses, by a script and not by mood, anything with a migration, a new dependency or module, both packages, an open product question, or more than 5 tasks. Use for an additive change to an existing module; everything else goes through /abet-define-task. Cost: medium — one session, no subagents."
---

# Quick lane: plan and build a small change in one session

The full pipeline (`/abet-define-task` → `/abet-design-feature` → `/abet-implement`) is three
sessions that each re-read the same rules, re-explore the same code and write three
documents. That is worth paying when a wrong turn is expensive. For an additive change to
an existing module it mostly is not — and most changes here are exactly that.

This lane keeps every **proof** the full pipeline produces and drops the **ceremony** and
the **repetition**:

| Kept — the reason it is safe | Dropped — the reason it is cheap |
| --- | --- |
| `POLICIES.md` (root and package) read in full | Reading it three times, once per session |
| Testable acceptance criteria, and the ambiguity gate: never invent one | A separate design pass and `design.md` (a short *Approach* in the proposal instead) |
| The ADR gate, walked and recorded | `runbook.md`, unless something truly cannot be checked by a test |
| `tasks.md` with the boxes the audit counts | Three sessions' worth of re-exploring the same code |
| TDD: a test seen failing for the right reason, then passing | Red/green per task (it is per batch here) |
| `/abet-audit-pr`, `/abet-create-pr`, the ledger, the hooks — unchanged | Subagent fan-out, which multiplies context for no gain on a small change |

**This lane never skips the audit.** `/abet-audit-pr` still measures the real diff and picks
its own depth: a change that grew is audited as one that grew.

## When it refuses

A script decides, from the plan you write, not from how the change feels. Any one of these
sends the change to `/abet-define-task`:

- more than **5 tasks**, or more than **8 source files** (tests, docs and the regenerated
  `openapi.json` are not counted: one layered endpoint is seven files)
- a **migration**, a dependency or image change, deploy or CI config, or an edit to
  `POLICIES.md` or an ADR
- a **new module**, or a change that touches **both** packages
- an **open question** — a product decision nobody has made
- an ADR-gate row answered **Yes**

The refusal costs one planning pass, whereas wrongly keeping a big change here costs a design
nobody reviewed. If in doubt, go to the full lane.

## Steps

### 0. Set up

Derive the slug (kebab-case, 3–6 words, naming the thing, not the action; it must not exist
in `openspec/changes/` or `openspec/specs/`). If you are on `develop`, create
`feat/<slug>` (or `fix/<slug>`); if you are already on a feature branch, stay on it. Never
work on `staging` or `production`.

### 1. Read the ground truth — once, for the whole session

- **In full**, one `Read` call per file with **no `offset` and no `limit`**: root
  `docs/POLICIES.md`; `backend/docs/POLICIES.md` and/or `frontend/docs/POLICIES.md` for the
  package(s) involved; the profile's stack rules file. They hold every convention the code
  will be audited against, and a section you skipped is a rule you will break. This is the
  one read; do not repeat it.
- **Not in full:** the backend's `CONTEXT.md` is ~100KB. Read root `docs/CONTEXT.md` and
  search the package one for the terms the request involves. List `docs/adr/` titles and
  `openspec/specs/` for prior art.
- **The closest sibling.** Read the existing module most like the one you are extending,
  end to end, and build in its shape. Most of the cost of a change is discovering the
  conventions; a sibling shows them.

### 2. The ambiguity gate — stop here if it fails

Never fabricate an acceptance criterion. If you cannot write one that is testable without
inventing a product decision, write down what you do know, list the **Open questions**, and
stop. A fact the code settles, or an assumption the requester has confirmed, is an
*Assumption*, not an open question; keep the two apart, because the gate counts the second.

### 3. Write the plan

**The scope check comes first, because it is where a cheap plan goes wrong.** A quick plan
reads one module and can miss what a slower design pass would have found: that a row here
can belong to *another school*. For every table the change reads, joins or counts, fill one
row of the proposal's **Scope check** table: how the caller's school reaches the rows, and
whether a row or a group of them can be shared across schools. Guarding the parent is not
enough — a section owned by your school can still hold another school's students, and a
count over them is that school's data leaking as a number. Where rows can be shared, the
aggregate filters by the caller's school, and that case gets its own acceptance criterion
and a failing-first test. Read the entities, the unique keys and `docs/adr/` to find out;
"No" needs its evidence. The gate below refuses a plan that has no Scope check.

- `openspec/changes/<slug>/proposal.md`, from the template: `**Packages affected**`,
  Problem, What already exists, Goals, Non-goals, numbered **Acceptance criteria** with the
  traceability table (every AC gets a row, "Satisfied by" `TBD` until step 5), the
  **Scope check**, **Assumptions**,
  **Open questions** (`None`, or the list), and Risks. Add two sections that replace
  `design.md`: **Approach** (5–10 lines: where the change goes and why, which sibling it
  follows) and **ADR gate (walked, not skipped)**, the table from `/abet-design-feature`
  — Datastore, Auth, Public API contract, New module boundary, Runtime, Existing ADR — each
  answered, even when all are No. A **Yes** stops the lane: run `/abet-adr`, then the full
  lane.
- `openspec/changes/<slug>/tasks.md`, from `templates/tasks.md`: vertical tasks, each with
  its `- [ ] Task complete` box, a **Files** block (`` `path` (modify|new|test) ``) and TDD
  steps. Every file the change touches is named, because the gate reads them.

Then run the gate:

```bash
node node_modules/abet-plugins/shared/scripts/lean-gate.mjs
```

`eligible: false` means stop. Show the reasons, keep `proposal.md` (it is a valid input to
the full lane) and tell the requester to run `/abet-define-task`. Nothing has been built.

### 4. Build in batches — cheaper turns, not weaker proofs

The cost of a session is its turns times its context, so cut turns, not checks:

- **Batch the tests.** Take up to three tasks at a time. Write *all* their tests in one
  message, run them once and confirm they fail **for the right reason** (the method is
  missing, not a typo); then implement the batch in one message and run them once more —
  green. That is the same red-before-green proof, at batch granularity.
- **Every acceptance criterion gets a test that fails without the behaviour**, and a new
  route gets a controller spec that pins its contract — method and path, the permission
  decorator, the required scope header — because that is what a later refactor breaks
  silently. Export only what another file imports.
- **Parallel tool calls.** Independent reads, searches and edits go in one message.
- **Do not re-read** a file you just wrote or a rules file you already read.
- **No subagents.** They start with an empty context and re-read everything.
- **Verify once per batch, and once at the end:** the changed module's suite after each
  batch; then, once, the whole `pnpm --filter ./backend check` and the full test suite.

When a task turns out to need a migration, a new module, a new dependency, a change to an
existing public contract, or a decision the plan did not make, **stop**: that is no longer
this lane. Append it to `tasks.md` under `## Unplanned — <what and why>` and send the
change to the full lane.

### 5. Mark it honestly, and fill the record

A task is done when **its test passes**. Marking it means checking its box *and*
appending `✅ DONE (YYYY-MM-DD)` to its heading — never one without the other, because the
audit gate counts boxes. Fill in the proposal's traceability table (each AC → the file or
endpoint and the test that proves it). Add a one-line retro only where something was
surprising.

### 6. Ship with the change

- An API surface changed: regenerate the committed spec
  (`pnpm --filter ./backend openapi:export`) in the same change.
- A business rule, domain term or integration changed: update `docs/CONTEXT.md`.
- **Never** edit `docs/POLICIES.md`, write `docs/adr/*`, or rewrite `AGENTS.md`.

### 7. Propose commits — do not make them

Show the exact commands for two or three logical commits (single-line Conventional Commits,
under 72 characters, no body, no trailers) and stop. You do not commit, stage, push or open
a PR. Next: `/abet-audit-pr`.
