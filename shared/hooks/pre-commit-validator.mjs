#!/usr/bin/env node
/**
 * pre-commit-validator — Claude Code PreToolUse adapter for the pre-commit gate.
 *
 * The gate itself lives in `checks/pre-commit.mjs` and is shared with the husky
 * `pre-commit` hook, so a developer on Codex or opencode gets the same enforcement.
 * This file only translates between the PreToolUse envelope and that check.
 *
 * Env switches: ABET_SKIP_PRECOMMIT, ABET_SKIP_FORMAT, ABET_SKIP_LINT,
 * ABET_SKIP_TYPECHECK, ABET_SKIP_TESTS, ABET_FULL_TESTS (all `=1`).
 */
import { readInput, deny, warn, allow, run, bashCommand } from './lib/hook.mjs';
import { gitInvocations, gitCommandCwd } from './lib/shell.mjs';
import { repoRoot } from './lib/toolchain.mjs';
import { runPreCommitChecks } from './checks/pre-commit.mjs';

run(async () => {
  const input = await readInput();
  const cmd = bashCommand(input);
  if (!cmd) allow();

  const isCommit = gitInvocations(cmd).some((inv) => inv.subcommand === 'commit');
  if (!isCommit) allow();

  // Resolve the directory the command actually runs in, not the session's — otherwise a
  // `cd ../other-repo && git commit` is checked against the wrong repository.
  const root = repoRoot(gitCommandCwd(cmd, input.cwd || process.cwd()));
  const result = runPreCommitChecks(root);

  if (!result.ok) deny(`pre-commit-validator: ${result.message}`);
  if (result.notes.length > 0) warn(`pre-commit-validator: ${result.notes.join('; ')}.`);
  allow();
});
