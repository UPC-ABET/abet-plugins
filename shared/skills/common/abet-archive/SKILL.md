---
name: abet-archive
description: Post-merge bookkeeping. Verifies the feature PR actually merged, then moves openspec/changes/<slug> to openspec/specs/<slug> with git mv on its own chore branch and opens a small chore PR, because develop is protected. Finishes with local branch cleanup. Cost: light.
---

# Archive a merged change

The change folder moves from `changes/` to `specs/` only after the feature PR is merged.
The move is itself a real change to the repository, so it goes through a pull request
like everything else — `develop` is protected and nothing is pushed to it directly.

## Preconditions

1. Resolve `<slug>` from the branch you were working on, or ask.
2. `openspec/changes/<slug>/` exists.
3. **The feature PR is merged.** Verify it, do not assume:
   ```bash
   gh pr list --state merged --search "<slug>" --json number,title,mergedAt,mergeCommit
   ```
   If it is open, closed-unmerged, or you cannot find it — **stop**. Archiving an
   unmerged change puts the spec in `specs/` while the code does not exist, which is
   exactly backwards.
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

### 2. Move the folder with git mv

```bash
git mv openspec/changes/<slug> openspec/specs/<slug>
```

`git mv`, not copy-and-delete — it preserves history, and the resulting PR should show
as pure renames: files changed, **zero insertions, zero deletions**. If the diff shows
content changes, something has been edited along the way; stop and separate it.

### 3. Check for stale references

Before committing, grep for anything that still points at the change as in-flight:

```bash
grep -rn "changes/<slug>" --include="*.md" .
```

The usual offender is a line in root `docs/CONTEXT.md`, `backend/docs/CONTEXT.md` or
`frontend/docs/CONTEXT.md` naming the in-flight change. Fix it here — the
docs-ship-with-the-change rule applies to the archive PR too, and a stale "one change in
flight" line is exactly the kind of rot that makes people stop trusting the file.

If you do fix a doc line, the PR is no longer a pure rename. That is fine and correct;
just say so in the PR body.

### 4. Commit and open the chore PR

```
chore(openspec): archive <slug>
```

Exactly that subject. Then:

```bash
git push -u origin chore/archive-<slug>
gh pr create --base develop --title "chore(openspec): archive <slug>" --body-file <file>
```

Body: one line saying which PR merged and what moved. This PR is meant to be trivial to
review — keep it that way.

Show the PR before creating it, as always.

### 5. Wait for it to merge

Do not proceed to cleanup until the chore PR is merged. Report the URL and stop if it is
still open.

### 6. Clean up locally

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

### 7. Report

What moved, the two PR numbers, what was cleaned up, and anything that still needs a
human — a deploy step from `runbook.md` that has not run yet, for instance.
