---
name: abet-audit-pr
description: Pre-PR self-audit. Runs six auditors in parallel over the branch diff — code quality, architecture and docs, testing, antipatterns, security, runtime robustness — then synthesises a severity-ranked table and a PR-readiness verdict. Use after /abet-implement or /abet-fix, before /abet-create-pr.
---

# Audit before the PR

Six independent auditors over the same diff, then one synthesiser. Parallel because the
domains do not inform each other, and because a serial thirty-item checklist is slow
enough that people skip it.

This is the author auditing their own work. It is read-only: it does not fix anything,
does not commit, and does not open the PR.

## Phase 0 — serial setup

Do this yourself before dispatching anyone. Everything below feeds the auditors.

1. **Base branch**: `develop`. Confirm it exists locally and is current:
   `git fetch origin develop`.
2. **Collect the diff**:
   `git diff --stat origin/develop...HEAD` and `git diff --name-only origin/develop...HEAD`.
   If it is empty, stop — there is nothing to audit.
3. **Resolve the change**: infer `<slug>` from the branch. Note whether
   `openspec/changes/<slug>/` exists. Absent is fine and means the bug lane
   (`/abet-fix`); it is not a finding on its own.
4. **Task completeness** (only when a change folder exists):
   `grep -c '^- \[ \]' openspec/changes/<slug>/tasks*.md`
   Open tasks remaining is a **blocker** — the change is not finished.
   Zero open **and** zero `- [x]` means the file has no checkboxes at all: report that
   as a blocker too, because the gate cannot see anything and neither can you.
5. **Build PROJECT_RULES**: concatenate `docs/POLICIES.md`, the relevant sections of
   `docs/CONTEXT.md`, any `docs/adr/*` the change touches, `AGENTS.md` if it holds
   content, and the repo profile's stack rules file. Every auditor gets this verbatim.
6. **Detect the stack** from the changed paths so auditors skip what does not apply.

## Phase 1 — six auditors, dispatched in parallel

Send all six in a single message. Each gets: the file list, the full diff, PROJECT_RULES,
and its own domain. Each returns findings as
`{severity, file, line, what, why, fix}` with severity in
`blocker | major | minor | suggestion`.

Instruct every auditor: **report only what is in this diff.** Pre-existing problems in
untouched code are out of scope; noting them buries the findings that matter.

### Auditor A — code quality
Function length and single responsibility. Parameter counts and boolean flags. Data
handling and immutability — accidental mutation of shared objects, missing `readonly`,
leaked entity instances. Class design. Error handling: swallowed exceptions, `catch`
blocks that log and continue, thrown strings, errors that lose their cause, HTTP status
codes that do not match the failure.

### Auditor B — architecture, dependencies, documentation
Layering: does anything reach past its boundary? Are repositories used only from the
layer allowed to use them? Module dependencies and cycles. New third-party dependencies —
justified, maintained, licensed, already-have-one-of-those?

Then **documentation currency**, which is this auditor's most valuable job:

- Does the diff change a domain term, business rule, integration or architectural fact
  that `docs/CONTEXT.md` states differently? **The diff wins** — flag the stale line.
- Does `docs/CONTEXT.md` mention an in-flight change that has already been archived?
- Does the change folder's `proposal.md` still describe what was actually built? If the
  diff and the proposal disagree, the diff wins and the proposal needs a dated scope
  extension.
- Was a decision made here that trips the ADR gate and has no ADR?

### Auditor C — testing
Do the new tests actually assert the acceptance criteria, or do they assert that the
code does what it does? Was any test observed failing before the fix? Edge cases: empty
sets, nulls, boundary values, permission denied, wrong scope. Test naming. Fixtures that
silently defeat the assertion (a factory default that makes the filter under test a
no-op). Anything mocked so heavily the test no longer exercises real behaviour.

### Auditor D — antipatterns and code smells
God objects and god services. Magic numbers and stringly-typed logic. Duplication that
has crossed the threshold. Dead code and commented-out blocks. Premature abstraction.
Deep nesting. Primitive obsession. Leaky abstractions. `any` used to silence the
typechecker. Inconsistent naming against the conventions in PROJECT_RULES.

### Auditor E — security
Run the native `/security-review` over the diff. On top of it: authentication and
authorisation on every new route, input validation at the DTO boundary, injection risk
in raw SQL, secrets in code or config, unsafe deserialisation, file upload handling
(type, size, path), sensitive data in logs and in error responses returned to clients.

### Auditor F — runtime robustness
The domain the other five miss, because none of it is visible in a single file.

- **Cost at scale**: N+1 queries from relation loading inside a loop; queries with no
  pagination or limit; anything quadratic over a collection that grows with enrolment;
  report and export generation that materialises everything in memory instead of
  streaming.
- **Concurrency**: race conditions on read-modify-write, missing transactions around
  multi-write operations, non-idempotent handlers that will be retried.
- **Background work**: jobs that swallow failures, jobs with no timeout, work that
  assumes request context still exists.
- **Scope and tenancy on async paths**: the school / modality / academic-period scope is
  request-derived. Anything that crosses into a job, a cache key, or a shared service
  and loses that scope will silently serve one program's data to another. Treat every
  new cache key and every new async path as a scope-leak candidate.
- **Client lifecycle** (frontend diffs): effects without cleanup, subscriptions never
  torn down, query cache keys that omit a scope variable, state updates after unmount.

Auditor F is stack-aware: skip whole bullets that the changed files cannot exhibit.

## Phase 2 — synthesise

Merge the six reports. Deduplicate findings that several auditors reached from different
angles — but keep the strongest severity and note that it was found more than once, which
is signal rather than noise.

Output one table, ordered by severity:

| # | Severity | Area | File:line | Finding | Fix |
| - | -------- | ---- | --------- | ------- | --- |

Then the verdict:

- **READY** — no blockers, no majors. List minors as follow-ups.
- **NOT READY** — one or more blockers or majors. State exactly what must change.

Then a short **What I checked and found clean** list. An audit that only reports problems
gives no information about coverage.

## After the audit

Fixes from the audit are real work: they go into `tasks.md` under
`## Audit fixes (/abet-audit-pr)` and get implemented through `/abet-implement`, not
patched in silently. That keeps the change's record honest about what review caught.

**This skill does not fix, commit, or push.** When the verdict is READY, the next step is
`/abet-create-pr`.
