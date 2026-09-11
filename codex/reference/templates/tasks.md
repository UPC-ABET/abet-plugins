# Tasks — <Change title>

**Slug**: `<slug>` · **Proposal**: `./proposal.md` · **Design**: `./design.md`

## For whoever executes this

- Work in checkpointed batches of 3–5 tasks. Partition each batch by files touched and
  fan the non-overlapping ones out to parallel subagents.
- TDD throughout: write the test, **see it fail**, implement, see it pass.
- A task is complete when **its test passes**, not when the code is written.
- Marking done means checking the box **and** appending `✅ DONE (YYYY-MM-DD)` to the
  heading. Never one without the other — the completeness gate reads the boxes.
- **No autonomous commits.** Propose the grouping and stop.
- Do not edit `docs/POLICIES.md` or `docs/adr/*`.

## Goal

One paragraph. What this change delivers.

## Slicing

Vertical. Each milestone delivers something demonstrable — schema, endpoint, tests and
docs together — rather than a horizontal layer.

<!-- When proposal.md says "Packages affected: both", split the milestones below under
     ## Backend and ## Frontend H2 headings in this same file, instead of two files. The
     completeness gate still counts every `- [ ]` in the file regardless of section. -->

---

## Milestone 1 — <what it delivers>

### Task 1.1 — <title>

- [ ] Task complete

**Files**
- `backend/src/modules/<...>/<file>.ts` (modify)
- `backend/src/modules/<...>/<file>.spec.ts` (test)

**Steps (TDD)**
1. Write the failing case in `<file>.spec.ts`: `pnpm --filter ./backend test -- <pattern>` → expect **red**.
2. Implement `<what>` in `<file>.ts`.
3. Re-run `pnpm --filter ./backend test -- <pattern>` → expect **green**.
4. `pnpm --filter ./backend exec tsc --noEmit -p tsconfig.build.json`.

**Commit**: `feat(<scope>): <subject>`

### Task 1.2 — <title>

- [ ] Task complete

**Files**
- ...

**Steps (TDD)**
1. ...

**Commit**: `test(<scope>): <subject>`

---

## Milestone 2 — <what it delivers>

### Task 2.1 — <title>

- [ ] Task complete

...

---

<!--
Append-only sections below. These record what actually happened, not what was planned,
and they are the best input to the next design.

## Unplanned — <what and why>

### Task U.1 — <title>
- [ ] Task complete

## Post-QA fixes

## Audit fixes (/abet-audit-pr)

### Review round 1

Completed tasks carry a short retro as a blockquote when there is anything worth knowing:

> Green on the second attempt. The first run was a false positive — the fixture factory
> defaulted `is_active` to null, so the filter under test never executed.
-->
