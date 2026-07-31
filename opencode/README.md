# ABET commands for opencode

opencode reads `AGENTS.md` from the repository root (falling back to `CLAUDE.md`) and
loads commands from `.opencode/commands/`.

- Copy `.opencode/` into the repository you are working in.
- opencode has no pre-tool hook, so enforcement comes from the husky git hooks in each
  repository.

> Generated from `shared/` by `build/generate.mjs`. Do not edit by hand.
