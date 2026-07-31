---
name: abet-create-pr
description: Open the pull request against develop with a fully-filled body, linking the openspec change. Verifies the audit passed, the tasks are complete, and the right GitHub account is active. Shows the rendered PR and waits for explicit approval before creating it.
---

# Create the pull request

Fills the PR with actual content and opens it against `develop`. Nothing here is
autonomous: the fully-rendered PR is shown first and created only after you say yes.

## Preconditions — check all of these before drafting

1. **Not on a protected branch.** `git branch --show-current` must not be `develop`,
   `staging` or `production`.
2. **The audit ran and passed.** If `/abet-audit-pr` has not run on the current HEAD,
   run it first. Opening a PR that the author has not audited wastes the reviewer.
3. **Tasks complete** (when a change folder exists):
   `grep -c '^- \[ \]' openspec/changes/<slug>/tasks*.md` must be zero, and there must be
   at least one `- [x]`. Open tasks mean the change is not done.
4. **Everything is committed.** `git status --porcelain` must be empty. If it is not,
   propose the commits and stop — this skill does not commit for you.
5. **Branch is pushed.** `git push -u origin <branch>`. If the branch has been rebased,
   use `--force-with-lease`; the push guard blocks bare `--force`.
6. **The right GitHub account is active.** Run `gh auth status`. If `CLAUDE.md` or
   `docs/POLICIES.md` pins an account for outward-facing GitHub actions, and the active
   account is not it, switch first: `gh auth switch --user <account>`. Getting this wrong
   attributes the PR to the wrong identity and is tedious to undo.
7. **Cross-repo ordering** — if this is the **frontend** side of a cross-repo change:
   the backend change must have reached the **`staging` branch** before this PR merges.
   Verify it remotely with `/abet-verify-contract`; never by looking for the backend on
   the local filesystem. If it is only on `develop`, say so: open the PR if you like, but
   flag in the body that it is blocked on the backend being promoted. Merging frontend
   code ahead of the API it calls lets it reach production first.
   Put the verified spec SHA in the PR body.
8. **The spec ships with the endpoints** — if this is the **backend** side and the change
   altered any route, DTO or response shape, `openapi.json` must be regenerated
   (`pnpm openapi:export`) and committed in this PR. A spec that lags the endpoints is
   worse than no spec, because the frontend trusts it.

## Steps

### 1. Gather the material

- `git log origin/develop..HEAD --oneline` — the commits.
- `git diff --stat origin/develop...HEAD` — size and shape.
- `openspec/changes/<slug>/proposal.md` — the ACs and the traceability table.
- `openspec/changes/<slug>/runbook.md` — if it exists, its deploy prerequisites go in
  the PR body where a reviewer cannot miss them.
- The `/abet-audit-pr` verdict.

### 2. Check the size

If the diff exceeds ~500 changed lines or ~10 files, say so and propose a split before
drafting: which commits could go in a first PR that stands alone, and what would follow.

A large PR is sometimes correct — a vertical slice with its migration, endpoint, tests
and docs is legitimately wide. Make the recommendation, explain the trade-off, and let
the author decide. Do not refuse to proceed.

### 3. Draft the body

Use the repository's PR template if `.github/pull_request_template.md` exists; otherwise:

```markdown
## What

One paragraph: what this change does, in the reader's terms.

## Why

The problem from proposal.md. Link the openspec change: `openspec/changes/<slug>/`.

## Acceptance criteria

| AC | Criterion | Satisfied by |
| -- | --------- | ------------ |
| 1  | ...       | `src/...`    |

## How it was tested

Automated: which suites, what they cover.
Manual: from runbook.md, if there is one.

## Deploy notes

Migrations, seeds, permission syncs, feature flags, or "none".
Lead with anything that must be run by hand.

## Risks and follow-ups

Known limitations, deferred minors from the audit, anything a reviewer should look at
hardest.
```

**No placeholder text may survive.** An unfilled template section is worse than an
absent one — it looks answered. If a section genuinely does not apply, write "None" and
say why, or delete it.

The title is the PR's Conventional Commit subject: `feat(rubrics): add bulk weight
editing`. Single line, under 72 characters.

### 4. Show it and wait

Render the complete PR — title, base, head, full body — and ask for explicit approval.
Do not create it on implied consent. "Looks good" is approval; silence is not.

### 5. Create it

```bash
gh pr create --base develop --head <branch> --title "<title>" --body-file <file>
```

Write the body to a temp file rather than passing it inline; multi-line `--body` through
a shell is a reliable source of mangled markdown.

Report the PR URL.

### 6. Stop

Do not merge. Do not request reviewers unless asked. Do not archive the change — that
happens after merge, through `/abet-archive`.
