---
name: abet-adr
description: "Write or change an Architecture Decision Record. Numbers the next ADR, gathers context, decision, consequences split positive/negative/neutral, and alternatives considered; for a change to an existing decision, classifies it as a reversal (new superseding ADR) or a refinement (dated amendment) under the repo's docs/adr/README.md rules and confirms before writing. Keeps the README index current. Use when the ADR gate in /abet-design-feature trips, or whenever a hard-to-reverse technical decision is made or revisited. Cost: light."
---

# Write an ADR

An ADR records one hard-to-reverse decision and — the actual point — **why**, including
what was rejected and what it costs.

Code shows what the system does, never why it does that instead of the obvious
alternative. Without the record, someone finds a rule that looks wrong six months from
now, "fixes" it, and reintroduces the problem it was preventing.

This is the only skill permitted to write a `docs/adr/` — at root or in a package.

## When a decision needs an ADR

Any of these:

- Datastore, message broker or cache choice
- Authentication or payments provider
- A public API contract change, or any breaking change
- A new module boundary, or splitting work across the `backend`/`frontend` packages
- Language, runtime or framework
- Contradicting an existing ADR

## When it does not

- Trivial choices with no lasting consequence
- Anything already settled in a `docs/POLICIES.md`
- Ordinary feature or bug work — that belongs in commits and the openspec change

If you are unsure, ask: would someone reasonably try to undo this without knowing the
history? If yes, write it.

## Steps

### 0. Pick the right adr/ directory, and read its README

Cross-cutting decisions (topology, CI/CD, a choice affecting both packages, or anything in
root `docs/POLICIES.md`/`docs/CONTEXT.md`) go in root `docs/adr/`. A decision scoped to one
package (a backend-only library choice, a frontend-only rendering strategy) goes in that
package's `docs/adr/` (`backend/docs/adr/` or `frontend/docs/adr/`). Say which you picked
and why.

Then read that directory's `README.md`: its naming, qualification and **Rules** sections
are the repo's own and override anything here.

### 1. Number it

List the chosen `docs/adr/`, take the highest existing number **in that directory**, add
one. Three-digit padded: `ADR-001`, `ADR-014`. Numbering is independent per directory —
never reuse a number within the same directory, even for an abandoned draft.

Filename: `docs/adr/ADR-NNN-<kebab-slug>.md` (under whichever directory step 0 picked).

The slug names **the decision**, not the ticket or the change:
`ADR-014-immediate-cutoff-on-program-deactivation.md`, not `ADR-014-abet-1234.md`.
Ticket references age badly; the decision does not.

### 2. Gather the content

Interrogate for each section. Do not fill these from assumption.

**Context** — what situation forced a choice. What was tried, what failed, what
constraint made the status quo unacceptable. If there is a PR or commit where the
alternative was built and reverted, name it: that is the most valuable line in the
document.

**Decision** — active voice, present tense: "We will adopt X." One decision per ADR. If
you find yourself writing "and also", that is a second ADR.

**Consequences** — split into three:

- *Positive* — what this buys.
- *Negative* — what it costs. **An ADR with no negatives is suspicious.** If you cannot
  name the cost, you have not understood the trade-off, and the next reader will
  discover it the hard way. Include inconsistencies the decision knowingly introduces.
- *Neutral* — what changes without being better or worse.

**Alternatives considered** — one or two sentences each on what was rejected and why it
lost. An alternative with no stated reason for losing will be re-proposed.

**References** — PRs, commits, issues, prior ADRs, external docs.

### 3. Write it

From `plugins/abet-common/templates/adr.md`. Status starts as **Proposed**.

When documenting a decision that is already live in production — the retroactive case —
mark it `Proposed (retroactive)` and say so. That is honest: it describes current
reality and is pending team validation, which is different from a decision the team
actively agreed to.

### 4. Link it

- From the directory's `README.md` index: a new row, with the status and its date (see
  *Keep the index current* below).
- From `openspec/changes/<slug>/design.md`, in the ADR gate section.
- From the relevant `docs/CONTEXT.md` or `AGENTS.md` (root or package-level, matching
  where the ADR lives) if it must be read before touching a particular area. An ADR
  nobody is pointed at is an ADR nobody reads.

### 5. Report and stop

Show the rendered ADR, the number assigned and the index row. Do not commit.

To change an ADR that already exists, do not run steps 1–3 first: start at *Changing an
accepted ADR* below, which decides whether a new ADR is needed at all.

## Changing an accepted ADR

What may be edited on an accepted ADR is the repo's rule, not this skill's. Read the
`## Rules` section of the `README.md` in the ADR's own directory — root `docs/adr/README.md`,
or `backend/docs/adr/README.md` / `frontend/docs/adr/README.md` for a package ADR, falling
back to the root one if the package has none — and follow it. Where the README and this
section disagree, the README wins.

**When the README has no Amendments rule** (it says nothing about amending an accepted
ADR, or no README exists), fall back to the strict rule: an accepted ADR is immutable, the
only permitted edit is its **Status** line, and any change to the decision is a new ADR
that supersedes it. Say that you fell back, and why.

Either way, Context, Decision and Consequences of an accepted ADR are never rewritten.
That is what preserves the trail: a future reader sees not just the current rule but how
the thinking moved, and why the earlier answer stopped being right.

### When the user asks to change an existing decision

Before writing anything, classify the request against the README's rules and say which
it is, and why:

| | **Reversal** — the decision no longer holds | **Refinement** — the decision stands |
| --- | --- | --- |
| Looks like | A different choice is made: another datastore, the opposite trade-off, a constraint lifted | A detail changed or something was learned: a limit tuned, a consequence that turned out larger, a clarified scope |
| What you write | A **new** ADR (steps 0–5) that supersedes the old one. On the old ADR the only edit is its Status line, in the form the README gives, e.g. `Superseded by ADR-NNN (YYYY-MM-DD) — <one line on what changed>`. A partial supersession names the part (e.g. "storage shape only"). | No new ADR. Append a dated entry to the `## Amendments` section at the bottom of the existing ADR (create the section if missing), in the README's form, e.g. `- YYYY-MM-DD: <what changed and why> (<link to the change or ADR>)`. |

The test: would someone who read only the original Decision now act wrongly? If yes, it is
a reversal. When it is genuinely borderline, say so and recommend the reversal — a
superseding ADR loses nothing, while an amendment that quietly changes the decision is
exactly the in-place edit the rule exists to prevent. Under the strict fallback there is
no refinement column: everything is a reversal.

**Confirm the classification with the user before writing**, then write only what it
allows.

### Keep the index current

Every ADR directory's `README.md` holds an index table. In the same change as any ADR
write — a new ADR, a status change, a supersession, an amendment — update its row: the
status **with its date** (`Accepted (2026-10-12)`, `Superseded by ADR-007 (2026-10-12)`),
and for a new ADR a new row. A superseded ADR keeps its row. An ADR the index does not
reflect is one the next reader assumes is still in force.
