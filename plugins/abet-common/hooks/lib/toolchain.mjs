/**
 * Locating and running the repo's own toolchain from a hook.
 *
 * Everything here resolves a package's JS entry point and runs it with `node`
 * rather than shelling out to `pnpm exec` or `node_modules/.bin/*`. Two reasons:
 * the .bin shims are `.CMD` files on Windows and need a shell, and the ABET repos
 * live under a path containing a space ("ABET 3.0"), which makes shell quoting a
 * live source of bugs. `execFileSync('node', [absPath, ...])` sidesteps both.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Candidate entry points per tool, first match wins. */
const ENTRIES = {
  eslint: ['node_modules/eslint/bin/eslint.js'],
  prettier: ['node_modules/prettier/bin/prettier.cjs', 'node_modules/prettier/bin-prettier.js'],
  tsc: ['node_modules/typescript/bin/tsc'],
  jest: ['node_modules/jest/bin/jest.js', 'node_modules/jest-cli/bin/jest.js'],
  next: ['node_modules/next/dist/bin/next'],
};

export function resolveTool(root, tool) {
  for (const rel of ENTRIES[tool] ?? []) {
    const abs = join(root, rel);
    if (existsSync(abs)) return abs;
  }
  return null;
}

export function readPackageJson(root) {
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** Run `node <entry> ...args`, capturing output. Never throws. */
export function runNode(root, entry, args, timeout = 240_000) {
  const res = spawnSync(process.execPath, [entry, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', CI: '1' },
  });
  return {
    ok: res.status === 0,
    timedOut: res.error?.code === 'ETIMEDOUT',
    code: res.status,
    out: `${res.stdout ?? ''}${res.stderr ?? ''}`.trim(),
  };
}

/** Run a plain git command, returning stdout or '' on any failure. */
export function git(root, args) {
  const res = spawnSync('git', args, {
    cwd: root, encoding: 'utf8', timeout: 20_000, maxBuffer: 16 * 1024 * 1024,
  });
  return res.status === 0 ? (res.stdout ?? '').trim() : '';
}

/** Walk up from cwd to find the git repository root. */
export function repoRoot(cwd) {
  const top = git(cwd, ['rev-parse', '--show-toplevel']);
  return top || cwd;
}

/** Trim tool output to something readable in a hook message. */
export function excerpt(text, maxLines = 25) {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  if (lines.length <= maxLines) return lines.join('\n');
  return [...lines.slice(0, maxLines), `… (${lines.length - maxLines} more lines)`].join('\n');
}
