#!/usr/bin/env node
/**
 * pre-commit-validator — gates `git commit` on the checks that must pass.
 *
 * Scope is deliberately narrow. husky + lint-staged already run `eslint --fix` and
 * `prettier --write` over the staged files when git commits, so re-running those here
 * would block on problems that are about to fix themselves. This hook covers what
 * lint-staged cannot heal:
 *
 *   1. staged secrets          (blocks)
 *   2. unfixable lint errors   (blocks — `--fix` would already have handled the rest)
 *   3. type errors             (blocks)
 *   4. tests related to the staged files (blocks)
 *   5. divergence from origin/develop    (warns; it never rebases for you)
 *
 * Every check degrades to a skip when the tool is absent, so the same hook works in
 * the backend (jest) and the frontend (no test runner) without configuration.
 *
 * Env switches:
 *   ABET_SKIP_PRECOMMIT=1   skip the whole hook
 *   ABET_SKIP_TESTS=1       skip step 4
 *   ABET_SKIP_TYPECHECK=1   skip step 3
 *   ABET_FULL_TESTS=1       run the entire suite instead of only related tests
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readInput, deny, warn, allow, run, bashCommand } from './lib/hook.mjs';
import { gitInvocations } from './lib/shell.mjs';
import { BASE_BRANCH } from './lib/branches.mjs';
import { resolveTool, readPackageJson, runNode, git, repoRoot, excerpt } from './lib/toolchain.mjs';
import { scanDiff } from './lib/secrets.mjs';

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

run(async () => {
  const input = await readInput();
  const cmd = bashCommand(input);
  if (!cmd) allow();
  if (process.env.ABET_SKIP_PRECOMMIT === '1') allow();

  const isCommit = gitInvocations(cmd).some((inv) => inv.subcommand === 'commit');
  if (!isCommit) allow();

  const root = repoRoot(input.cwd || process.cwd());
  const pkg = readPackageJson(root);
  if (!pkg) allow(); // not a Node project — nothing this hook knows how to check

  const staged = git(root, ['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
    .split('\n').map((s) => s.trim()).filter(Boolean);
  if (staged.length === 0) allow(); // `git commit --amend`, or nothing staged yet

  const notes = [];

  // --- 1. staged secrets ----------------------------------------------------
  const diff = git(root, ['diff', '--cached', '--unified=0']);
  const secrets = scanDiff(diff);
  if (secrets.length > 0) {
    const list = secrets.slice(0, 10)
      .map((f) => `  ${f.file}:${f.line} — ${f.rule}\n    ${f.preview}`).join('\n');
    deny(
      `pre-commit-validator: ${secrets.length} possible secret(s) in the staged changes.\n${list}\n\n` +
      'Move the value to an environment variable and reference it through the config service. ' +
      'If this is genuinely a fixture or example, add an `abet-allow-secret` comment on that line.'
    );
  }

  // --- 2. lint (errors only) ------------------------------------------------
  const codeFiles = staged.filter((f) => CODE_EXT.test(f) && existsSync(join(root, f)));
  const eslint = resolveTool(root, 'eslint');
  if (eslint && codeFiles.length > 0) {
    const res = runNode(root, eslint, ['--quiet', '--no-warn-ignored', '--format', 'stylish', ...codeFiles]);
    if (res.timedOut) notes.push('lint timed out — skipped');
    else if (!res.ok && res.out) {
      deny(
        'pre-commit-validator: eslint reports errors that `--fix` cannot resolve.\n\n' +
        `${excerpt(res.out)}\n\n` +
        'Fix these before committing — lint-staged will not clear them for you.'
      );
    }
  } else if (!eslint) {
    notes.push('eslint not installed — lint skipped');
  }

  // --- 3. typecheck ---------------------------------------------------------
  const tsc = resolveTool(root, 'tsc');
  const tsconfig = ['tsconfig.build.json', 'tsconfig.json'].find((f) => existsSync(join(root, f)));
  if (process.env.ABET_SKIP_TYPECHECK !== '1' && tsc && tsconfig && codeFiles.some((f) => /\.tsx?$/.test(f))) {
    const res = runNode(root, tsc, ['--noEmit', '-p', tsconfig], 300_000);
    if (res.timedOut) notes.push('typecheck timed out — skipped');
    else if (!res.ok) {
      deny(
        `pre-commit-validator: \`tsc --noEmit -p ${tsconfig}\` failed.\n\n` +
        `${excerpt(res.out)}\n\n` +
        'The build will not pass with these errors. Fix them, or stage the fix alongside.'
      );
    }
  }

  // --- 4. tests related to the staged files ---------------------------------
  const jest = resolveTool(root, 'jest');
  if (process.env.ABET_SKIP_TESTS !== '1' && jest && codeFiles.length > 0) {
    const full = process.env.ABET_FULL_TESTS === '1';
    const args = full
      ? ['--silent', '--ci', '--passWithNoTests']
      : ['--silent', '--ci', '--passWithNoTests', '--findRelatedTests', ...codeFiles];
    const res = runNode(root, jest, args, 420_000);
    if (res.timedOut) notes.push('tests timed out — skipped');
    else if (!res.ok) {
      deny(
        `pre-commit-validator: ${full ? 'the test suite' : 'tests related to the staged files'} failed.\n\n` +
        `${excerpt(res.out, 30)}\n\n` +
        'Green tests are the gate for a commit. Fix the failure, or stage the test change with it.'
      );
    }
  } else if (!jest) {
    notes.push('no jest in this repo — tests skipped');
  }

  // --- 5. divergence from the base branch (warn only) -----------------------
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch && branch !== BASE_BRANCH) {
    const counts = git(root, ['rev-list', '--left-right', '--count', `origin/${BASE_BRANCH}...HEAD`]);
    const [behind] = counts.split(/\s+/).map((n) => parseInt(n, 10) || 0);
    if (behind >= 20) {
      notes.push(
        `this branch is ${behind} commits behind origin/${BASE_BRANCH} — ` +
        `rebase before opening the PR (\`git fetch origin && git rebase origin/${BASE_BRANCH}\`)`
      );
    }
  }

  if (notes.length > 0) warn(`pre-commit-validator: ${notes.join('; ')}.`);
  allow();
});
