---
name: abet-address-review
description: Work through review feedback on your own PR. Triages every comment into defect, improvement, product decision or working-as-intended before touching code, escalates anything that would reverse a prior decision, and lands exactly one new commit on top so the reviewer can see what changed.
---

# Address review feedback

Triage first, code second. The most expensive mistake here is implementing a comment
that quietly reverses a decision someone made deliberately.

## Preconditions

You are the PR author, on the PR's branch. Fetch the feedback read-only:

```bash
gh pr view <number> --json title,body,reviews,comments
gh api repos/{owner}/{repo}/pulls/<number>/comments   # inline review comments
```

## Steps

### 1. Triage every comment before changing anything

Put each comment in exactly one bucket. Do this for **all** of them first — batching the
triage is what surfaces contradictions between reviewers.

| Bucket | Meaning | What you do |
| --- | --- | --- |
| **Defect** | The code is wrong. Bug, missing case, broken contract. | Fix it, with a regression test. |
| **Improvement** | The code works; the reviewer wants it better. Naming, structure, clarity. | Apply it if reasonable. If you disagree, say why. |
| **Product / design decision** | Answering it means deciding what the product should do, or reversing a prior decision. | **Escalate. Do not implement.** |
| **Working as intended** | The reviewer misread it, or the behaviour is deliberate. | Explain, with a pointer to the ADR, policy or proposal that establishes it. |

The third bucket is the reason this skill exists.

A comment belongs there when implementing it would: contradict an accepted ADR, change
behaviour the proposal explicitly scoped in or out, alter an API contract the frontend
already consumes, or reverse something a previous PR deliberately changed. Check
`git log` and the relevant `docs/adr/`, `backend/docs/adr/` or `frontend/docs/adr/` before
assuming a reviewer's suggestion is simply an improvement — the "obvious" fix has
sometimes already been tried and reverted for a reason that is not visible in the diff.

For these, reply with the context and ask the reviewer to decide. Do not implement and
do not silently decline.

### 2. Show the triage

Before writing code, present the table: every comment, its bucket, and your intended
action. Anything in the escalation bucket is called out explicitly.

This is a checkpoint. Wait for agreement on the escalated items.

### 3. Fix the defects properly

Each defect gets the same treatment as `/abet-fix`: reproduce it, find the root cause,
write a regression test that fails first, then apply the minimal fix.

A review comment is not a reason to skip the regression test. If the reviewer found it,
the test suite did not — that gap is the actual finding.

### 4. Record it in the change

Append to `openspec/changes/<slug>/tasks.md` under `### Review round N`, with a task
block and checkbox per item addressed. The change's record should show what review
caught, not just what was planned.

If the review revealed the proposal was wrong about scope, add a dated scope extension
rather than editing the original.

### 5. Land exactly one new commit

**Never amend, never rebase, never force-push over the reviewed commit.** The reviewer
needs to see precisely what changed since they looked. Rewriting the history they
reviewed destroys that, and it is the single most annoying thing an author can do.

One commit on top:

```
fix(rubrics): address PR review — weight bounds and scope filter
```

If the changes are genuinely unrelated, two or three commits is fine. Never fold them
back into the original.

Propose the commit and stop — you do not commit autonomously. Once approved and pushed,
the branch updates the PR.

### 6. Write the summary reply

Part of the deliverable, not an afterthought. One reply covering every comment:

- What you changed, and where.
- What you did not change, and why.
- What you escalated, and what decision you need.

Disagreeing with a reviewer is fine and often correct. Silently ignoring a comment is
not — an unanswered comment stalls the PR and the reviewer has no way to know whether
you missed it or rejected it.

Show the reply and ask before posting. `gh` stays read-only until you approve.
