# ABET prompts for Codex

Codex reads `AGENTS.md` from the repository root and custom prompts from `~/.codex/prompts/`.
There is no plugin or hook mechanism, so:

- Copy `prompts/*.md` into `~/.codex/prompts/` to get the pipeline as slash commands.
- Enforcement comes from the husky git hooks in each repository, not from Codex.

> Generated from `shared/` by `build/generate.mjs`. Do not edit by hand.

| Prompt | Profile | Purpose |
| --- | --- | --- |
| `/abet-address-review` | common | Work through review feedback on your own PR. |
| `/abet-adr` | common | Write an Architecture Decision Record. |
| `/abet-archive` | common | Post-merge bookkeeping. |
| `/abet-audit-pr` | common | Pre-PR self-audit. |
| `/abet-create-pr` | common | Open the pull request against develop with a fully-filled body, linking the openspec change. |
| `/abet-define-task` | common | Turn a raw feature request into a reviewed ticket — the openspec proposal. |
| `/abet-design-feature` | common | Turn an agreed proposal. |
| `/abet-fix` | common | The bug lane — reproduce first, find the root cause systematically, write a regression test that fails before the fix, then apply the minimal fix. |
| `/abet-implement` | common | Execute an openspec change's tasks. |
| `/abet-review-pr` | common | Review someone else's pull request. |
| `/code-quality-reviewer` | common | Looping quality enforcer for a working branch. |
| `/abet-migration` | backend | Create, review and run a TypeORM migration safely against a production database. |
| `/api-performance-optimizer` | backend | Measure-first endpoint optimizer for the NestJS + TypeORM backend. |
| `/abet-module` | frontend | Create or audit a frontend domain module against the required layout and import rules. |
| `/abet-verify-contract` | frontend | Confirm the backend has promoted the API this change depends on, and that what shipped matches contract. |
| `/ui-performance-optimizer` | frontend | Measure-first performance optimizer for the Next. |
