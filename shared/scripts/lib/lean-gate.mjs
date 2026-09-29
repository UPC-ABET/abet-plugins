/**
 * The eligibility gate for the quick lane.
 *
 * The full pipeline (define → design → implement) exists because a wrong turn is expensive
 * for some changes. The quick lane is for the changes where it is not — and "is this one of
 * them?" must not be the model's mood. This reads the plan the model just wrote
 * (`proposal.md`, `tasks.md`) and answers from facts: how many tasks and files, which
 * paths, which package, whether a question is still open, whether the ADR gate tripped.
 *
 * Any reason means the change goes through the full lane. The bounds are deliberately tight:
 * a change that outgrows them was never small, and the cost of sending it to the full lane
 * is one design pass, while the cost of wrongly keeping it here is a design nobody reviewed.
 */

/**
 * Calibrated on this codebase, not on a round number: one endpoint in the layered module
 * convention is a controller, service, repository, validation, DTOs, Swagger and routes file —
 * seven source files for a change that is small by any other measure. Docs, the generated
 * `openapi.json` and tests follow from the change and are not counted against it.
 */
export const BOUNDS = { tasks: 5, sourceFiles: 8, files: 16 };

/** Paths whose mere presence in the plan means the change is structural or operational. */
const NEVER_QUICK = [
  { re: /(^|\/)migrations\//, why: 'a database migration (schema changes are ADR territory and irreversible in production)' },
  { re: /(^|\/)(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|Dockerfile)$/, why: 'a dependency or image change' },
  { re: /(^|\/)(docker|\.github|\.husky)\//, why: 'deploy or CI configuration' },
  { re: /(^|\/)docs\/(POLICIES\.md|adr\/)/, why: 'the team rulebook or an ADR, which only a human changes' },
];

const TEST = /\.(spec|test)\.[jt]sx?$/;
/** Follows from the change rather than being it: docs, the runbook, the regenerated API spec. */
const CONSEQUENCE = /(^|\/)(docs|openspec)\/|\.md$|(^|\/)openapi\.json$/;
const NO_ANSWER = /^(none|n\/a|—|-|_none_|no open questions?\.?)$/i;

/** Backticked paths listed as `path` (modify|create|new|test|delete), as tasks.md's Files blocks do. */
export function plannedFiles(tasks) {
  const files = new Map();
  for (const line of tasks.split('\n')) {
    const m = /^\s*[-*]\s+`([^`]+\/[^`]+)`\s*(?:\(([^)]*)\))?/.exec(line);
    if (m) files.set(m[1], (m[2] ?? '').toLowerCase());
  }
  return files;
}

/** Text under `## Open questions`, minus blanks, comments and "None". */
export function openQuestions(proposal) {
  const m = /^## Open questions[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(proposal);
  if (!m) return [];
  const lines = m[1].replace(/<!--[\s\S]*?-->/g, '').split('\n');
  // Count list items, not lines: a question that wraps over three lines is one question.
  const items = lines.filter((l) => /^\s*([-*]|\d+[.)])\s+\S/.test(l)).map((l) => l.replace(/^\s*([-*]|\d+[.)])\s+/, '').trim());
  if (items.length > 0) return items.filter((l) => !NO_ANSWER.test(l));
  // No list: any prose that is not "None" is an open question (tables and code are not questions)
  const prose = lines.map((l) => l.trim()).filter((l) => l && !/^(\||```)/.test(l) && !NO_ANSWER.test(l));
  return prose.length > 0 ? [prose.join(' ')] : [];
}

/** ADR-gate rows answered "Yes" (a table row whose second cell starts with Yes). */
export function adrHits(...docs) {
  return docs.flatMap((d) => d.split('\n')
    .filter((l) => /^\|[^|]+\|\s*\**\s*yes\b/i.test(l) && !/^\|\s*-/.test(l))
    .map((l) => l.split('|')[1].trim()));
}

/**
 * The filled rows of the proposal's `## Scope check` table, or `null` when there is no such
 * section. A row is `| table | scoped by | shared across schools? | covered by |`; the template's
 * blank row (no table name) does not count.
 */
export function scopeCheckRows(proposal) {
  const m = /^## Scope check[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(proposal);
  if (!m) return null;
  return m[1].split('\n')
    .filter((l) => /^\|/.test(l) && !/^\|\s*:?-/.test(l) && !/^\|\s*Table\s*\|/i.test(l))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
    .filter((cells) => cells[0]);
}

/**
 * Why a plan's Scope check is not good enough, or nothing. Required whenever the change reads
 * or aggregates data (it plans a repository or service file). It exists because a quick plan
 * reads one module and can miss that a row is shared across schools; a count over such rows
 * is another school's data leaking as a number, and no later gate reliably sees it.
 */
export function scopeCheckProblems(proposal, readsData) {
  if (!readsData) return [];
  const rows = scopeCheckRows(proposal);
  if (rows === null) return ['proposal.md has no "## Scope check": every table the change reads or counts needs a row saying whether its rows can be shared across schools'];
  if (rows.length === 0) return ['the Scope check has no filled rows'];
  const out = [];
  for (const [table, scopedBy, shared, covered] of rows) {
    if (!scopedBy || !shared) out.push(`Scope check row for ${table} is incomplete: say how the school reaches it and whether it can be shared`);
    else if (/^\**\s*(yes|can|shared)/i.test(shared) && !/AC-\d+/i.test(covered ?? '')) {
      out.push(`${table} can be shared across schools but no acceptance criterion covers it (fill "Covered by" with the AC)`);
    }
  }
  return out;
}

export function checkLean({ proposal, tasks }) {
  const reasons = [];
  const files = plannedFiles(tasks);
  const allPaths = [...files.keys()];
  const paths = allPaths.filter((p) => !CONSEQUENCE.test(p));
  const source = paths.filter((p) => !TEST.test(p));
  const taskCount = (tasks.match(/^- \[[ xX]\] Task complete/gm) ?? []).length;

  if (taskCount === 0) reasons.push('tasks.md has no `- [ ] Task complete` boxes: nothing for the audit gate to count');
  if (taskCount > BOUNDS.tasks) reasons.push(`${taskCount} tasks (the quick lane takes at most ${BOUNDS.tasks})`);
  if (source.length > BOUNDS.sourceFiles) reasons.push(`${source.length} source files (at most ${BOUNDS.sourceFiles}, tests not counted)`);
  if (paths.length > BOUNDS.files) reasons.push(`${paths.length} files in total (at most ${BOUNDS.files})`);
  if (source.length === 0) reasons.push('no source files listed: tasks.md must name the files each task touches');

  const packages = new Set(paths.map((p) => /^(backend|frontend)\//.exec(p)?.[1]).filter(Boolean));
  if (packages.size > 1) reasons.push('touches both backend and frontend');

  for (const p of allPaths) { // the rulebook and ADRs are docs, but never the quick lane's to touch
    for (const n of NEVER_QUICK) if (n.re.test(p)) reasons.push(`plans to touch ${p}: ${n.why}`);
    if (/\.module\.ts$/.test(p) && /create|new/.test(files.get(p))) reasons.push(`creates ${p}: a new module is a structural decision`);
  }

  const questions = openQuestions(proposal);
  if (questions.length > 0) reasons.push(`${questions.length} open question(s) in proposal.md — a product decision is not the quick lane's to make`);

  reasons.push(...scopeCheckProblems(proposal, source.some((p) => /\.(repository|service)\.ts$/.test(p))));

  const hits = adrHits(proposal, tasks);
  if (hits.length > 0) reasons.push(`the ADR gate tripped (${hits.join('; ')}): it needs /abet-adr and the full lane`);

  return {
    eligible: reasons.length === 0,
    reasons,
    stats: { tasks: taskCount, sourceFiles: source.length, files: paths.length, packages: [...packages] },
  };
}
