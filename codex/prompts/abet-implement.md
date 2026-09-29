# Implement a change

Works strictly from `tasks*.md`. If something is not in the task list, it is not in
scope; if it turns out to be necessary, add it to the task list first so the record
stays honest.

## Preconditions

1. Resolve `<slug>` from the branch (see `reference/conventions.md`).
2. `openspec/changes/<slug>/` exists and contains at least one `tasks*.md`.
3. Read `tasks.md`. On a change affecting both packages it holds `## Backend` and
   `## Frontend` H2 sections in the same file — work only the section(s) relevant to what
   you are implementing right now. Read `proposal.md` for the shared story, and
   `contract.md` (or `backend/openapi.json` on disk) for the API surface you are coding
   against.
4. Count open tasks: `grep -c '^- \[ \]' openspec/changes/<slug>/tasks*.md`.
   - **Zero open, zero done** → the file was written with headings but no checkboxes.
     Stop and fix the task file first; you cannot track progress against it and neither
     can the audit gate.
   - **Zero open, some done** → the change is already complete. Say so; do not redo it.
5. Confirm you are on `<type>/<slug>`, not on `develop`.

## Steps

### 1. Load the rules that govern the code

Read **in full**: root `docs/POLICIES.md`, and `backend/docs/POLICIES.md` and/or
`frontend/docs/POLICIES.md` for whichever package(s) the tasks touch, plus the active
profile's stack rules file (`abet-backend/rules/backend.md`, `abet-frontend/rules/frontend.md`).
They hold every convention your code will be audited against, so a section you skipped is
a convention you will break; reading them after the audit is too late.

`CONTEXT.md` is different: the backend's is ~100KB, so do not read it whole. Search it
(and the ADRs the design's **Read first** list points at) for the terms this task
involves — the module, the integration, the domain words.

### 2. Batch the work

Take tasks in order, 3–5 at a time. Do not attempt the whole milestone in one pass —
checkpointing is what makes a wrong turn cheap.

Before each batch, **partition by files touched**:

- Tasks whose file sets do not intersect → candidates for parallel subagents.
- Tasks that touch the same files, or where one depends on another's output → run
  serially in this session.

Fan out only when **three or more** independent tasks are ready in the batch. Each
subagent starts with an empty context and must re-read the rules and its files, so
splitting two small tasks costs more than doing them one after the other. Below three,
run them serially here. If the invocation arguments contain `serial`, never fan out.

When you do fan out, dispatch them in a single message, each as a subagent with `model: "terra"` set explicitly on every spawn (never omit it: an omitted model inherits the session model, which may be the most expensive one).
Each gets: the task block verbatim, the **paths** of the rules files to read (do not paste
their contents — that is retyping them once per subagent), and the instruction to run
the task's own test command and report the result.

### 3. Execute each task TDD-first

1. Write or update the test named in the task. Run it. **Confirm it fails**, and for the
   right reason — a test that passes before the change tests nothing.
2. **Search before you write.** For any helper, query, mapping or validation you are about
   to add, `git grep` for one that already does it and use it. If you find one, use it.
   If the logic you need already exists in **two** other places, your copy would be the
   third — extract it into one shared home (a function in `core/<module>.functions.ts`, or
   `libs/` when it crosses modules; a service or repository method; on the frontend a
   shared hook or component) and point all three at it, in this change. The audit counts
   copies across the repo and reports a third one as major; it is far cheaper to extract
   now than to be sent back.
3. Implement the minimum that makes it pass.
4. Re-run. Green.
5. Run the surrounding suite for that module to catch collateral damage.

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
that changed it — `pnpm --filter ./backend openapi:export`. The spec is the frontend's
source of truth; one that lags the endpoints is worse than none, because it is trusted.

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
