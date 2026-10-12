# <Capability name>

**Capability**: `<capability>`
**Last updated by**: `openspec/changes/archive/<slug>/` (YYYY-MM-DD)

<!-- Current truth for one capability. Edited in place by /abet-archive after each merged
     change: rewrite a statement the change superseded, never append history. No task logs,
     no debugging narrative, no "in PR #12 we…" — the why lives in the archived change or
     the ADR each line links to. Keep it short: if a section outgrows a screen, it is
     probably holding history. Repo-wide rules belong in docs/POLICIES.md or AGENTS.md,
     not here. -->

## Purpose

One or two sentences: what this capability is for, and for whom.

## Behaviour

What it does today, as observable behaviour — endpoints, screens, jobs, outputs. Present
tense. One bullet per behaviour.

- ...

## Rules & invariants

What must always hold: business rules, data-validity conditions, scope rules. Each line
links to where it was decided.

- ... ([<slug>](../../changes/archive/<slug>/) · [ADR-0NN](../../../docs/adr/ADR-0NN-<slug>.md))

## Known edge cases

Cases that have caused bugs, or that look wrong and are deliberate. Each says what happens
and links to the change that established it.

- ... ([<slug>](../../changes/archive/<slug>/))

## References

- `openspec/changes/archive/<slug>/` — <what that change established>
- `docs/adr/ADR-0NN-<slug>.md` — <decision>
- `backend/src/modules/<area>/<module>/` · `frontend/src/<...>/` — where the code lives
