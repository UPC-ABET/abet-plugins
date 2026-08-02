#!/usr/bin/env node
/**
 * push-guard — blocks pushes to protected branches and non-lease force pushes.
 *
 * Protected branches in the ABET repos: develop, staging, production.
 * Everything reaches those through a pull request; nothing is pushed to them by hand.
 *
 * Escape hatch: ABET_ALLOW_PROTECTED_PUSH=1 permits protected-branch pushes for the
 * release promotion flow (the /ship-to-prod skill fast-forwards develop -> staging ->
 * production, which is a legitimate direct push). Force pushes are never unblocked by
 * it; use --force-with-lease, which is always allowed.
 */
import { execFileSync } from 'node:child_process';
import { readInput, deny, allow, run, bashCommand } from './lib/hook.mjs';
import { gitInvocations, positionals, hasShortFlag, flagEnabled, gitCommandCwd } from './lib/shell.mjs';
import { PROTECTED_BRANCHES, BASE_BRANCH } from './lib/branches.mjs';

const PROTECTED = new Set(PROTECTED_BRANCHES);

/** push options that consume the next token as a value. */
const VALUE_FLAGS = new Set(['-o', '--push-option', '--receive-pack', '--exec', '--repo', '--recurse-submodules']);

function refDestination(spec) {
  const s = spec.replace(/^\+/, '');
  const i = s.indexOf(':');
  const dst = i === -1 ? s : s.slice(i + 1);
  return dst.replace(/^refs\/heads\//, '').trim();
}

function currentBranch(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

run(async () => {
  const input = await readInput();
  const cmd = bashCommand(input);
  if (!cmd) allow();

  // The branch fallback (a push with no refspec) must be read from the repository the
  // command actually runs in, not the session's.
  const cwd = gitCommandCwd(cmd, input.cwd || process.cwd());
  // Read the flag from the command text as well as the real environment. A PreToolUse hook
  // is a child of Claude Code, not of the command being inspected, so an inline
  // `ABET_ALLOW_PROTECTED_PUSH=1 git push ...` prefix never reaches process.env — and an
  // inline prefix is exactly what the block message below tells people to use.
  const allowProtected = flagEnabled(cmd, 'ABET_ALLOW_PROTECTED_PUSH');

  for (const inv of gitInvocations(cmd)) {
    if (inv.subcommand !== 'push') continue;
    const args = inv.args;

    // --- force pushes -------------------------------------------------------
    // --force-with-lease / --force-if-includes stay allowed: they are the safe
    // form and POLICIES mandates them for rebased branches.
    const leased = args.some((a) => a.startsWith('--force-with-lease') || a.startsWith('--force-if-includes'));
    const bareForce = args.includes('--force') || args.includes('-f') || hasShortFlag(args, 'f');
    const plusRefspec = positionals(args, VALUE_FLAGS).slice(1).some((s) => s.startsWith('+'));

    if ((bareForce || plusRefspec) && !leased) {
      deny(
        'push-guard: unconditional force push blocked.\n' +
        'Use `git push --force-with-lease` instead — it aborts if the remote moved, ' +
        'so you cannot silently overwrite someone else\'s commits.'
      );
    }

    // --- protected branches -------------------------------------------------
    if (allowProtected) continue;

    const pos = positionals(args, VALUE_FLAGS);
    const refspecs = pos.slice(1);
    const deleting = args.includes('--delete') || args.includes('-d') || hasShortFlag(args, 'd');

    const targets = refspecs.length > 0
      ? refspecs.map(refDestination)
      : [currentBranch(cwd)].filter(Boolean);

    for (const target of targets) {
      if (!PROTECTED.has(target)) continue;

      if (deleting || refspecs.some((s) => s.startsWith(':'))) {
        deny(`push-guard: refusing to delete the protected branch \`${target}\` on the remote.`);
      }
      deny(
        `push-guard: direct push to the protected branch \`${target}\` is blocked.\n\n` +
        `Normally you want a pull request against \`${BASE_BRANCH}\`:\n` +
        '  git push -u origin <feat|fix>/<slug>\n\n' +
        'If the direct push is deliberate — a release promotion, or a decision you have\n' +
        'made explicitly — prefix the command to override:\n' +
        `  ABET_ALLOW_PROTECTED_PUSH=1 git push origin ${target}`
      );
    }
  }

  allow();
});
