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
- `backend/src/modules/evaluation/rubrics/api/rubrics.controller.ts` (modify)
- `backend/src/modules/evaluation/rubrics/rubrics.service.spec.ts` (test)

**Steps (TDD)**
1. Write the failing spec: `pnpm --filter ./backend test -- rubrics.service.spec` → expect red.
2. Implement `bulkUpdateWeights` in the service.
3. Re-run → expect green.

**Commit**: `feat(rubrics): add bulk weight editing endpoint`
```

Headings alone are not enough. The completeness gate is literally
`grep -c '^- \[ \]' openspec/changes/<slug>/tasks*.md` — a file with only
`### Task N.N … ✅ DONE` headings reports zero open tasks whether or not any work was
done, so the gate silently passes. Marking a task done means checking its box **and**
appending `✅ DONE (YYYY-MM-DD)` to the heading, never one without the other.

## Changes spanning backend and frontend

Backend (`backend/`, NestJS + TypeORM) and frontend (`frontend/`, Next.js) are **packages
in one pnpm workspace repository** (`ACC-SYS`), not separate repos. A change touching both
still gets **one** change folder at the repo root — there is nothing left to duplicate:

```
openspec/changes/<slug>/
├── proposal.md     "Packages affected: backend | frontend | both" (mandatory line)
├── contract.md     optional — see below
├── design.md       ## Backend and ## Frontend H2 sections in the same file
└── tasks.md        ## Backend and ## Frontend H2 sections in the same file
```

When `proposal.md` says `both`, `design.md` and `tasks.md` hold both sides as `## Backend`
and `## Frontend` sections in the **same file**, not two files. The completeness gate is
unchanged: `grep -c '^- \[ \]' openspec/changes/<slug>/tasks*.md` counts every checkbox in
the file regardless of which H2 section it sits under.

### Contract: optional, for parallel work only

| | **Sequential** (default) | **Parallel** |
| --- | --- | --- |
| When | One person does the backend, then the frontend, usually one PR | Two people, or the frontend starts before the backend code exists |
| `contract.md` | **Not created.** `backend/openapi.json` on disk at HEAD is the contract | **Optional**, one copy, agreed before either side writes code |
| Frontend codes against | `backend/openapi.json` directly, same working tree | `contract.md`, then reconciles against the spec once it exists |

Sequential is the lower-ceremony default and is usually correct. `contract.md` earns its
keep only when two people are working in parallel and the frontend genuinely cannot wait
— otherwise it is a second source of truth that will drift.

### The generated spec is the source of truth

`backend/openapi.json` is committed and regenerated from the Swagger decorators
(`pnpm --filter ./backend openapi:export`) **in the same PR** as any route, DTO or
response-shape change it describes.

`contract.md`, when it exists, is a design-time *agreement*, not a record. Once the
backend is implemented, **the generated spec wins** — the same rule as "the diff wins" for
docs. If they disagree, correct `contract.md` with a dated append and say why.

This is what makes the contract checkable rather than aspirational: a renamed field shows
up as a line in the backend commit's diff, instead of surfacing as a runtime error in the
frontend three days later.

### The frontend checks the spec in the same tree — no remote fetch

Both packages sit in the **same working tree**, so `/abet-verify-contract` is a local,
same-tree check: it enumerates the endpoints the frontend calls
(`apiGet`/`apiPost`/`apiPut`/`apiPatch`/`apiDelete`/`apiPostBlob` call sites under
`frontend/src`), normalises path params, and confirms each exists in
`backend/openapi.json` at HEAD. On a PR branch it also diffs the spec against the
merge-base with `develop` to list added, removed and renamed operations. There is no
`gh api` call and no other repository to stay independent from.

### Sequencing

The default is **one PR carrying both packages**. If a change is deliberately split into
two PRs, the backend PR merges into `develop` **first** — but nothing requires it to reach
`staging` before the frontend PR merges. `staging` is a real deployed environment
(https://accreditation-stg.tcupc.pe), where runtime verification happens before promoting
to `production` (https://accreditation.tcupc.pe); it is not a merge gate.

Archiving is **one chore PR**: `git mv openspec/changes/<slug> openspec/specs/<slug>`
moves the whole folder — both packages' sides — at once.

## Documentation

Two layers. Root docs hold cross-cutting rules and topology; each package holds its own
stack-specific rules and map. Every skill reads the **root** docs plus the docs of
**every package the change touches**.

| File | Holds | Written by |
| ---- | ----- | ---------- |
| `docs/POLICIES.md` | Repo-wide mandatory rules — git, branches, PR base, promotion, openspec location, CI gates, env/secrets handling | Humans. Never a skill. |
| `docs/CONTEXT.md` | Repo-wide topology — server, environments, ports, RDS, deploy pipeline, CI | `/abet-implement`, `/abet-audit-pr` flag staleness |
| `docs/adr/` | Cross-cutting decisions, one numbered immutable file each | `/abet-adr` only |
| `backend/docs/POLICIES.md` | Backend's mandatory rules — naming, module layout, validation pattern, response format | Humans. Never a skill. |
| `backend/docs/CONTEXT.md` | Backend's descriptive map — stack, structure, vocabulary, business rules | `/abet-implement`, `/abet-audit-pr` flag staleness |
| `backend/docs/adr/` | Backend-only decisions | `/abet-adr` only |
| `frontend/docs/POLICIES.md` | Frontend's mandatory rules | Humans. Never a skill. |
| `frontend/docs/CONTEXT.md` | Frontend's descriptive map | `/abet-implement`, `/abet-audit-pr` flag staleness |
| `frontend/docs/adr/` | Frontend-only decisions | `/abet-adr` only |
| `AGENTS.md` (root, `backend/`, `frontend/`) | Pointer stub to that level's docs | Rarely |

`docs/POLICIES.md` at any level is read-only to every skill. If a change needs a policy
altered, that is a conversation with the team, not an edit.

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
