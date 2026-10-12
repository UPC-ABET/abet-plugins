---
name: abet-archive
description: "Post-merge bookkeeping. Verifies the feature PR actually merged, harvests the change's lasting behaviour into openspec/specs/<capability>/spec.md (shown and approved before anything is committed), then moves openspec/changes/<slug> to openspec/changes/archive/<slug> with git mv — spec updates and move together on one chore branch and one chore PR, because develop is protected. Finishes with local branch cleanup. Cost: medium — one reading pass over the change to harvest it."
---

# Archive a merged change

Archiving does two things, in this order, in one chore PR:

1. **Harvest** — fold what the change made true into the current-truth capability specs,
   `openspec/specs/<capability>/spec.md`.
2. **Move** — `git mv openspec/changes/<slug> openspec/changes/archive/<slug>`, where it is
   never edited again.

Both happen only after the feature PR is merged. The move is itself a real change to the
repository, so it goes through a pull request like everything else — `develop` is
protected and nothing is pushed to it directly.

The layout is in `plugins/abet-common/reference/conventions.md`. This skill always writes
that layout, even in a repo that still keeps archived changes in the legacy
`openspec/specs/<slug>/`: leave the legacy folders where they are (migrating them is its
own change, not part of this PR), and create `openspec/changes/archive/` and the first
capability specs alongside them.

## Preconditions

1. Resolve `<slug>` from the branch you were working on, or ask.
2. `openspec/changes/<slug>/` exists and `<slug>` is not `archive`. If the folder is already
   at `openspec/changes/archive/<slug>/` (or legacy `openspec/specs/<slug>/`), it has been
   archived — say so and stop.
3. **The feature PR is merged.** Verify it, do not assume:
   ```bash
   gh pr list --state merged --search "<slug>" --json number,title,mergedAt,mergeCommit
   ```
   If it is open, closed-unmerged, or you cannot find it — **stop**. Archiving an
   unmerged change writes into the current-truth specs behaviour the code does not have,
   which is exactly backwards.
4. Tasks are complete: no `- [ ]` remaining in `tasks*.md` (both `## Backend` and
   `## Frontend` sections, when the change touched both packages).
5. **One change folder, one archive.** Backend and frontend are packages in this repo, not
   separate repos, so there is exactly one `openspec/changes/<slug>/` to move and one
   `chore/archive-<slug>` branch and PR — never a per-package archive.

## Steps

### 1. Start from a fresh develop

```bash
git checkout develop
git fetch origin
git pull --ff-only origin develop
git checkout -b chore/archive-<slug>
```

Confirm the merge commit for the feature PR is actually in this `develop` before moving on.

### 2. Harvest into the capability specs — before the move

The change folder explains how the work went; the capability spec says what is true now.
This step carries the second out of the first. Do it while the folder is still at
`openspec/changes/<slug>/`, so nothing about the move is mixed into the reading.

#### 2a. Decide which capabilities are affected

Read the `**Specs affected**:` line in `proposal.md`.

- **Capability names** — those are the specs to create or update. Check each against the
  existing folders (`ls openspec/specs/`), and if a name has no folder, check it is not a
  near-duplicate of one that exists before creating it.
- **`none`** — check that claim against the merged diff. If the change plainly altered
  behaviour a spec describes (or should), say so and confirm with the user before skipping.
- **Missing** (older proposals predate the line) — work it out: read `design.md` and the
  merged diff (`gh pr diff <number>` for the feature PR), list the existing capability
  folders, and propose the mapping — which existing capability each behaviour belongs to,
  and any new capability with its proposed kebab-case name. **Confirm the list with the
  user before writing anything.**

Reuse an existing capability whenever one fits. A capability is named for what the system
does (`surveys-lcfc`, `reports-rc-rv`, `academic-periods`), never for a change or a ticket.

#### 2b. Create or update each `openspec/specs/<capability>/spec.md`

For a new capability, start from `plugins/abet-common/templates/spec.md` and keep its five
sections: Purpose / Behaviour / Rules & invariants / Known edge cases / References. For an
existing one, read it in full first.

Read the sources: `proposal.md` (ACs, scope extensions), `design.md`, `tasks*.md` (the
unplanned, post-QA, audit-fix and review-round sections are where edge cases surface),
`runbook.md` (its data-validation checks are often invariants), and the merged diff. Where
the proposal and the merged code disagree, **the code wins** — the spec describes what
shipped, not what was planned.

Merge in **only lasting behaviour**:

| Goes in | Stays out |
| ------- | --------- |
| What the capability does, as observable behaviour | Task lists, checkboxes, retros |
| Business rules and invariants | How the work went, who did what, in which PR |
| Data-validity conditions (what makes a row valid, what must never coexist) | Debugging narratives, query output, stack traces |
| Edge cases that caused bugs, or look wrong and are deliberate | Implementation detail the code already states plainly |
| | Anything that is true only of one environment or one deploy |

Edit, do not append:

- When the change **supersedes** a statement, rewrite that statement in place. Do not leave
  the old one with "previously…" or add a dated section — the history is in the archived
  change, and the link is how a reader gets to it.
- When the change **removes** a behaviour, delete its line.
- Every rule and every edge case links to where it was decided:
  `openspec/changes/archive/<slug>/` (the path the folder is about to have) and the ADR, if
  there is one. A line with no link is a claim nobody can check.
- Update **Last updated by** to this change and today's date.

Keep it short. A spec that grows a paragraph per change is turning back into a history; if
a section runs past a screen, look for statements a later change made redundant.

#### 2c. Route what does not belong in a capability spec

- **A rule for the whole repo or a whole package** (a convention every module must follow,
  not a behaviour of this capability) does not go in a spec. Draft the exact line for
  `docs/POLICIES.md`, or the package's `backend/docs/POLICIES.md` / `frontend/docs/POLICIES.md`
  / `AGENTS.md`, and present it separately in 2d. Write it **only if the user explicitly
  approves that line** — policies are the team's rulebook, and approving the spec diff is not
  approving a policy change.
- **A hard-to-reverse decision with no ADR** (a datastore or schema shape, a public
  contract, a module boundary — the ADR-gate triggers) is flagged to the user with a
  suggestion to run `/abet-adr`. Do not write the decision into a spec as if it were
  settled, and do not write the ADR yourself.

#### 2d. Show the diff and wait for approval

Stage nothing yet. Show the user:

- The full diff for every spec touched: `git diff -- openspec/specs`, plus the complete
  content of any new `spec.md` (new files do not show in `git diff`).
- Any drafted `POLICIES.md` / `AGENTS.md` line, separately, marked as needing its own yes.
- Any decision flagged for `/abet-adr`.
- The capabilities you decided *not* to touch, and why, when the proposal named them.

Then **stop and wait for explicit approval**. Apply the user's corrections and show the diff
again until it is approved. Nothing is committed, moved or pushed before that.

### 3. Move the folder with git mv

```bash
mkdir -p openspec/changes/archive
git mv openspec/changes/<slug> openspec/changes/archive/<slug>
```

`git mv`, not copy-and-delete — it preserves history. The move must be **pure renames**:
check `git diff --cached -M --stat -- openspec/changes` shows files renamed with zero
insertions and zero deletions. If the moved folder shows content changes, something was
edited along the way; stop and separate it. The archived folder is never edited again,
including by this skill.

### 4. Check for stale references

Before committing, grep for anything that still points at the change as in-flight:

```bash
grep -rn "changes/<slug>" --include="*.md" . | grep -v "changes/archive/<slug>"
```

The usual offender is a line in root `docs/CONTEXT.md`, `backend/docs/CONTEXT.md` or
`frontend/docs/CONTEXT.md` naming the in-flight change. Fix it here — the
docs-ship-with-the-change rule applies to the archive PR too, and a stale "one change in
flight" line is exactly the kind of rot that makes people stop trusting the file. Show any
such fix to the user alongside the spec diff.

### 5. Commit and open the chore PR

Two commits, so the move stays a reviewable pure rename:

```
docs(specs): update <capability>[, <capability>] from <slug>
chore(openspec): archive <slug>
```

The first carries the spec updates, any approved policy line and any stale-reference fix;
the second carries only the `git mv`. When the harvest touched nothing (2a ended in a
confirmed `none`), there is only the second. Then:

```bash
git push -u origin chore/archive-<slug>
gh pr create --base develop --title "chore(openspec): archive <slug>" --body-file <file>
```

Body: which PR merged, what moved, which capability specs were created or updated (one line
each, saying what changed in them), any policy line added, and any decision flagged for an
ADR. This PR should stay easy to review — keep it that way.

Show the PR before creating it, as always.

### 6. Wait for it to merge

Do not proceed to cleanup until the chore PR is merged. Report the URL and stop if it is
still open.

### 7. Clean up locally

Once the archive PR is merged:

```bash
git checkout develop
git pull --ff-only origin develop
git branch -d <feature-branch>
git branch -d chore/archive-<slug>
git fetch --prune
```

Use `-d`, not `-D`. If git refuses because the branch is not merged, that is information
— find out why before forcing it.

### 8. Report

What moved, which specs changed, the two PR numbers, what was cleaned up, and anything that
still needs a human — a deploy step from `runbook.md` that has not run yet, a policy line
the user deferred, or a decision waiting on `/abet-adr`.
