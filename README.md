# abet-claude-plugins

Claude Code plugins for the UPC-ABET accreditation platform. One marketplace, three plugins.

| | `abet-common` | `abet-backend` | `abet-frontend` |
| --- | --- | --- | --- |
| **Role** | Mandatory base, every repo | Backend profile | Frontend profile |
| **Skills** | 9 pipeline skills | `/abet-migration` | `/abet-module` |
| **Agents** | `code-quality-reviewer` | `api-performance-optimizer` | `ui-performance-optimizer` |
| **Hooks** | 4 git-policy hooks | — | — |
| **Other** | DeepWiki MCP, doc templates | NestJS + TypeORM stack rules | Next.js + TanStack Query stack rules |

Each profile declares `abet-common` as a dependency, so installing a profile pulls the
base in automatically.

## Install

```
/plugin marketplace add UPC-ABET/abet-claude-plugins
/plugin install abet-common@abet-plugins
/plugin install abet-backend@abet-plugins      # in the backend repo
/plugin install abet-frontend@abet-plugins     # in the frontend repo
```

Update later with `/plugin marketplace update`.

To work on the plugins themselves, add the marketplace from a local checkout instead —
`/plugin marketplace add <path-to-this-checkout>`.

Nothing else is required. The plugins ship no permission lists: Claude Code's normal
permission prompts apply, and the hooks below are the actual boundary.

## The pipeline

Everything in `abet-common` serves one delivery pipeline. The unifying artifact is
`openspec/changes/<slug>/`; every skill detects a change by testing whether that
directory exists. There is no OpenSpec CLI — it is a folder convention implemented with
`mkdir`, `Write` and `git mv`.

```
FEATURE
  /abet-define-task    request → proposal.md (the ticket)
      ↓
  /abet-design-feature proposal → design.md + tasks.md    ←→ /abet-adr
      ↓
  /abet-implement      execute tasks.md in checkpointed batches
      ↓
  /abet-audit-pr       6 parallel auditors → severity-ranked verdict
      ↓
  /abet-create-pr      gh pr create → develop
      ↓
  /abet-address-review triage feedback → one new commit on top
      ↓
  /abet-archive        git mv changes/ → specs/ via its own chore PR

BUG
  /abet-fix            reproduce → root cause → regression test → minimal fix
      ↓                (no change folder, no design, no archive)
  /abet-audit-pr → /abet-create-pr
```

The gate between the lanes is **multi-step, not feature-vs-bug**. A one-shot defect goes
through `/abet-fix`; a fix needing a migration or a contract change gets a full change
folder.

Full conventions: [`plugins/abet-common/reference/conventions.md`](plugins/abet-common/reference/conventions.md).

## Design decisions worth knowing

### No ticket IDs — the slug is the identifier

There is no Jira. `/abet-define-task` fills that role and `proposal.md` *is* the ticket.
The slug is plain kebab-case (`bulk-edit-rubric-weights`) and the branch carries it
(`feat/bulk-edit-rubric-weights`), so every skill can infer the change from
`git branch --show-current`.

If a ticket system arrives later, prefix slugs with its key
(`ABC-123-bulk-edit-rubric-weights`) and inference keeps working unchanged. Nothing else
in the pipeline moves.

### Every task carries a checkbox

`tasks.md` uses readable `### Task N.N` headings **and** a `- [ ]` inside each block.

Headings alone break the completeness gate, which is literally
`grep -c '^- \[ \]' tasks*.md`. A file with only `✅ DONE` headings reports zero open
tasks whether or not any work was done, so the gate silently passes and can never raise
its blocker. `/abet-implement` refuses to start against a checkbox-less task file for the
same reason.

### Hooks are Node, not shell

The four PreToolUse hooks are `.mjs`, invoked as
`node "${CLAUDE_PLUGIN_ROOT}/hooks/<name>.mjs"`. No shell, no Git Bash, no `jq`, and no
separate PowerShell variants to keep in sync — the same code runs on macOS and Windows,
and node is already a dependency of every repo here.

Regression suite: `node plugins/abet-common/hooks/test/hooks.test.mjs` — 89 checks.

### The frontend has no test runner

No jest, vitest or playwright. `abet-frontend`'s stack rules tell `/abet-implement` to
substitute typecheck + lint + runbook verification, and tell `/abet-audit-pr` to report
missing coverage as a finding rather than staying quiet because there is nothing to
inspect. Worth closing properly at some point.

## The hooks

| Hook | Behaviour |
| ---- | --------- |
| `push-guard` | **Blocks** pushes to `develop`, `staging`, `production`, and unconditional force pushes. Parses subshells, `bash -c`, `-uf` clusters, `+refspec`, `git -C`/`-c` globals, chained commands. |
| `commit-msg-validator` | **Blocks** non-Conventional-Commit subjects, multi-line messages, trailers, and `--no-verify`. |
| `pre-commit-validator` | **Blocks** on staged secrets, unformatted files, lint problems, type errors, or failing related tests. Warns on divergence from the base branch. |
| `branch-name-validator` | **Warns only.** Never blocks. |

Because these run on the tool call rather than as git hooks, `--no-verify` does not
bypass them — which is the point.

### `--force-with-lease` is allowed

`push-guard` blocks bare `--force` and `-f` but permits `--force-with-lease` and
`--force-if-includes`, because those abort when the remote has moved. That is the correct
form for pushing a rebased branch.

### The release promotion escape hatch

`develop → staging → production` is a legitimate direct push, so `push-guard` honours
`ABET_ALLOW_PROTECTED_PUSH=1`. It relaxes only the protected-branch rule; force pushes
stay blocked regardless.

### `pre-commit-validator` runs the full quality set

Secrets, formatting, lint (with warnings counting as failures), typecheck, and the tests
related to the staged files. Each check is scoped to the staged files where the tool
allows it, so the gate stays fast, and each degrades to a skip when its tool is absent —
which is how the same hook serves a repo with a test runner and one without.

A git-side hook may auto-fix formatting and fixable lint *after* this runs. The gate still
blocks on them: a commit should be clean before it is made, not incidentally repaired on
the way through.

Env switches, all `=1`: `ABET_SKIP_PRECOMMIT`, `ABET_SKIP_FORMAT`, `ABET_SKIP_LINT`,
`ABET_SKIP_TYPECHECK`, `ABET_SKIP_TESTS`, `ABET_FULL_TESTS`.

## Repo layout

```
.claude-plugin/marketplace.json
plugins/
├── abet-common/
│   ├── .claude-plugin/plugin.json
│   ├── .mcp.json                    DeepWiki
│   ├── agents/code-quality-reviewer.md
│   ├── hooks/
│   │   ├── hooks.json
│   │   ├── lib/{shell,hook,branches,toolchain,secrets}.mjs
│   │   ├── {push-guard,commit-msg-validator,pre-commit-validator,branch-name-validator}.mjs
│   │   └── test/hooks.test.mjs
│   ├── reference/conventions.md
│   ├── skills/abet-{define-task,design-feature,implement,fix,audit-pr,
│   │                create-pr,address-review,archive,adr}/SKILL.md
│   └── templates/{proposal,design,tasks,runbook,adr}.md
├── abet-backend/
│   ├── .claude-plugin/plugin.json
│   ├── agents/api-performance-optimizer.md
│   ├── rules/backend.md
│   └── skills/abet-migration/SKILL.md
└── abet-frontend/
    ├── .claude-plugin/plugin.json
    ├── agents/ui-performance-optimizer.md
    ├── rules/frontend.md
    └── skills/abet-module/SKILL.md
```

## Developing

```bash
node plugins/abet-common/hooks/test/hooks.test.mjs
claude plugin validate ./plugins/abet-common --strict
claude plugin validate ./plugins/abet-backend --strict
claude plugin validate ./plugins/abet-frontend --strict
claude plugin validate . --strict
```

Skill edits take effect immediately. Changes to `hooks/`, `agents/` and `.mcp.json` need
`/reload-plugins` or a restart.
