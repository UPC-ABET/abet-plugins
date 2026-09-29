# <Change title>

**Slug**: `<slug>`
**Branch**: `feat/<slug>`
**Packages affected**: backend | frontend | both
**Created**: YYYY-MM-DD

## Problem

What is wrong today, for whom, and what it costs them. Written from the user's or the
operation's point of view, not as "we need feature X".

## What already exists

The modules, endpoints, entities, screens and jobs already in play. Most changes here
are additive to something that exists — say what, with paths. This section is what stops
the design proposing to build something that is already half built.

## Goals

- What must be true when this is done.

## Non-goals

- Explicitly out of scope, so review does not drift into it.

## Acceptance criteria

Numbered and testable. Given / When / Then where it helps.

1. **AC-1** — ...
2. **AC-2** — ...
3. **AC-3** — ...

### Traceability

Filled in by `/abet-design-feature` and kept current through implementation. This table
is what makes review verifiable instead of narrative.

| AC | Criterion | Satisfied by |
| -- | --------- | ------------ |
| 1  | ...       | TBD          |
| 2  | ...       | TBD          |
| 3  | ...       | TBD          |

## Dependencies

Other changes, migrations, seeds, or external systems (Banner, uPlanner, Azure AD, S3)
this relies on.

## Scope check

Required whenever the change reads, joins or aggregates data. One row per **table** the
change touches: how the caller's school reaches those rows, and whether a row (or a group)
can belong to **more than one** school — a section under programs of two schools, a user in
several. Where it can, an aggregate must count only the caller's own school's rows: a count
over another school's students is that school's data leaking as a number. That case needs its
own acceptance criterion and a failing-first test. `No` is a valid answer only with its
evidence (the unique key, the ADR, the code that shows it).

| Table | Scoped to the caller's school by | Can rows be shared across schools? | Covered by |
| ----- | -------------------------------- | ---------------------------------- | ---------- |
|       |                                  |                                    | AC-?       |

## Risks

| Risk | Impact | Mitigation |
| ---- | ------ | ---------- |
|      |        |            |

## Open questions

Anything unresolved. **If this section is non-empty, the change is not ready to design.**

---

<!--
Scope growth is recorded by appending a dated section, never by rewriting the above:

### Scope extension — <what> (YYYY-MM-DD)

Why it grew, and the new ACs numbered continuing from the existing set.
-->
