---
description: Write an Architecture Decision Record. Numbers the next ADR, gathers context, decision, consequences split positive/negative/neutral, and alternatives considered. Use when the ADR gate in /abet-design-feature trips, or whenever a hard-to-reverse technical decision is made.
---

# Write an ADR

An ADR records one hard-to-reverse decision and — the actual point — **why**, including
what was rejected and what it costs.

Code shows what the system does, never why it does that instead of the obvious
alternative. Without the record, someone finds a rule that looks wrong six months from
now, "fixes" it, and reintroduces the problem it was preventing.

This is the only skill permitted to write `docs/adr/`.

## When a decision needs an ADR

Any of these:

- Datastore, message broker or cache choice
- Authentication or payments provider
- A public API contract change, or any breaking change
- A new module boundary, or splitting work across repositories
- Language, runtime or framework
- Contradicting an existing ADR

## When it does not

- Trivial choices with no lasting consequence
- Anything already settled in `docs/POLICIES.md`
- Ordinary feature or bug work — that belongs in commits and the openspec change

If you are unsure, ask: would someone reasonably try to undo this without knowing the
history? If yes, write it.

## Steps

### 1. Number it

List `docs/adr/`, take the highest existing number, add one. Three-digit padded:
`ADR-001`, `ADR-014`. Never reuse a number, even for an abandoned draft.

Filename: `docs/adr/ADR-NNN-<kebab-slug>.md`.

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

- From `openspec/changes/<slug>/design.md`, in the ADR gate section.
- From `docs/CONTEXT.md` or `AGENTS.md` if the ADR must be read before touching a
  particular area. An ADR nobody is pointed at is an ADR nobody reads.

### 5. Report and stop

Show the rendered ADR and the number assigned. Do not commit.

## The immutability rule

Lifecycle: **Proposed → Accepted → (Deprecated | Superseded by ADR-NNN)**.

Once an ADR is **Accepted it is immutable**. You never edit its Context, Decision or
Consequences. To change the decision, write a **new** ADR that supersedes it, and mark
the old one `Superseded by ADR-NNN`.

That is what preserves the trail: a future reader sees not just the current rule but how
the thinking moved, and why the earlier answer stopped being right. Editing in place
destroys exactly the information the ADR existed to keep.

The only edit permitted on an accepted ADR is its **Status** line.
