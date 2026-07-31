#!/usr/bin/env node
/**
 * commit-msg-validator — Claude Code PreToolUse adapter for the commit-message policy.
 *
 * The policy lives in `checks/commit-message.mjs` and is shared with the husky
 * `commit-msg` hook. This file adds the one rule that only makes sense here: `--no-verify`
 * is refused. That flag disables git's own hooks, not this one — which is exactly why the
 * PreToolUse layer is kept alongside the git hook rather than replaced by it.
 */
import { readInput, deny, warn, allow, run, bashCommand } from './lib/hook.mjs';
import { gitInvocations, hasShortFlag } from './lib/shell.mjs';
import { validateCommitMessage } from './checks/commit-message.mjs';

/** Collect every `-m` / `--message` value from a git commit invocation. */
function messages(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-m' || a === '--message') {
      if (args[i + 1] !== undefined) out.push(args[++i]);
      continue;
    }
    if (a.startsWith('--message=')) { out.push(a.slice('--message='.length)); continue; }
    // Short cluster carrying the message inline, e.g. -am "msg"
    if (/^-[A-Za-z]*m$/.test(a) && args[i + 1] !== undefined) { out.push(args[++i]); continue; }
  }
  return out;
}

run(async () => {
  const input = await readInput();
  const cmd = bashCommand(input);
  if (!cmd) allow();

  for (const inv of gitInvocations(cmd)) {
    if (inv.subcommand !== 'commit') continue;
    const args = inv.args;

    if (args.includes('--no-verify') || args.includes('-n') || hasShortFlag(args, 'n')) {
      deny(
        'commit-msg-validator: `--no-verify` is not permitted on this project.\n' +
        'It disables the pre-commit checks that keep develop green. If a hook is failing, ' +
        'fix the underlying lint/test failure rather than bypassing the gate.'
      );
    }

    // Nothing to validate on these paths — git will not take a -m subject.
    if (args.includes('--amend') && messages(args).length === 0) continue;
    if (args.some((a) => a === '-F' || a === '--file' || a.startsWith('--file='))) continue;
    if (args.some((a) => a === '-C' || a === '-c' || a === '--reuse-message' || a === '--squash' || a === '--fixup')) continue;

    const msgs = messages(args);
    if (msgs.length === 0) {
      warn(
        'commit-msg-validator: no `-m` found, so git will open an editor and the message ' +
        'cannot be checked here. The husky commit-msg hook will still validate it.'
      );
    }

    if (msgs.length > 1) {
      deny(
        'commit-msg-validator: multiple `-m` flags create a multi-paragraph commit message.\n' +
        'ABET commits are subject-only — pass exactly one `-m` with a single line.'
      );
    }

    const result = validateCommitMessage(msgs[0]);
    if (!result.ok) deny(`commit-msg-validator: ${result.message}`);
    if (result.level === 'warn') warn(`commit-msg-validator: ${result.message}`);
  }

  allow();
});
