/**
 * The pre-commit quality gate, independent of what triggered it.
 *
 * Two callers: the Claude Code PreToolUse hook (before a `git commit` tool call) and the
 * husky `pre-commit` hook (before git's own commit). Neither needs the command string —
 * the checks look at the staged tree — so the whole gate lives here and both entry points
 * are thin.
 *
 * The consuming repo may be a single package or a pnpm/npm/yarn workspace (e.g.
 * `backend` + `frontend`, each with its own toolchain and tsconfig). Secrets are scanned
 * once across the whole staged diff; everything else is resolved and run per package —
 * staged files are grouped by the package they live under (`lib/workspace.mjs`), and each
 * group's prettier/eslint/tsc/jest is resolved from *that* package's `node_modules`, run
 * with that package as `cwd`. Files outside every package (root-level config, `docker/`,
 * `.github/`) form a "root" group that only ever gets a prettier check — never
 * eslint/tsc/jest — once the repo is a real workspace, since those tools have no single
 * well-defined root to run against in that shape. A single-package repo has exactly one
 * package (root itself), so it keeps getting the full pipeline exactly as before.
 *
 * Returns `{ ok, message, notes }`. `ok: false` means block, with `message` explaining why.
 */
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { BASE_BRANCH } from '../lib/branches.mjs';
import { isAuthored } from '../lib/paths.mjs';
import { resolveTool, readPackageJson, runNode, git, excerpt } from '../lib/toolchain.mjs';
import { findWorkspacePackages, packageFor } from '../lib/workspace.mjs';
import { scanDiff } from '../lib/secrets.mjs';
import { checkNewFiles } from './file-naming.mjs';

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const FORMAT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|css|scss|ya?ml)$/;
const TS_EXT = /\.tsx?$/;

/** `backend`/`frontend`-style label (dir relative to root), or `root`. */
function labelFor(root, pkgDir) {
  if (pkgDir === root) return 'root';
  return relative(root, pkgDir).replace(/\\/g, '/');
}

/** A root-relative staged path, rewritten relative to `pkgDir` for use as a tool arg. */
function toPkgRelative(root, pkgDir, fileRelToRoot) {
  if (pkgDir === root) return fileRelToRoot;
  const pkgRelToRoot = relative(root, pkgDir).replace(/\\/g, '/');
  return fileRelToRoot.slice(pkgRelToRoot.length + 1);
}

/**
 * Name of the repo script that fixes a given concern, for the error message. Points at
 * the package it applies to: `pnpm --filter ./<pkg> run <script>` for a real package,
 * `pnpm run <script>` at the root.
 */
function fixHint(label, pkg, ...candidates) {
  const script = candidates.find((name) => pkg.scripts?.[name]);
  if (!script) return null;
  return label === 'root' ? `pnpm run ${script}` : `pnpm --filter ./${label} run ${script}`;
}

const block = (message) => ({ ok: false, message, notes: [] });

export function runPreCommitChecks(root, env = process.env) {
  const notes = [];
  const done = () => ({ ok: true, message: '', notes });

  if (env.ABET_SKIP_PRECOMMIT === '1') return done();

  const rootPkg = readPackageJson(root);
  if (!rootPkg) return done(); // not a Node project — nothing this gate knows how to check

  const staged = git(root, ['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
    .split('\n').map((s) => s.trim()).filter(Boolean);
  if (staged.length === 0) return done(); // amend, or nothing staged yet

  // --- 1. staged secrets, whole diff, whole repo -----------------------------
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

  // --- 1b. naming of newly added module files ---------------------------------
  // Added files only: legacy files that predate the `<name>.<kind>.ts` vocabulary must
  // not block every commit that happens to touch them.
  if (env.ABET_SKIP_NAMING !== '1') {
    const added = git(root, ['diff', '--cached', '--name-only', '--diff-filter=A'])
      .split('\n').map((s) => s.trim()).filter(Boolean);
    const misnamed = checkNewFiles(added);
    if (misnamed.length > 0) {
      const list = misnamed.slice(0, 10).map((m) => `  ${m.path}\n    ${m.problem}`).join('\n');
      return block(
        `${misnamed.length} new file(s) break the module file-naming convention.\n${list}\n\n` +
        'Rename them (`git mv`), stage the result, and commit again.'
      );
    }
  }

  // --- 2. group staged files by the package they live under -------------------
  const workspacePackages = findWorkspacePackages(root);
  const isMonorepo = !(workspacePackages.length === 1 && workspacePackages[0] === root);

  const groups = new Map(); // absolute pkgDir -> root-relative staged files
  for (const f of staged) {
    const pkgDir = packageFor(root, workspacePackages, f);
    if (!groups.has(pkgDir)) groups.set(pkgDir, []);
    groups.get(pkgDir).push(f);
  }

  const groupInfo = [...groups.keys()]
    .sort((a, b) => {
      if (a === root) return 1;
      if (b === root) return -1;
      return labelFor(root, a).localeCompare(labelFor(root, b));
    })
    .map((pkgDir) => {
      const files = groups.get(pkgDir);
      // Generated files (lockfiles, build output, the exported OpenAPI spec) are excluded
      // from both lint and format: nobody authored them, no repo `format` script targets
      // them, and rewriting a lockfile to satisfy a formatter can break the package manager.
      const formatFiles = files.filter((f) => FORMAT_EXT.test(f) && isAuthored(f) && existsSync(join(root, f)));
      const codeFiles = files.filter((f) => CODE_EXT.test(f) && isAuthored(f) && existsSync(join(root, f)));
      return {
        pkgDir,
        label: labelFor(root, pkgDir),
        pkg: pkgDir === root ? rootPkg : (readPackageJson(pkgDir) ?? {}),
        formatFiles,
        codeFiles,
        // Once the repo is a real workspace, the "root" bucket is leftover files that
        // belong to no package (docker/, .github/, root-level json) — there's no single
        // toolchain to run eslint/tsc/jest against for those, only formatting.
        restricted: isMonorepo && pkgDir === root,
      };
    });

  // Every phase below runs its check for *every* applicable group first — a failure in
  // one package does not skip the tool run for the others — and only blocks once all
  // groups for that phase have had their turn, so a commit touching both `backend` and
  // `frontend` always exercises both before either can fail the commit.
  const phaseFailures = [];

  // --- 3. formatting ----------------------------------------------------------
  if (env.ABET_SKIP_FORMAT !== '1') {
    for (const g of groupInfo) {
      if (g.formatFiles.length === 0) continue;
      const prettier = resolveTool(g.pkgDir, 'prettier');
      if (!prettier) {
        notes.push(`${g.label}: prettier not installed — format check skipped`);
        continue;
      }
      const args = g.formatFiles.map((f) => toPkgRelative(root, g.pkgDir, f));
      const res = runNode(g.pkgDir, prettier, ['--check', '--log-level', 'warn', ...args], 120_000);
      if (res.timedOut) {
        notes.push(`${g.label}: format check timed out — skipped`);
      } else if (!res.ok) {
        const hint = fixHint(g.label, g.pkg, 'format', 'format:fix', 'check')
          ?? (g.label === 'root' ? 'pnpm exec prettier --write <files>' : `pnpm --filter ./${g.label} exec prettier --write <files>`);
        phaseFailures.push(
          `${g.label}: These staged files are not formatted.\n\n${excerpt(res.out, 15)}\n\n` +
          `Run \`${hint}\`, stage the result, and commit again.`
        );
      }
    }
  }
  if (phaseFailures.length > 0) return block(phaseFailures.join('\n\n---\n\n'));

  // --- 4. lint, warnings included ----------------------------------------------
  if (env.ABET_SKIP_LINT !== '1') {
    for (const g of groupInfo) {
      if (g.restricted || g.codeFiles.length === 0) continue;
      const eslint = resolveTool(g.pkgDir, 'eslint');
      if (!eslint) {
        notes.push(`${g.label}: eslint not installed — lint skipped`);
        continue;
      }
      const args = g.codeFiles.map((f) => toPkgRelative(root, g.pkgDir, f));
      const res = runNode(g.pkgDir, eslint, ['--max-warnings', '0', '--no-warn-ignored', '--format', 'stylish', ...args]);
      if (res.timedOut) {
        notes.push(`${g.label}: lint timed out — skipped`);
      } else if (!res.ok && res.out) {
        const hint = fixHint(g.label, g.pkg, 'lint:fix', 'lint')
          ?? (g.label === 'root' ? 'pnpm exec eslint --fix <files>' : `pnpm --filter ./${g.label} exec eslint --fix <files>`);
        phaseFailures.push(
          `${g.label}: eslint reports problems in the staged files.\n\n${excerpt(res.out)}\n\n` +
          `Warnings count as failures here. Run \`${hint}\` for the fixable ones and resolve the rest.\n` +
          'Do not silence a rule with an inline disable unless you can state why the rule is wrong here.'
        );
      }
    }
  }
  if (phaseFailures.length > 0) return block(phaseFailures.join('\n\n---\n\n'));

  // --- 5. typecheck --------------------------------------------------------------
  if (env.ABET_SKIP_TYPECHECK !== '1') {
    for (const g of groupInfo) {
      if (g.restricted || !g.codeFiles.some((f) => TS_EXT.test(f))) continue;
      const tsc = resolveTool(g.pkgDir, 'tsc');
      const tsconfig = ['tsconfig.build.json', 'tsconfig.json'].find((f) => existsSync(join(g.pkgDir, f)));
      if (!tsc || !tsconfig) {
        notes.push(`${g.label}: typecheck skipped — no tsc/tsconfig`);
        continue;
      }
      const res = runNode(g.pkgDir, tsc, ['--noEmit', '-p', tsconfig], 300_000);
      if (res.timedOut) {
        notes.push(`${g.label}: typecheck timed out — skipped`);
      } else if (!res.ok) {
        phaseFailures.push(
          `${g.label}: \`tsc --noEmit -p ${tsconfig}\` failed.\n\n${excerpt(res.out)}\n\n` +
          'The build will not pass with these errors. Fix them, or stage the fix alongside.'
        );
      }
    }
  }
  if (phaseFailures.length > 0) return block(phaseFailures.join('\n\n---\n\n'));

  // --- 6. tests related to the staged files -------------------------------------
  if (env.ABET_SKIP_TESTS !== '1') {
    for (const g of groupInfo) {
      if (g.restricted || g.codeFiles.length === 0) continue;
      const jest = resolveTool(g.pkgDir, 'jest');
      if (!jest) {
        notes.push(`${g.label}: no jest in this package — tests skipped`);
        continue;
      }
      const full = env.ABET_FULL_TESTS === '1';
      const args = full
        ? ['--silent', '--ci', '--passWithNoTests']
        : ['--silent', '--ci', '--passWithNoTests', '--findRelatedTests', ...g.codeFiles.map((f) => toPkgRelative(root, g.pkgDir, f))];
      const res = runNode(g.pkgDir, jest, args, 420_000);
      if (res.timedOut) {
        notes.push(`${g.label}: tests timed out — skipped`);
      } else if (!res.ok) {
        phaseFailures.push(
          `${g.label}: ${full ? 'The test suite' : 'Tests related to the staged files'} failed.\n\n` +
          `${excerpt(res.out, 30)}\n\n` +
          'Green tests are the gate for a commit. Fix the failure, or stage the test change with it.'
        );
      }
    }
  }
  if (phaseFailures.length > 0) return block(phaseFailures.join('\n\n---\n\n'));

  // --- 7. divergence from the base branch (note only) -----------------------
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
