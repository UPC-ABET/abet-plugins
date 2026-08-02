---
description: Review someone else's pull request. Runs the native security review alongside three parallel ABET lenses, checks the openspec change is in the right state, and produces blocker/major/minor/suggestion findings with What/Why/Fix. Read-only against GitHub until you approve posting.
---

# Review someone else's PR

This is the **reviewer's** side. For your own branch before opening a PR, use
`/abet-audit-pr` instead — that one is an author self-check and assumes you can change the
code. Here you cannot, so the output is findings and a verdict, not fixes.

Everything against GitHub stays **read-only** until you explicitly approve posting.

## Phase 0 — gather, serially

```bash
gh pr view <number> --json title,body,author,baseRefName,headRefName,files,additions,deletions
gh pr diff <number>
gh pr checks <number>
```

Then establish context the diff alone cannot give you:

1. **Base branch** should be `develop`. A PR targeting `staging` or `production` directly
   is a **blocker** — those only ever receive fast-forward promotions.
2. **Load the rules**: `docs/POLICIES.md`, the relevant parts of `docs/CONTEXT.md`, any ADR
   the change touches, and the active profile's stack rules file. You are reviewing against
   the project's rules, not your personal preferences — a finding you cannot tie to a rule
   or a defect is a *suggestion*, and must be labelled as one.
3. **CI status.** Failing checks are the author's to fix; note it and do not spend review
   effort on what CI already caught.
4. **Read the change folder** if one exists: `proposal.md` for the acceptance criteria,
   `design.md` for the intended approach. Review against what was agreed, not against how
   you would have built it.

## Phase 1 — the openspec state check

This is state-aware, and the states mean different things:

| State | Verdict |
| ----- | ------- |
| Change active in `openspec/changes/<slug>/`, all tasks checked | ✅ correct |
| Change active, **open `- [ ]` tasks remain** | **blocker** — the work is not finished |
| Task file has no checkboxes at all | **blocker** — the completeness gate cannot see anything, so its silence means nothing |
| Change already in `openspec/specs/` before merge | **major** — archived too early; the spec says done while the code is unmerged |
| No change folder inferable | fine — that is the `/abet-fix` bug lane |

Infer the slug from the PR's head branch. Do not treat a missing change folder as a
finding on its own; a one-shot defect legitimately skips it. Do treat a *multi-step* change
with no folder — one with a migration, a contract change, or work across several layers —
as a **major**.

## Phase 2 — four lenses, dispatched in parallel

Send them together. Each returns findings as
`{severity, file, line, what, why, fix}`.

**Security** — run the native `/security-review` over the diff.

**Correctness** — does it do what `proposal.md` says? Walk the acceptance criteria one at
a time and find the code that satisfies each. Missing edge cases, wrong conditions, error
paths that swallow failures, off-by-one, null handling. State explicitly which ACs you
could *not* trace to code.

**Rules and architecture** — conformance to `docs/POLICIES.md` and the profile's stack
rules: layering and boundaries, naming, i18n keys instead of raw text, validation in the
right layer, scope headers read from headers only, response shape. Plus documentation
currency: if the diff changes a domain term, business rule or integration that
`docs/CONTEXT.md` states differently, **the diff wins** and the stale line is a finding.

**Runtime and tests** — the things invisible in a single file. N+1 queries, unbounded
result sets, anything quadratic over data that grows with enrolment, concurrency and
transaction boundaries, scope lost on an async or cached path, client lifecycle. On the
test side: do the tests assert the acceptance criteria or merely that the code does what it
does? Any fixture default that makes the condition under test a no-op? Was anything
observed failing before the fix?

Instruct every lens: **only report what is in this diff.** Pre-existing problems in
untouched code bury the findings that matter. If something adjacent is genuinely alarming,
raise it once, separately, marked as out of scope.

## Phase 3 — cross-repo checks

If the PR is the **frontend** side of a cross-repo change:

- Has the backend reached the `staging` branch? Verify remotely with
  `/abet-verify-contract`. If it has not, merging this is premature — **blocker**.
- Do the types match the backend's committed `openapi.json`? A renamed field compiles fine
  and fails at runtime.

If the PR is the **backend** side and it touched a route, DTO or response shape:

- Was `openapi.json` regenerated and committed in the same PR? If not, **blocker** — the
  frontend reads that file and will be wrong.
- Read the spec diff as a contract change. A retyped field is breaking even when nothing in
  this repo fails to compile.

## Phase 4 — synthesise

One table, ordered by severity:

| Severity | Meaning |
| -------- | ------- |
| **blocker** | Must change before merge. Correctness, security, a violated policy, unfinished work. |
| **major** | Should change. Real problem, but arguably shippable if the author disagrees with reason. |
| **minor** | Worth fixing, not worth blocking on. |
| **suggestion** | Preference. Explicitly optional — say so, so the author can decline without friction. |

Each finding: **What** (one sentence), **Why** (the rule or the failure mode — not "I
prefer"), **Fix** (concrete, so the author is not left guessing).

Then a verdict — **approve**, **approve with comments**, or **request changes** — and a
short **what I checked and found clean** list. A review that only lists problems tells the
author nothing about coverage, and makes a light review look identical to a thorough one.

## How to write it

- Review the code, never the person. "This query runs per row" not "you wrote an N+1".
- Distinguish rules from taste. If you cannot cite a policy, an ADR, or a concrete failure,
  it is a suggestion.
- Do not re-litigate decisions the proposal or an ADR already settled. If you disagree with
  a settled decision, that is a separate conversation, not a PR comment.
- Ask when you do not understand something, rather than asserting it is wrong. Half of
  "this looks wrong" turns out to be missing context — and the answer usually belongs in
  `docs/CONTEXT.md`.
- Praise is information too. Say what was done well; it tells the author what to repeat.

## Phase 5 — show, then post

Render the complete review and **wait for explicit approval**. Nothing is posted to GitHub
until you say so — no comments, no approval, no change request.

Once approved:

```bash
gh pr review <number> --comment --body-file <file>          # or --approve / --request-changes
```

Confirm the active GitHub account first (`gh auth status`) — a review posted from the wrong
identity is awkward to retract.

**Never merge.** That is the author's call, after the findings are addressed.
