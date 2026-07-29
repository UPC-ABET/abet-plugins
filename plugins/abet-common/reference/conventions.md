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

`BACK-ACREDITACION-3.0` and `FRONT-ACREDITACION-3.0` are **separate repositories**.
A change touching both is genuinely cross-repo:

```
openspec/changes/<slug>/
├── proposal.md
├── design.md
├── contract.yml        the API contract, agreed before either side starts
├── tasks.md            index pointing at the two below
├── tasks-back.md
└── tasks-front.md
```

The change folder lives in **both** repos, identical, and each side works its own
`tasks-*.md`. `contract.yml` is written first and neither side deviates from it without
updating it in both repos. A single-repo change uses one `tasks.md` and no contract.

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
