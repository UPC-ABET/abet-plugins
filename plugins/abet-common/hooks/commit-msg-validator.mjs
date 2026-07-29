#!/usr/bin/env node
/**
 * commit-msg-validator — enforces the ABET commit contract.
 *
 * Three rules, all from docs/POLICIES.md:
 *   1. Conventional Commits: `type(scope)?!?: subject`
 *   2. Subject only — a single line, no body, no trailers
 *   3. No verification bypass — `--no-verify` / `-n` is never acceptable
 *
 * This runs on the Bash *tool call*, so it fires before git does. A `--no-verify`
 * flag cannot slip past it, which is the point: the flag disables git's own hooks,
 * not this one.
 */
import { readInput, deny, warn, allow, run, bashCommand } from './lib/hook.mjs';
import { gitInvocations, hasShortFlag } from './lib/shell.mjs';

const TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'];
const CONVENTIONAL = new RegExp(`^(${TYPES.join('|')})(\\([a-z0-9][a-z0-9._/-]*\\))?!?: .+$`);

// Not anchored to line start: the multiline rule already rejects the usual
// trailer-on-its-own-line form, so what is left to catch is a trailer that has
// been folded into the subject itself.
const BANNED_TRAILERS = [
  /Co-Authored-By\s*:/i,
  /Claude-Session\s*:/i,
  /Generated with \[?Claude Code/i,
  /🤖 Generated with/i,
];

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
        'cannot be checked here. Keep it to a single Conventional Commit subject line.'
      );
    }

    if (msgs.length > 1) {
      deny(
        'commit-msg-validator: multiple `-m` flags create a multi-paragraph commit message.\n' +
        'ABET commits are subject-only — pass exactly one `-m` with a single line.'
      );
    }

    const msg = msgs[0];

    if (msg.includes('\n')) {
      deny(
        'commit-msg-validator: the commit message spans multiple lines.\n' +
        'ABET commits are subject-only — no body. Compress it to one line:\n' +
        `  ${msg.split('\n')[0]}`
      );
    }

    for (const pattern of BANNED_TRAILERS) {
      if (pattern.test(msg)) {
        deny(
          'commit-msg-validator: commit trailers and attribution footers are not used on this project.\n' +
          'Remove the Co-Authored-By / Claude-Session / "Generated with" line and commit the subject alone.'
        );
      }
    }

    if (!CONVENTIONAL.test(msg)) {
      deny(
        `commit-msg-validator: "${msg}" is not a valid Conventional Commit subject.\n` +
        `Expected \`type(scope): subject\` where type is one of: ${TYPES.join(', ')}.\n` +
        'Examples:\n' +
        '  feat(rubrics): add bulk weight editing\n' +
        '  fix(gra): apply is_active filter to the report query\n' +
        '  chore(openspec): archive bulk-edit-rubric-weights'
      );
    }

    if (msg.length > 100) {
      deny(
        `commit-msg-validator: the subject is ${msg.length} characters; keep it under 100.\n` +
        'Trim it to the essential change — detail belongs in the PR body and the openspec change.'
      );
    }

    if (msg.length > 72) {
      warn(`commit-msg-validator: subject is ${msg.length} characters. Under 72 reads better in \`git log --oneline\`.`);
    }
  }

  allow();
});
