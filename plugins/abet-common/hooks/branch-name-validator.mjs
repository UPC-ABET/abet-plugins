#!/usr/bin/env node
/**
 * branch-name-validator — warns when a new branch does not follow the ABET convention.
 *
 * Warn-only by design. A bad branch name is a readability problem, not a correctness
 * one, and blocking here would strand you mid-`checkout` with no branch at all.
 *
 * Convention: `<type>/<slug>` where slug is the kebab-case change slug, so that
 * `openspec/changes/<slug>/` can be inferred from the branch name alone.
 *   feat/bulk-edit-rubric-weights
 *   fix/gra-report-is-active-filter
 *   chore/archive-bulk-edit-rubric-weights
 */
import { readInput, warn, allow, run, bashCommand } from './lib/hook.mjs';
import { gitInvocations, positionals } from './lib/shell.mjs';
import { BRANCH_TYPES as TYPES, PROTECTED_BRANCHES } from './lib/branches.mjs';

const VALID = new RegExp(`^(${TYPES.join('|')})/[a-z0-9]+(-[a-z0-9]+)*$`);
const PROTECTED = new Set(PROTECTED_BRANCHES);

/** Extract the branch name a command is about to create, or null. */
function newBranchName(inv) {
  const { subcommand, args } = inv;

  if (subcommand === 'checkout') {
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-b' || args[i] === '-B') return args[i + 1] ?? null;
    }
    return null;
  }
  if (subcommand === 'switch') {
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-c' || args[i] === '-C' || args[i] === '--create') return args[i + 1] ?? null;
    }
    return null;
  }
  if (subcommand === 'branch') {
    // `git branch <name>` creates; `git branch -d/-m/--list` does not.
    if (args.some((a) => /^-[dDmMalvr]/.test(a) || a.startsWith('--delete') || a.startsWith('--move') || a.startsWith('--list'))) return null;
    return positionals(args, new Set(['-u', '--set-upstream-to', '--contains', '--sort'])).at(0) ?? null;
  }
  return null;
}

run(async () => {
  const input = await readInput();
  const cmd = bashCommand(input);
  if (!cmd) allow();

  for (const inv of gitInvocations(cmd)) {
    const name = newBranchName(inv);
    if (!name || name.startsWith('-')) continue;
    if (PROTECTED.has(name)) continue;
    if (VALID.test(name)) continue;

    warn(
      `branch-name-validator: \`${name}\` does not match the ABET branch convention.\n` +
      `Expected \`<type>/<kebab-slug>\` with type one of: ${TYPES.join(', ')}.\n` +
      'The slug should match the openspec change directory, so the pipeline skills can ' +
      'infer `openspec/changes/<slug>/` from the branch name. Proceeding anyway.'
    );
  }

  allow();
});
