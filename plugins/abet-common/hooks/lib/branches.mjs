/**
 * The ABET branch model — single source of truth for every hook and skill.
 *
 * Three long-lived branches, promoted strictly in order by fast-forward only:
 *   develop  -> staging -> production
 *
 * `develop` is the integration branch and the base for every pull request.
 * There is no `main` in these repos; if one is ever added, add it here.
 */
export const PROTECTED_BRANCHES = ['develop', 'staging', 'production'];

/** The base branch every feature and fix PR targets. */
export const BASE_BRANCH = 'develop';

/** Branch-name prefixes the convention allows. */
export const BRANCH_TYPES = ['feat', 'fix', 'chore', 'docs', 'refactor', 'test', 'perf', 'hotfix'];

export const isProtected = (name) => PROTECTED_BRANCHES.includes(name);

/**
 * Strip the type prefix off a branch name to recover the openspec change slug.
 * `feat/bulk-edit-rubric-weights` -> `bulk-edit-rubric-weights`
 * `chore/archive-bulk-edit-rubric-weights` -> `bulk-edit-rubric-weights`
 */
export function slugFromBranch(branch) {
  if (!branch) return '';
  const withoutType = branch.replace(new RegExp(`^(${BRANCH_TYPES.join('|')}|feature|bugfix)/`), '');
  return withoutType.replace(/^archive-/, '');
}
