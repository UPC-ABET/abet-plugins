---
name: abet-implement
description: Execute an openspec change's tasks.md in checkpointed batches, fanning out non-overlapping tasks to parallel subagents and marking a task complete only when its test passes. Use after /abet-design-feature. Never commits on its own — proposes a commit grouping at the end.
---

# Implement a change

Works strictly from `tasks*.md`. If something is not in the task list, it is not in
scope; if it turns out to be necessary, add it to the task list first so the record
stays honest.

## Preconditions

1. Resolve `<slug>` from the branch (see `reference/conventions.md`).
2. `openspec/changes/<slug>/` exists and contains at least one `tasks*.md`.
3. Read `tasks.md`. On a cross-repo change it holds **only this repo's own tasks** — the
   other side's live in that repo's copy of the change folder. Read `proposal.md` for the
   shared story, and `contract.md` (or the backend's committed `openapi.json`) for the
   API surface you are coding against.
4. Count open tasks: `grep -c '^- \[ \]' openspec/changes/<slug>/tasks*.md`.
   - **Zero open, zero done** → the file was written with headings but no checkboxes.
     Stop and fix the task file first; you cannot track progress against it and neither
     can the audit gate.
   - **Zero open, some done** → the change is already complete. Say so; do not redo it.
5. Confirm you are on `<type>/<slug>`, not on `develop`.

## Steps

### 1. Load the rules that govern the code

Read `docs/POLICIES.md` in full and the relevant parts of `docs/CONTEXT.md`, plus any
ADR the design's **Read first** list points at. If the active repo profile ships a stack
rules file (`abet-backend/rules/backend.md`), read that too. These are the constraints
your code will be audited against; reading them after the audit is too late.

### 2. Batch the work

Take tasks in order, 3–5 at a time. Do not attempt the whole milestone in one pass —
checkpointing is what makes a wrong turn cheap.

Before each batch, **partition by files touched**:

- Tasks whose file sets do not intersect → dispatch to parallel subagents, one task
  each, in a single message.
- Tasks that touch the same files, or where one depends on another's output → run
  serially in this session.

Fan-out is the default, not the exception. Serial execution is the fallback for genuine
ordering dependencies, not the starting assumption.

Each subagent gets: the task block verbatim, the relevant `docs/POLICIES.md` extracts,
and the instruction to run the task's own test command and report the result.

### 3. Execute each task TDD-first

1. Write or update the test named in the task. Run it. **Confirm it fails**, and for the
   right reason — a test that passes before the change tests nothing.
2. Implement the minimum that makes it pass.
3. Re-run. Green.
4. Run the surrounding suite for that module to catch collateral damage.

When a library's API is unclear, **look it up** — use the DeepWiki MCP or read the
source in `node_modules`. Do not guess at signatures and let the typechecker find out.

When something fails in a way you do not understand, debug it systematically: reproduce,
narrow, form one hypothesis, test that hypothesis. Do not apply speculative fixes in
sequence and declare victory when the symptom disappears.

### 4. Mark completion honestly

A task is done when **its test passes** — not when the code is written.

Marking done means both of these, together:

```markdown
### Task 2.3 — Add the bulk-weight endpoint ✅ DONE (2026-07-29)

- [x] Task complete
```

Then append a short retro as a blockquote when there is anything worth knowing:

```markdown
> Ran green on the second attempt. The first pass was a false positive: the fixture
> factory defaulted `is_active` to null, so the filter under test never executed.
```

Record the real numbers and the real blockers. A retro that says "went fine" on a task
that took three attempts is worse than no retro.

### 5. Handle work that was not planned

When execution turns up something the design missed, append it to `tasks.md` under a
clearly-marked section rather than silently doing it:

- `## Unplanned — <what and why>`
- `## Post-QA fixes`
- `## Audit fixes (/abet-audit-pr)`
- `### Review round N`

These sections are append-only and are part of the change's record. They are also the
single best input to the next design, because they show where the last one was wrong.

**Escape hatch**: if the unplanned work needs a new migration, a contract change, or a
new architectural decision, stop. That is no longer implementation — return to
`/abet-design-feature` (and `/abet-adr` if the gate now trips).

### 6. Update the docs that ship with the change

The design's **Docs to update in this PR** list is a task, not a suggestion. Update
`docs/CONTEXT.md` where the change alters the domain vocabulary, a business rule, an
integration, or the architecture.

**If the change touched an API surface**, regenerate the committed spec in the same batch
that changed it — `pnpm openapi:export` on the backend. The spec is the frontend's source
of truth; one that lags the endpoints is worse than none, because it is trusted.

Three prohibitions:

- **Never edit `docs/POLICIES.md`.** It is the team's rulebook; changing it is a
  conversation, not a side effect.
- **Never write `docs/adr/*`.** If a decision emerged that deserves an ADR, say so and
  recommend `/abet-adr`.
- **Never rewrite `AGENTS.md`.** It is a pointer stub. Flag it if it has gone stale.

### 7. Propose commits — do not make them

Group the work into logical commits and show the exact commands. Typically three, not
one mega-commit and not one per checkbox:

```
feat(rubrics): add bulk weight editing endpoint
test(rubrics): cover bulk weight validation and partial failure
docs(context): record the bulk-weight business rule
```

Every subject: single line, Conventional Commits, under 72 characters, no body, no
trailers. The commit-msg hook enforces this, so a malformed subject will simply be
refused.

Then stop and wait. **You do not commit, stage, push, or open a PR.** Next step is
`/abet-audit-pr`.
