# ABET pipeline conventions

The single reference every `abet-*` skill works from. When a skill and this file
disagree, this file is wrong and should be fixed — do not resolve it silently.

## The change folder

A **change** is a directory. There is no CLI and no config; skills detect a change by
testing whether its directory exists.

```
openspec/
├── changes/            in flight — one directory per change
│   └── <slug>/
│       ├── proposal.md     the ticket: problem, ACs, scope
│       ├── design.md       how it will be built, incl. the ADR gate
│       ├── tasks.md        the working plan and the record of what happened
│       └── runbook.md      (when needed) manual validation + operational steps
└── specs/              archived record — append-only, moved here after merge
```

`specs/` is a historical record of change folders, not a set of canonical capability
specs. There is no ADDED/MODIFIED/REMOVED delta merge.

## Slugs and branches

There is no ticket system. The **slug is the identifier**: plain kebab-case, 3–6 words,
naming the change rather than the action.

```
bulk-edit-rubric-weights
gra-report-is-active-filter
ifc-finding-attachment-limits
```

Branches carry the slug so it can be inferred from `git branch --show-current`:

| Branch                                   | Slug                        |
| ---------------------------------------- | --------------------------- |
| `feat/bulk-edit-rubric-weights`          | `bulk-edit-rubric-weights`  |
| `fix/gra-report-is-active-filter`        | `gra-report-is-active-filter` |
| `chore/archive-bulk-edit-rubric-weights` | `bulk-edit-rubric-weights`  |

**Slug inference**, used by every skill that needs the current change:

1. `git branch --show-current`, strip the `<type>/` prefix and any leading `archive-`.
2. If `openspec/changes/<slug>/` exists, that is the change.
3. Otherwise, if `openspec/changes/` holds exactly one directory, use it.
4. Otherwise ask. Never guess between candidates.

When Jira arrives, prefix slugs with the key (`ABC-123-bulk-edit-rubric-weights`) and
step 1 keeps working unchanged. Nothing else in the pipeline needs to move.

## The task checkbox rule

`tasks.md` uses readable headings **and** machine-checkable boxes. Every task block
carries its own checkbox:

```markdown
### Task 2.3 — Add the bulk-weight endpoint

- [ ] Task complete

**Files**
- `src/modules/evaluation/rubrics/api/rubrics.controller.ts` (modify)
- `src/modules/evaluation/rubrics/rubrics.service.spec.ts` (test)

**Steps (TDD)**
1. Write the failing spec: `pnpm test -- rubrics.service.spec` → expect red.
2. Implement `bulkUpdateWeights` in the service.
3. Re-run → expect green.

**Commit**: `feat(rubrics): add bulk weight editing endpoint`
```

Headings alone are not enough. The completeness gate is literally
`grep -c '^- \[ \]' openspec/changes/<slug>/tasks*.md` — a file with only
`### Task N.N … ✅ DONE` headings reports zero open tasks whether or not any work was
done, so the gate silently passes. Marking a task done means checking its box **and**
appending `✅ DONE (YYYY-MM-DD)` to the heading, never one without the other.

## Cross-repo changes

The backend and frontend live in **separate repositories**. A change touching both gets
the **same slug in both repos**, and each repo carries a change folder:

```
<backend>/openspec/changes/<slug>/     <frontend>/openspec/changes/<slug>/
├── proposal.md   ← identical ─────────┤ proposal.md
├── contract.md   ← identical ─────────┤ contract.md     (parallel mode only)
├── design.md       backend's side     │ design.md         frontend's side
└── tasks.md        backend's tasks    └ tasks.md          frontend's tasks
```

`proposal.md` and `contract.md` are **identical copies**: they are the shared agreement,
settled once at design time and rarely edited. `design.md` and `tasks.md` hold only that
repo's own side, so they can change through review rounds without having to be kept in
sync across two repositories.

Duplicating the proposal is deliberate. A developer working in one repo must be able to
read the whole story without checking out the other one.

### Two modes — decide per change, at design time

| | **Sequential** | **Parallel** |
| --- | --- | --- |
| When | One person does the backend, merges it, then does the frontend | Two people, or the frontend must start before the backend lands |
| `contract.md` | **Not created.** `openapi.json` is the contract | **Required**, agreed before either side writes code |
| Frontend codes against | The real committed spec | `contract.md`, then reconciles against the spec |

Sequential is the lower-ceremony default and is usually correct. Only write a
`contract.md` when the frontend genuinely cannot wait for the backend — otherwise it is a
second source of truth that will drift.

### The generated spec is the source of truth

The backend commits `openapi.json`, generated from its Swagger decorators
(`pnpm openapi:export`). It ships **in the same PR** as the endpoints it describes.

`contract.md` is a design-time *agreement*, not a record. Once the backend is
implemented, **the generated spec wins** — the same rule as "the diff wins" for docs. If
they disagree, correct `contract.md` with a dated append and say why.

This is what makes the contract checkable rather than aspirational: a renamed field shows
up as a line in the backend PR's diff, instead of surfacing as a runtime error in the
frontend three days later.

### The repos verify each other remotely, never through the filesystem

The two repositories — and the two profile plugins — are **independent**. Neither reads
the other from disk, and `abet-frontend` does not require `abet-backend` to be installed.

The frontend confirms how far the backend has got by fetching its published spec with
`gh api` at each branch in the promotion chain (`/abet-verify-contract`). A 404 is a clean
"not there yet". No running environment is involved — it is a branch check, so it needs no
deployed backend and no credentials beyond `gh`.

Reading a colleague's working tree is not evidence. It may be on any branch, with
uncommitted work, describing endpoints that exist nowhere — and the result cannot be
reproduced on another machine or in CI. Whatever version was consulted is recorded as a
spec SHA in the PR body, so review can answer *which contract this was built against*.

### Sequencing — the one ordering rule

**The backend change reaches the `staging` branch before the frontend PR merges.**

Promotion is `develop → staging → production`, fast-forward only, so the branch a change
sits on says how far it has travelled. Requiring the backend to be on `staging` first
guarantees it leads the frontend through the chain — frontend code can never reach
production ahead of the API it calls.

`merged` and `promoted` are different states, and only the second satisfies this rule.
Note that `staging` is a **branch, not a running environment**: today only `production` is
actually deployed. Being on `staging` proves the code is promoted and queued for release,
not that anything responds. Runtime verification happens against a locally-run backend, or
against production once released.

The frontend may be *developed* in parallel throughout; it just may not merge ahead of the
API it depends on.

Archiving follows the same order: two archive PRs, one per repo, and the frontend's only
after both feature PRs have merged.

## Documentation

| File               | Holds                                                       | Written by            |
| ------------------ | ----------------------------------------------------------- | --------------------- |
| `docs/POLICIES.md` | Mandatory rules — the things you can violate                 | Humans. Never a skill. |
| `docs/CONTEXT.md`  | Descriptive map — stack, structure, vocabulary, business rules | `/abet-implement`, `/abet-audit-pr` flag staleness |
| `docs/adr/`        | One numbered, immutable decision per file                    | `/abet-adr` only      |
| `AGENTS.md`        | Pointer stub to the three above                              | Rarely                |

`docs/POLICIES.md` is read-only to every skill. If a change needs a policy altered,
that is a conversation with the team, not an edit.

## Git

- Base branch for every PR: **`develop`**. Promotion is `develop → staging → production`,
  fast-forward only.
- Commits are **subject-only**, single line, Conventional Commits. No body, no trailers.
- `--no-verify` is never used.
- Force pushes use `--force-with-lease`.
- **No skill commits on its own.** Skills propose a commit grouping and stop.

## Where each skill fits

```
FEATURE
  /abet-define-task    request → proposal.md (the ticket)
      ↓
  /abet-design-feature proposal → design.md + tasks.md   ←→ /abet-adr
      ↓
  /abet-implement      execute tasks.md in checkpointed batches
      ↓
  /abet-audit-pr       6 parallel auditors → severity-ranked verdict
      ↓
  /abet-create-pr      gh pr create → develop
      ↓
  /abet-address-review triage review comments → one new commit
      ↓                ←→ /abet-review-pr  (the reviewer's side, on someone else's PR)
      ↓
  /abet-archive        git mv changes/ → specs/ via its own chore PR

BUG
  /abet-fix            reproduce → root cause → regression test → minimal fix
      ↓                (no change folder, no design, no archive)
  /abet-audit-pr → /abet-create-pr
```

The gate between the two lanes is **multi-step, not feature-vs-bug**. A one-shot defect
goes through `/abet-fix`. A fix that needs a migration, a contract change, or more than
a couple of coordinated edits gets a full change folder.
