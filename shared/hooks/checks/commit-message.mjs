/**
 * The commit-message policy, independent of how the message reached us.
 *
 * Two callers: the Claude Code PreToolUse hook (which pulls the message out of a
 * `git commit -m` command) and the husky `commit-msg` hook (which reads the file git
 * hands it). Same rules, one implementation — a second copy would drift, and a commit
 * rule that differs by which tool you happen to be using is worse than no rule.
 */

export const TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'];

const CONVENTIONAL = new RegExp(`^(${TYPES.join('|')})(\\([a-z0-9][a-z0-9._/-]*\\))?!?: .+$`);

// Not anchored to line start: the single-line rule already rejects the usual
// trailer-on-its-own-line form, so what is left to catch is a trailer folded into
// the subject itself.
const BANNED_TRAILERS = [
  /Co-Authored-By\s*:/i,
  /Claude-Session\s*:/i,
  /Generated with \[?Claude Code/i,
  /🤖 Generated with/i,
];

const fail = (message) => ({ ok: false, level: 'error', message });
const warn = (message) => ({ ok: true, level: 'warn', message });
const pass = () => ({ ok: true, level: 'ok', message: '' });

/**
 * Validate a commit message.
 * Returns `{ ok, level: 'ok' | 'warn' | 'error', message }`.
 *
 * Comment lines are stripped first, so a message read straight from COMMIT_EDITMSG
 * (which git fills with `# ...` guidance) validates the same as one passed via `-m`.
 */
export function validateCommitMessage(raw) {
  const lines = String(raw ?? '')
    .split('\n')
    .filter((l) => !l.startsWith('#'));

  // Trailing blank lines are how an editor leaves a file; they are not a body.
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();

  const subject = (lines[0] ?? '').trim();

  if (subject === '') {
    return fail('The commit message is empty.');
  }

  if (lines.length > 1) {
    return fail(
      'The commit message spans multiple lines.\n' +
      `ABET commits are subject-only — no body. Compress it to one line:\n  ${subject}`
    );
  }

  for (const pattern of BANNED_TRAILERS) {
    if (pattern.test(subject)) {
      return fail(
        'Commit trailers and attribution footers are not used on this project.\n' +
        'Remove the Co-Authored-By / Claude-Session / "Generated with" line and commit the subject alone.'
      );
    }
  }

  if (!CONVENTIONAL.test(subject)) {
    return fail(
      `"${subject}" is not a valid Conventional Commit subject.\n` +
      `Expected \`type(scope): subject\` where type is one of: ${TYPES.join(', ')}.\n` +
      'Examples:\n' +
      '  feat(rubrics): add bulk weight editing\n' +
      '  fix(gra): apply is_active filter to the report query\n' +
      '  chore(openspec): archive bulk-edit-rubric-weights'
    );
  }

  if (subject.length > 100) {
    return fail(
      `The subject is ${subject.length} characters; keep it under 100.\n` +
      'Trim it to the essential change — detail belongs in the PR body and the openspec change.'
    );
  }

  if (subject.length > 72) {
    return warn(`Subject is ${subject.length} characters. Under 72 reads better in \`git log --oneline\`.`);
  }

  return pass();
}
