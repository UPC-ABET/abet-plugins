/**
 * The pre-commit quality gate, independent of what triggered it.
 *
 * Two callers: the Claude Code PreToolUse hook (before a `git commit` tool call) and the
 * husky `pre-commit` hook (before git's own commit). Neither needs the command string —
 * the checks look at the staged tree — so the whole gate lives here and both entry points
 * are thin.
 *
 * Returns `{ ok, message, notes }`. `ok: false` means block, with `message` explaining why.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_BRANCH } from '../lib/branches.mjs';
import { resolveTool, readPackageJson, runNode, git, excerpt } from '../lib/toolchain.mjs';
import { scanDiff } from '../lib/secrets.mjs';

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const FORMAT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|css|scss|ya?ml)$/;

/** Name of the repo script that fixes a given concern, for the error message. */
function fixHint(pkg, ...candidates) {
  const script = candidates.find((name) => pkg.scripts?.[name]);
  return script ? `pnpm ${script}` : null;
}

const block = (message) => ({ ok: false, message, notes: [] });

export function runPreCommitChecks(root, env = process.env) {
  const notes = [];
  const done = () => ({ ok: true, message: '', notes });

  if (env.ABET_SKIP_PRECOMMIT === '1') return done();

  const pkg = readPackageJson(root);
  if (!pkg) return done(); // not a Node project — nothing this gate knows how to check

  const staged = git(root, ['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
    .split('\n').map((s) => s.trim()).filter(Boolean);
  if (staged.length === 0) return done(); // amend, or nothing staged yet

  // --- 1. staged secrets ----------------------------------------------------
  const secrets = scanDiff(git(root, ['diff', '--cached', '--unified=0']));
  if (secrets.length > 0) {
    const list = secrets.slice(0, 10)
      .map((f) => `  ${f.file}:${f.line} — ${f.rule}\n    ${f.preview}`).join('\n');
    return block(
      `${secrets.length} possible secret(s) in the staged changes.\n${list}\n\n` +
      'Move the value to an environment variable and reference it through the config service. ' +
      'If this is genuinely a fixture or example, add an `abet-allow-secret` comment on that line.'
    );
  }

  const codeFiles = staged.filter((f) => CODE_EXT.test(f) && existsSync(join(root, f)));

  // --- 2. formatting --------------------------------------------------------
  const formatFiles = staged.filter((f) => FORMAT_EXT.test(f) && existsSync(join(root, f)));
  const prettier = resolveTool(root, 'prettier');
  if (env.ABET_SKIP_FORMAT !== '1' && prettier && formatFiles.length > 0) {
    const res = runNode(root, prettier, ['--check', '--log-level', 'warn', ...formatFiles], 120_000);
    if (res.timedOut) notes.push('format check timed out — skipped');
    else if (!res.ok) {
      const hint = fixHint(pkg, 'format', 'format:fix', 'check') ?? 'pnpm exec prettier --write <files>';
      return block(
        `These staged files are not formatted.\n\n${excerpt(res.out, 15)}\n\n` +
        `Run \`${hint}\`, stage the result, and commit again.`
      );
    }
  } else if (!prettier) {
    notes.push('prettier not installed — format check skipped');
  }

  // --- 3. lint, warnings included -------------------------------------------
  const eslint = resolveTool(root, 'eslint');
  if (env.ABET_SKIP_LINT !== '1' && eslint && codeFiles.length > 0) {
    const res = runNode(root, eslint, ['--max-warnings', '0', '--no-warn-ignored', '--format', 'stylish', ...codeFiles]);
    if (res.timedOut) notes.push('lint timed out — skipped');
    else if (!res.ok && res.out) {
      const hint = fixHint(pkg, 'lint:fix', 'lint') ?? 'pnpm exec eslint --fix <files>';
      return block(
        `eslint reports problems in the staged files.\n\n${excerpt(res.out)}\n\n` +
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
  if (env.ABET_SKIP_TYPECHECK !== '1' && tsc && tsconfig && codeFiles.some((f) => /\.tsx?$/.test(f))) {
    const res = runNode(root, tsc, ['--noEmit', '-p', tsconfig], 300_000);
    if (res.timedOut) notes.push('typecheck timed out — skipped');
    else if (!res.ok) {
      return block(
        `\`tsc --noEmit -p ${tsconfig}\` failed.\n\n${excerpt(res.out)}\n\n` +
        'The build will not pass with these errors. Fix them, or stage the fix alongside.'
      );
    }
  }

  // --- 5. tests related to the staged files ---------------------------------
  const jest = resolveTool(root, 'jest');
  if (env.ABET_SKIP_TESTS !== '1' && jest && codeFiles.length > 0) {
    const full = env.ABET_FULL_TESTS === '1';
    const args = full
      ? ['--silent', '--ci', '--passWithNoTests']
      : ['--silent', '--ci', '--passWithNoTests', '--findRelatedTests', ...codeFiles];
    const res = runNode(root, jest, args, 420_000);
    if (res.timedOut) notes.push('tests timed out — skipped');
    else if (!res.ok) {
      return block(
        `${full ? 'The test suite' : 'Tests related to the staged files'} failed.\n\n` +
        `${excerpt(res.out, 30)}\n\n` +
        'Green tests are the gate for a commit. Fix the failure, or stage the test change with it.'
      );
    }
  } else if (!jest) {
    notes.push('no jest in this repo — tests skipped');
  }

  // --- 6. divergence from the base branch (note only) -----------------------
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

  return done();
}
