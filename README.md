# abet-plugins

The ABET delivery pipeline, packaged for three coding agents. One set of instructions in
`shared/`; each provider directory is generated from it.

```
shared/       skills · agents · templates · rules · conventions · hook logic   ← edit here
claude/       Claude Code marketplace + plugins + PreToolUse hooks
codex/        prompt files for ~/.codex/prompts/
opencode/     .opencode/commands + agents
build/        generate.mjs — materializes each provider from shared/
```

Editing a skill means editing **one** file under `shared/`, then running the generator.
Three hand-maintained copies of the same prose is the drift this layout exists to prevent.

```bash
node build/generate.mjs           # regenerate every provider
node build/generate.mjs --check   # fail if anything is stale (CI)
node build/generate.mjs claude    # one provider
node shared/hooks/test/hooks.test.mjs   # 111 checks
```

Generated output **is committed**, so installing needs no build step.

## Install

**Claude Code** — a real plugin marketplace:

```
/plugin marketplace add UPC-ABET/abet-plugins
/plugin install abet-common@abet-plugins
/plugin install abet-backend@abet-plugins      # in the backend repo
/plugin install abet-frontend@abet-plugins     # in the frontend repo
```

The marketplace manifest is at `.claude-plugin/marketplace.json` in the **repo root** —
Claude Code looks for it there and nowhere else — and it points at the plugins under
`claude/plugins/`. To install from a local checkout, point `/plugin marketplace add` at the
repo root.

**Codex** — copy `codex/prompts/*.md` into `~/.codex/prompts/`. Codex reads `AGENTS.md`
from the repository root for conventions.

**opencode** — copy `opencode/.opencode/` into the repository. opencode reads `AGENTS.md`
(falling back to `CLAUDE.md`) for conventions.

## What each provider actually gets

| | Claude Code | Codex | opencode |
| --- | --- | --- | --- |
| Pipeline skills | `/abet-*` skills | prompts | `/abet-*` commands |
| Agents | subagents | prompts | agents |
| **Pre-tool enforcement** | ✅ PreToolUse hooks | ❌ none | ❌ none |
| Git-hook enforcement | ✅ husky | ✅ husky | ✅ husky |
| MCP | DeepWiki | manual | manual |

**Only Claude Code has a pre-tool hook.** Codex and opencode have no mechanism that
inspects a command before it runs, so without a second layer a developer on those tools
would get the skills and none of the enforcement — and could push straight to production.

That is why the policy checks are wired **twice**, from one implementation:

- `shared/hooks/checks/` holds the rules.
- `shared/hooks/*.mjs` are the Claude Code PreToolUse adapters. These fire on the tool
  call, so `--no-verify` cannot bypass them.
- `shared/hooks/cli.mjs` is the git-hook entry point husky calls, which covers every
  provider. `--no-verify` *does* bypass these — hence keeping both layers.

Wire it in a consuming repo:

```sh
# .husky/pre-commit
node <path-to-cli>/cli.mjs pre-commit

# .husky/commit-msg
node <path-to-cli>/cli.mjs commit-msg "$1"

# .husky/pre-push
node <path-to-cli>/cli.mjs pre-push
```

## Instruction files in a consuming repo

The three agents do **not** read the same file, and no plugin can substitute for the
project's own entry point:

| Tool | Reads | Notes |
| ---- | ----- | ----- |
| Claude Code | `./CLAUDE.md` or `./.claude/CLAUDE.md` | **Does not read `AGENTS.md`** |
| Codex | `AGENTS.md` | Repo root; nested files supported |
| opencode | `AGENTS.md`, falling back to `CLAUDE.md` | |

> `agents.md`'s own site lists Claude Code as an AGENTS.md consumer. Anthropic's docs say
> the opposite explicitly. The vendor's docs win — do not delete `CLAUDE.md` on the
> strength of that list.

So a repo keeps **both**, thin, with the content living once in `docs/`:

```
docs/POLICIES.md   the rules          ← content lives here
docs/CONTEXT.md    the map

AGENTS.md          pointer stub — serves Codex and opencode
CLAUDE.md          one line: @AGENTS.md
```

## The pipeline

The unifying artifact is `openspec/changes/<slug>/`; every skill detects a change by
testing whether that directory exists. There is no OpenSpec CLI — it is a folder
convention implemented with `mkdir`, `Write` and `git mv`.

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
      ↓                ←→ /abet-review-pr  (reviewer's side, on someone else's PR)
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

Profiles add to the base: `abet-backend` contributes `/abet-migration` and the API
performance optimizer; `abet-frontend` contributes `/abet-module`,
`/abet-verify-contract` and the UI performance optimizer.

Full conventions: [`shared/reference/conventions.md`](shared/reference/conventions.md).

## Design decisions worth knowing

### No ticket IDs — the slug is the identifier

There is no Jira. `/abet-define-task` fills that role and `proposal.md` *is* the ticket.
The slug is plain kebab-case (`bulk-edit-rubric-weights`) and the branch carries it
(`feat/bulk-edit-rubric-weights`), so every skill can infer the change from
`git branch --show-current`.

If a ticket system arrives later, prefix slugs with its key and inference keeps working
unchanged. Nothing else in the pipeline moves.

### Every task carries a checkbox

`tasks.md` uses readable `### Task N.N` headings **and** a `- [ ]` inside each block.

Headings alone break the completeness gate, which is literally
`grep -c '^- \[ \]' tasks*.md`. A file with only `✅ DONE` headings reports zero open
tasks whether or not any work was done, so the gate silently passes and can never raise
its blocker.

### Cross-repo: contract at design time, generated spec as the enforcement

Backend and frontend are separate repos. A change spanning both uses the **same slug in
both**, with `proposal.md` and `contract.md` as identical copies and `design.md` /
`tasks.md` holding only that repo's own side.

- **Sequential** (one person, backend then frontend) — no contract file. The backend's
  committed `openapi.json` *is* the contract. This is the default.
- **Parallel** (two people, or the frontend can't wait) — `contract.md` agreed first.

The backend commits `openapi.json` (`pnpm openapi:export`) in the same PR as the endpoints
it describes, so a renamed field shows up as a line in the diff instead of a runtime error
in the frontend three days later. Where the two disagree, **the spec wins**.

**Ordering rule**: the backend change reaches the `staging` **branch** before the frontend
PR merges — an ordering guarantee, not a liveness one, since only `production` is deployed.
`/abet-verify-contract` checks this remotely with `gh api` at each branch; it never reads
another repo from disk.

### What the hooks block, and the one escape hatch

| Hook | Behaviour |
| ---- | --------- |
| `push-guard` | **Blocks** pushes to `develop`, `staging`, `production`, and unconditional force pushes. Parses subshells, `bash -c`, `-uf` clusters, `+refspec`, `git -C`/`-c` globals, chained commands. |
| `commit-msg-validator` | **Blocks** non-Conventional-Commit subjects, multi-line messages, trailers, and `--no-verify`. |
| `pre-commit-validator` | **Blocks** on staged secrets, unformatted files, lint problems, type errors, or failing related tests. Generated files (lockfiles, build output, `openapi.json`) are exempt from lint and format. |
| `branch-name-validator` | **Warns only.** Never blocks. |

`--force-with-lease` and `--force-if-includes` are **allowed**; bare `--force` and `-f` are
not. The leased forms abort when the remote has moved, which is the correct way to push a
rebased branch.

To push a protected branch deliberately — a release promotion, or a decision you have made
explicitly — prefix the command:

```bash
ABET_ALLOW_PROTECTED_PUSH=1 git push origin develop
```

It relaxes only the protected-branch rule; force pushes stay blocked regardless.

The prefix is read from the **command string**, not only from `process.env`. A PreToolUse
hook runs as a child of Claude Code rather than of the command it inspects, so an inline
assignment never reaches its environment — an earlier version of this hook documented the
override and then ignored it, which made the guard look absolute. The git-hook path
receives the variable natively, so both entry points honour it.

Precision matters: `=0` does not unlock, an unrelated variable does not unlock, and a commit
message that merely contains the string does not unlock. All covered by the suite.

### Hooks are Node, not shell

No Git Bash, no `jq`, no PowerShell variants to keep in sync — the same code runs on macOS
and Windows, and node is already a dependency of every repo here.

## Layout

```
.
├── .claude-plugin/marketplace.json     must live at the repo root
├── shared/
│   ├── skills/{common,backend,frontend}/abet-*/SKILL.md
│   ├── agents/{common,backend,frontend}/*.md
│   ├── templates/{proposal,design,tasks,runbook,contract,adr}.md
│   ├── rules/{backend,frontend}.md
│   ├── reference/conventions.md
│   └── hooks/
│       ├── checks/{commit-message,pre-commit}.mjs       the policy
│       ├── lib/{shell,hook,branches,toolchain,secrets}.mjs
│       ├── {push-guard,commit-msg-validator,…}.mjs      PreToolUse adapters
│       ├── cli.mjs                                      git-hook entry point
│       └── test/hooks.test.mjs
├── claude/     plugins/abet-{common,backend,frontend}/
├── codex/      prompts/ · reference/
├── opencode/   .opencode/{commands,agents}/ · reference/
└── build/generate.mjs
```

Everything under `claude/`, `codex/` and `opencode/` except the hand-maintained manifests
(`plugin.json`, `marketplace.json`, `hooks.json`, `.mcp.json`) is generated. Edit
`shared/`, then run the generator.
