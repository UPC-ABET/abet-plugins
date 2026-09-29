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
node shared/hooks/test/hooks.test.mjs   # the hook test suite
```

Generated output **is committed**, so installing needs no build step.

## Install

ABET ships as one monorepo, `UPC-ABET/ACC-SYS`, with `backend/` and `frontend/` as pnpm
workspace packages. Install **all three plugins together, once, in `ACC-SYS`**:

**Claude Code** — a real plugin marketplace:

```
/plugin marketplace add UPC-ABET/abet-plugins
/plugin install abet-common@abet-plugins
/plugin install abet-backend@abet-plugins
/plugin install abet-frontend@abet-plugins
```

The marketplace manifest is at `.claude-plugin/marketplace.json` in the **repo root** —
Claude Code looks for it there and nowhere else — and it points at the plugins under
`claude/plugins/`. To install from a local checkout, point `/plugin marketplace add` at the
repo root.

Install scope for this team is **per-user** (`/plugin install ... ` at user or local
scope, not project scope): `.claude/` is gitignored in `ACC-SYS`, so a project-scoped
install would not be shared by committing it anyway.

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

Wire it in a consuming repo — one root `.husky/`, covering both packages:

```sh
# .husky/pre-commit
node <path-to-cli>/cli.mjs pre-commit

# .husky/commit-msg
node <path-to-cli>/cli.mjs commit-msg "$1"

# .husky/pre-push
node <path-to-cli>/cli.mjs pre-push
```

In `ACC-SYS`, `<path-to-cli>` is `node_modules/abet-plugins/shared/hooks`.

## Instruction files in a consuming repo

The three agents do **not** read the same file, and no plugin can substitute for the
project's own entry point:

| Tool | Reads | Notes |
| ---- | ----- | ----- |
| Claude Code | `./CLAUDE.md` or `./.claude/CLAUDE.md` | **Does not read `AGENTS.md`**. Nested `backend/CLAUDE.md` / `frontend/CLAUDE.md` load on demand when files under them are read. |
| Codex | `AGENTS.md` | Repo root; nested files supported |
| opencode | `AGENTS.md`, falling back to `CLAUDE.md` | |

> `agents.md`'s own site lists Claude Code as an AGENTS.md consumer. Anthropic's docs say
> the opposite explicitly. The vendor's docs win — do not delete `CLAUDE.md` on the
> strength of that list.

So a repo keeps **both**, thin, with the content living once in `docs/` — at the repo
root **and** in each package:

```
docs/POLICIES.md            root: repo-wide rules   ← content lives here
docs/CONTEXT.md              root: the map

backend/docs/POLICIES.md    backend's own rules      ← content lives here
backend/docs/CONTEXT.md      backend's own map
frontend/docs/POLICIES.md   frontend's own rules     ← content lives here
frontend/docs/CONTEXT.md     frontend's own map

AGENTS.md, backend/AGENTS.md, frontend/AGENTS.md      pointer stubs — serve Codex and opencode
CLAUDE.md, backend/CLAUDE.md, frontend/CLAUDE.md       one line each: @AGENTS.md
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

### Backend and frontend: one change folder, generated spec as the enforcement

Backend and frontend are packages in one repo (`ACC-SYS`), not separate repos. A change
spanning both stays in **one** change folder, with `design.md` / `tasks.md` holding both
sides as `## Backend` / `## Frontend` sections in the same file.

- **Sequential** (one person, backend then frontend, usually one PR) — no contract file.
  `backend/openapi.json` on disk at HEAD *is* the contract. This is the default.
- **Parallel** (two people, or the frontend can't wait) — `contract.md` optional, agreed
  first, one copy.

The backend commits `openapi.json` (`pnpm --filter ./backend openapi:export`) in the same
PR as the endpoints it describes, so a renamed field shows up as a line in the diff instead
of a runtime error in the frontend three days later. Where the two disagree, **the spec
wins**. `/abet-verify-contract` checks this locally, in the same working tree — no network
fetch, no other repository.

**Sequencing**: the default is one PR for both packages. When split, the backend PR merges
into `develop` first — there is no requirement that it also reach `staging` before the
frontend PR merges, since `staging` is a real deployed environment
(https://accreditation-stg.tcupc.pe) rather than a merge gate.

### What the hooks block, and the one escape hatch

| Hook | Behaviour |
| ---- | --------- |
| `push-guard` | **Blocks** pushes to `develop`, `staging`, `production`, and unconditional force pushes. Parses subshells, `bash -c`, `-uf` clusters, `+refspec`, `git -C`/`-c` globals, chained commands. |
| `commit-msg-validator` | **Blocks** non-Conventional-Commit subjects, multi-line messages, trailers, and `--no-verify`. |
| `pre-commit-validator` | **Blocks** on staged secrets, unformatted files, lint problems, type errors, or failing related tests. Runs per workspace package, resolving each package's own eslint/prettier/tsc/jest; root-level files get prettier only. Generated files (lockfiles, build output, `openapi.json`) are exempt from lint and format. |
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

### Cost: the plugin does not choose your model, it chooses how much work to do

Everyone here pays for their own plan, so a $20 user and a $100 user cannot share one
model policy. Three rules instead:

- **The session model is yours.** Nothing here sets it: every skill runs on whatever `/model`
  you picked. (A skill-level `model:` in the frontmatter does not switch models — tested —
  so none is declared.) Only *subagent spawns* are pinned, because that does work.
- **Depth follows risk, not your plan.** `/abet-audit-pr` and `/abet-review-pr` take `lite`
  (one pass, no subagents) or `deep` (parallel fan-out). With neither, `auto` picks: `deep`
  above 400 changed lines or 15 files of source code (tests, docs and the regenerated
  `openapi.json` do not count), on both packages at once, or on a migration, auth, raw SQL,
  deploy or dependency path; `lite` otherwise. Subagents multiply
  tokens, so they are spent where a miss costs the most. `/abet-implement` fans out only
  for three or more independent tasks; `serial` turns it off.
- **Mechanical work is code.** `shared/scripts/audit-scope.mjs` counts files, lines, open
  tasks and sensitive paths and picks the depth; a model is never asked to do arithmetic.
  Skills declare a model *role* (`{{pin:execute}}`), and the generator maps it per
  provider: Claude Code `sonnet` (execute) / `haiku` (procedural), Codex `terra` / `luna`,
  opencode nothing — its model ids depend on the user's provider, so subagents there run
  on the model the user chose.

Every skill's description ends in a `Cost:` label so you can see what you are about to spend.

### Module file names are checked by code

Files under `backend/src/modules/` are `<name>.<kind>.ts`, and the kind fixes the folder
(table in `rules/backend.md`). `file-name-guard` denies creating a file with an invented
kind (`.bands.ts`, `.section-filter.ts`) the moment the model tries, and the pre-commit
gate checks newly added files for Codex, opencode and humans. Only **new** files are
checked, so legacy files never block a commit. `ABET_SKIP_NAMING=1` bypasses the gate.

### Security and reuse: scripts are the floor, the model explores above it

`audit-scope.mjs` runs deterministic checks the model would otherwise have to notice: the
team's own rules on auth and scope (`scope-from-request`, `cache-key-without-scope`,
`scope-param-unused`, `route-without-permission`, SQL built from values, secrets, a new
`@Public()`…), and duplicate code counted across the repo (**rule of three**: two copies are
tolerated, the third is a major finding that names all the copies). Blocks repeated across
more than 12 modules are treated as a convention, not duplication.

The scripts are the floor. The security auditor also reads the diff as an attacker, and
anything it finds that no rule flagged is a **judgment** finding.

### The audit ledger: turning judgment into rules

Every security and reuse finding is recorded, by a script that validates it first: from
`/abet-audit-pr` in `openspec/changes/<slug>/audit.jsonl` (or `openspec/audit-ledger/` on the
bug lane), and from `/abet-review-pr` — someone else's branch — in its own local file,
`openspec/audit-ledger/review-<pr>.jsonl`, which posts nothing to GitHub. Each is
`mechanical` (a rule flagged it and the auditor confirmed it, or dropped it with a reason)
or `judgment`, and a judgment finding carries the code shape, **how a machine could detect
it**, and an honest `convertible` estimate.

```bash
node node_modules/abet-plugins/shared/scripts/audit-ledger.mjs report
```

prints what to do with it: judgment findings that recur across *different changes* and look
convertible ("promote to a mechanical rule", with the detection idea attached), and how often
each mechanical rule was right (a rule wrong half the time gets a "tighten" note). Re-running
an audit on one branch does not count twice. This has already worked once: auditors kept
finding an IDOR shaped `getRoster(id, schoolId) { return repo.findRoster(id) }` by reading, and
it became the rule `scope-param-unused`.

### Hooks are Node, not shell

No Git Bash, no `jq`, no PowerShell variants to keep in sync — the same code runs on macOS
and Windows, and node is already a dependency of the consuming repo.

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

`templates/` and `reference/conventions.md` are copied only into `abet-common` — no
backend or frontend skill references either via `${CLAUDE_PLUGIN_ROOT}`, and `abet-common`
is always installed alongside the stack profiles. `codex/` and `opencode/` still get both,
since they have no per-plugin split.
