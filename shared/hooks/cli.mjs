#!/usr/bin/env node
/**
 * Git-hook entry point for the ABET policy checks.
 *
 *   node <path>/cli.mjs pre-commit
 *   node <path>/cli.mjs commit-msg "$1"
 *   node <path>/cli.mjs pre-push
 *
 * Why this exists: only Claude Code has a PreToolUse hook. Codex and opencode have no
 * mechanism that inspects a command before it runs, so without this a developer on those
 * tools would get the skills but none of the enforcement — and could push straight to
 * production. Wiring the same checks as real git hooks covers every provider.
 *
 * The Claude Code hooks stay on top of these, because they fire on the tool call and
 * `--no-verify` cannot bypass them.
 *
 * Exit 0 allows, exit 1 blocks (git aborts the operation).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { PROTECTED_BRANCHES, BASE_BRANCH } from './lib/branches.mjs';
import { repoRoot } from './lib/toolchain.mjs';
import { runPreCommitChecks } from './checks/pre-commit.mjs';
import { validateCommitMessage } from './checks/commit-message.mjs';

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function blockWith(title, body) {
  process.stderr.write(`\n${RED}✖ ${title}${RESET}\n\n${body}\n\n${DIM}(this check also runs inside Claude Code, where --no-verify cannot skip it)${RESET}\n\n`);
  process.exit(1);
}

function note(message) {
  process.stderr.write(`${YELLOW}› ${message}${RESET}\n`);
}

const git = (root, args) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

// ------------------------------------------------------------------ commands

function preCommit(root) {
  const result = runPreCommitChecks(root);
  for (const n of result.notes) note(n);
  if (!result.ok) blockWith('pre-commit', result.message);
}

function commitMsg(root, file) {
  if (!file) blockWith('commit-msg', 'No commit message file was passed to the hook.');
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    blockWith('commit-msg', `Could not read the commit message file: ${file}`);
  }
  const result = validateCommitMessage(raw);
  if (!result.ok) blockWith('commit-msg', result.message);
  if (result.level === 'warn') note(result.message);
}

/**
 * pre-push receives `<local ref> <local sha> <remote ref> <remote sha>` lines on stdin.
 * A remote ref of refs/heads/develop means that branch is the push target, whatever the
 * local side is called — which is what makes this robust against `HEAD:develop`.
 */
async function prePush(root) {
  const allowProtected = process.env.ABET_ALLOW_PROTECTED_PUSH === '1';
  const lines = (await readStdin()).split('\n').map((l) => l.trim()).filter(Boolean);

  const targets = lines.length > 0
    ? lines.map((l) => (l.split(/\s+/)[2] || '').replace(/^refs\/heads\//, '')).filter(Boolean)
    : [git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])].filter(Boolean);

  for (const target of targets) {
    if (!PROTECTED_BRANCHES.includes(target)) continue;
    if (allowProtected) {
      note(`pushing to protected branch \`${target}\` — permitted by ABET_ALLOW_PROTECTED_PUSH`);
      continue;
    }
    blockWith(
      'push-guard',
      `Direct push to the protected branch \`${target}\` is blocked.\n\n` +
      `Push to a feature branch and open a pull request against \`${BASE_BRANCH}\`:\n` +
      '  git push -u origin <feat|fix>/<slug>\n\n' +
      'For the release promotion flow (develop → staging → production), set\n' +
      'ABET_ALLOW_PROTECTED_PUSH=1 in the environment.'
    );
  }
}

// ---------------------------------------------------------------------- main

const [command, ...rest] = process.argv.slice(2);
const root = repoRoot(process.cwd());

try {
  if (command === 'pre-commit') preCommit(root);
  else if (command === 'commit-msg') commitMsg(root, rest[0]);
  else if (command === 'pre-push') await prePush(root);
  else {
    process.stderr.write(`usage: cli.mjs <pre-commit|commit-msg <file>|pre-push>\n`);
    process.exit(2);
  }
} catch (err) {
  // A crashing policy hook must not wedge the developer's work: fail open, but say so.
  process.stderr.write(`${YELLOW}› abet hook error (allowing commit): ${err?.message ?? err}${RESET}\n`);
  process.exit(0);
}
