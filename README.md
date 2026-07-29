# abet-claude-plugins

Claude Code plugins for the UPC-ABET accreditation platform. One marketplace, two plugins.

| | `abet-common` | `abet-backend` |
| --- | --- | --- |
| **Role** | Mandatory base for every ABET repo | Backend profile, layered on top |
| **Skills** | 9 pipeline skills | 1 (`/abet-migration`) |
| **Agents** | `code-quality-reviewer` | `api-performance-optimizer` |
| **Hooks** | 4 git-policy hooks | — |
| **Other** | DeepWiki MCP, doc templates, permission snippet | Stack rules, permission snippet |

A third plugin, `abet-frontend`, will layer the Next.js profile onto the same base.

## Install

```bash
# in the repo you want it in
/plugin marketplace add "D:/Universidad/ABET/ABET 3.0/abet-claude-plugins"
/plugin install abet-common@abet-plugins
/plugin install abet-backend@abet-plugins     # backend repo only
```

Then merge the permission snippets, which plugins cannot ship themselves:

```bash
node install/apply-settings.mjs "../BACK-ACREDITACION-3.0" --profile backend
node install/apply-settings.mjs "../FRONT-ACREDITACION-3.0"
```

The merge is additive and idempotent — re-run it after updating the plugin.

Once this repo is on GitHub, the marketplace source becomes
`/plugin marketplace add UPC-ABET/abet-claude-plugins` and everyone gets updates with
`/plugin marketplace update`.

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

ABET has no Jira. `/abet-define-task` fills that role and `proposal.md` *is* the ticket.
The slug is plain kebab-case (`bulk-edit-rubric-weights`) and the branch carries it
(`feat/bulk-edit-rubric-weights`), so every skill can infer the change from
`git branch --show-current`.

When Jira arrives, prefix slugs with the key (`ABC-123-bulk-edit-rubric-weights`) and
inference keeps working unchanged. Nothing else in the pipeline moves.

### Every task carries a checkbox

`tasks.md` uses readable `### Task N.N` headings **and** a `- [ ]` inside each block.

Headings alone break the completeness gate, which is literally
`grep -c '^- \[ \]' tasks*.md`. A file with only `✅ DONE` headings reports zero open
tasks whether or not any work was done, so the gate silently passes and can never raise
its blocker. `/abet-implement` refuses to start against a checkbox-less task file for the
same reason.

### Hooks are Node, not shell

The four PreToolUse hooks are `.mjs`, invoked as `node "${CLAUDE_PLUGIN_ROOT}/hooks/x.mjs"`.
No Git Bash dependency, no `jq` dependency, no untested PowerShell twins — Node is
guaranteed present in both repos and the parser is far more reliable than bash string
handling.

Regression suite: `node plugins/abet-common/hooks/test/hooks.test.mjs` — 89 checks.

### Plugins cannot ship permissions

There is no `permissions` field in the plugin manifest, so the allow/deny lists are
snippets merged into each repo's own `.claude/settings.json`. They are convenience only:
they cut prompts for things you would approve anyway. **The real boundary is the hooks**,
which run on the tool call and cannot be bypassed from settings — or by `--no-verify`.

## The hooks

| Hook | Behaviour |
| ---- | --------- |
| `push-guard` | **Blocks** pushes to `develop`, `staging`, `production`, and unconditional force pushes. Parses subshells, `bash -c`, `-uf` clusters, `+refspec`, `git -C`/`-c` globals, chained commands. |
| `commit-msg-validator` | **Blocks** non-Conventional-Commit subjects, multi-line messages, trailers, and `--no-verify`. |
| `pre-commit-validator` | **Blocks** on staged secrets, unfixable lint errors, type errors, or failing related tests. Warns on divergence from `develop`. |
| `branch-name-validator` | **Warns only.** Never blocks. |

### `--force-with-lease` is allowed

`push-guard` blocks bare `--force` and `-f` but permits `--force-with-lease` and
`--force-if-includes`, because those abort when the remote has moved. That is the form
POLICIES mandates for a rebased branch.

### The release promotion escape hatch

`develop → staging → production` is a legitimate direct push, so `push-guard` honours
`ABET_ALLOW_PROTECTED_PUSH=1`. It relaxes only the protected-branch rule; force pushes
stay blocked regardless.

### `pre-commit-validator` deliberately does not lint-and-format

husky + lint-staged already run `eslint --fix` and `prettier --write` on staged files
when git commits. Re-running them in the hook would block on problems that are about to
fix themselves. The hook covers what lint-staged cannot heal: secrets, *unfixable* lint
errors, type errors, and tests related to the staged files.

Env switches: `ABET_SKIP_PRECOMMIT`, `ABET_SKIP_TESTS`, `ABET_SKIP_TYPECHECK`,
`ABET_FULL_TESTS` (all `=1`).

## Repo layout

```
.claude-plugin/marketplace.json
install/apply-settings.mjs
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
│   ├── install/settings.snippet.json
│   ├── reference/conventions.md
│   ├── skills/abet-{define-task,design-feature,implement,fix,audit-pr,
│   │                create-pr,address-review,archive,adr}/SKILL.md
│   └── templates/{proposal,design,tasks,runbook,adr}.md
└── abet-backend/
    ├── .claude-plugin/plugin.json
    ├── agents/api-performance-optimizer.md
    ├── install/settings.snippet.json
    ├── rules/backend.md
    └── skills/abet-migration/SKILL.md
```

## Developing

```bash
node plugins/abet-common/hooks/test/hooks.test.mjs   # hook regression suite
claude plugin validate ./plugins/abet-common --strict
claude plugin validate ./plugins/abet-backend --strict
claude plugin validate . --strict                    # the marketplace
```

Skill edits take effect immediately. Changes to `hooks/`, `agents/` and `.mcp.json`
need `/reload-plugins` or a restart.
