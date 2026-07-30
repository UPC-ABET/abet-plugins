#!/usr/bin/env node
/**
 * pre-commit-validator — gates `git commit` on the full quality set.
 *
 *   1. staged secrets                    (blocks)
 *   2. formatting                        (blocks — fix with the repo's format script)
 *   3. lint, warnings included           (blocks)
 *   4. type errors                       (blocks)
 *   5. tests related to the staged files (blocks)
 *   6. divergence from the base branch   (warns; it never rebases for you)
 *
 * Every check is scoped to the staged files where the tool allows it, so the gate stays
 * fast, and every check degrades to a skip when its tool is absent. The same hook
 * therefore works in a repo with a test runner and one without, unconfigured.
 *
 * Note that a git-side hook may auto-fix formatting and fixable lint *after* this runs.
 * This gate still blocks on them: a commit should be clean before it is made, not
 * incidentally repaired on the way through.
 *
 * Env switches:
 *   ABET_SKIP_PRECOMMIT=1   skip the whole hook
 *   ABET_SKIP_FORMAT=1      skip step 2
 *   ABET_SKIP_LINT=1        skip step 3
 *   ABET_SKIP_TYPECHECK=1   skip step 4
 *   ABET_SKIP_TESTS=1       skip step 5
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
const FORMAT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|css|scss|ya?ml)$/;

/** Name of the repo script that fixes a given concern, for the error message. */
function fixHint(pkg, ...candidates) {
  const script = candidates.find((name) => pkg.scripts?.[name]);
  return script ? `pnpm ${script}` : null;
}

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

  const codeFiles = staged.filter((f) => CODE_EXT.test(f) && existsSync(join(root, f)));

  // --- 2. formatting --------------------------------------------------------
  const formatFiles = staged.filter((f) => FORMAT_EXT.test(f) && existsSync(join(root, f)));
  const prettier = resolveTool(root, 'prettier');
  if (process.env.ABET_SKIP_FORMAT !== '1' && prettier && formatFiles.length > 0) {
    const res = runNode(root, prettier, ['--check', '--log-level', 'warn', ...formatFiles], 120_000);
    if (res.timedOut) notes.push('format check timed out — skipped');
    else if (!res.ok) {
      const hint = fixHint(pkg, 'format', 'format:fix', 'check') ?? 'pnpm exec prettier --write <files>';
      deny(
        'pre-commit-validator: these staged files are not formatted.\n\n' +
        `${excerpt(res.out, 15)}\n\n` +
        `Run \`${hint}\`, stage the result, and commit again.`
      );
    }
  } else if (!prettier) {
    notes.push('prettier not installed — format check skipped');
  }

  // --- 3. lint, warnings included -------------------------------------------
  const eslint = resolveTool(root, 'eslint');
  if (process.env.ABET_SKIP_LINT !== '1' && eslint && codeFiles.length > 0) {
    const res = runNode(root, eslint, ['--max-warnings', '0', '--no-warn-ignored', '--format', 'stylish', ...codeFiles]);
    if (res.timedOut) notes.push('lint timed out — skipped');
    else if (!res.ok && res.out) {
      const hint = fixHint(pkg, 'lint:fix', 'lint') ?? 'pnpm exec eslint --fix <files>';
      deny(
        'pre-commit-validator: eslint reports problems in the staged files.\n\n' +
        `${excerpt(res.out)}\n\n` +
        `Warnings count as failures here. Run \`${hint}\` for the fixable ones and resolve the rest.\n` +
        'Do not silence a rule with an inline disable unless you can state why the rule is wrong here.'
      );
    }
  } else if (!eslint) {
    notes.push('eslint not installed — lint skipped');
  }

  // --- 4. typecheck ---------------------------------------------------------
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

  // --- 5. tests related to the staged files ---------------------------------
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

  // --- 6. divergence from the base branch (warn only) -----------------------
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
