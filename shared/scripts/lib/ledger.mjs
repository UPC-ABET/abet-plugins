/**
 * The audit ledger: a durable record of what the security and reuse audits found, and *how*.
 *
 * Two kinds of finding, kept apart on purpose:
 *   mechanical — a rule in `security.mjs` / `clones.mjs` flagged it and the auditor confirmed
 *                it, or dropped it as a false positive (and said why)
 *   judgment   — the auditor found it by reading, and no rule flagged it
 *
 * Judgment findings are the interesting ones. Each carries the code shape (`pattern`), how a
 * machine could detect it (`detect`) and an honest estimate of how convertible that is
 * (`convertible`). After enough audits, `report` shows which judgment findings recur and
 * look convertible — the candidates to become the next mechanical rule — and which
 * mechanical rules are noisy enough to tighten. That is the loop: the model explores, the
 * ledger remembers, and what keeps recurring graduates into code.
 */

export const AREAS = ['security', 'reuse'];
export const SOURCES = ['mechanical', 'judgment'];
export const VERDICTS = ['confirmed', 'false-positive'];
export const SEVERITIES = ['blocker', 'major', 'minor', 'suggestion'];
export const CONVERTIBLE = ['high', 'medium', 'low', 'no'];
export const CATEGORIES = [
  'scope-leak', 'authz', 'authn', 'idor', 'injection', 'secrets', 'crypto', 'data-exposure',
  'file-handling', 'dos', 'ssrf', 'deserialization', 'logging', 'config', 'dependency',
  'race', 'export-injection', 'duplication', 'existing-helper', 'other',
];

const KEYS = new Set(['area', 'source', 'rule', 'category', 'severity', 'verdict', 'file', 'line',
  'summary', 'pattern', 'detect', 'convertible', 'reason']);

const oneOf = (name, value, allowed) => (allowed.includes(value) ? null : `${name} must be one of ${allowed.join(' | ')} (got ${JSON.stringify(value)})`);
const text = (name, value, max) => (typeof value === 'string' && value.trim() ? (value.length > max ? `${name} is longer than ${max} characters` : null) : `${name} is required`);

/** Errors for one record, empty when valid. Messages say what to change: the caller is a model. */
export function validateRecord(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return ['a record must be a JSON object'];
  const errors = [];
  for (const k of Object.keys(r)) if (!KEYS.has(k)) errors.push(`unknown field "${k}" (allowed: ${[...KEYS].join(', ')})`);

  errors.push(oneOf('area', r.area, AREAS), oneOf('source', r.source, SOURCES),
    oneOf('category', r.category, CATEGORIES), oneOf('verdict', r.verdict, VERDICTS));
  errors.push(text('file', r.file, 300), text('summary', r.summary, 300));
  if (r.line !== undefined && !(Number.isInteger(r.line) && r.line >= 1)) errors.push('line must be a positive integer');

  if (r.verdict === 'confirmed') errors.push(oneOf('severity', r.severity, SEVERITIES));
  if (r.verdict === 'false-positive') errors.push(text('reason', r.reason, 300));

  if (r.source === 'mechanical') {
    errors.push(text('rule', r.rule, 80));
  } else if (r.source === 'judgment') {
    if (r.rule !== undefined) errors.push('a judgment finding has no rule — if a rule flagged it, the source is "mechanical"');
    if (r.verdict === 'false-positive') errors.push('only a mechanical hit can be a false positive; do not record a judgment you dropped');
    errors.push(
      text('pattern', r.pattern, 200),
      text('detect', r.detect, 300),
      oneOf('convertible', r.convertible, CONVERTIBLE),
    );
  }
  return errors.filter(Boolean);
}

// ---------------------------------------------------------------------------- report

const STOP = new Set('the a an of to in on for and or with without is are be by from that this it its as at not no any'.split(' '));
const tokens = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9_@.\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
const jaccard = (a, b) => {
  const inter = [...a].filter((x) => b.has(x)).length;
  return inter / (a.size + b.size - inter || 1);
};
const SEVERITY_WEIGHT = { blocker: 8, major: 4, minor: 2, suggestion: 1 };
const CONVERTIBLE_WEIGHT = { high: 3, medium: 2, low: 1, no: 0 };
const worst = (a, b) => (SEVERITY_WEIGHT[a] ?? 0) >= (SEVERITY_WEIGHT[b] ?? 0) ? a : b;

/** How the mechanical rules are doing, from the auditors' verdicts on their hits. */
function ruleStats(records) {
  const byRule = new Map();
  const seen = new Set();
  for (const r of records.filter((x) => x.source === 'mechanical')) {
    // re-auditing one branch records the same hit again; it is one observation, not two
    const key = [r.branch, r.rule, r.file, r.line, r.verdict].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const s = byRule.get(r.rule) ?? { rule: r.rule, area: r.area, confirmed: 0, falsePositive: 0, reasons: [] };
    if (r.verdict === 'confirmed') s.confirmed++;
    else {
      s.falsePositive++;
      s.reasons.push(r.reason);
    }
    byRule.set(r.rule, s);
  }
  return [...byRule.values()].map((s) => {
    const n = s.confirmed + s.falsePositive;
    const precision = s.confirmed / n;
    let advice = 'healthy';
    if (n < 5) advice = 'too few hits to judge';
    else if (precision < 0.5) advice = 'noisy: tighten the rule';
    else if (precision < 0.7) advice = 'watch: a third of its hits are wrong';
    return { ...s, hits: n, precision: Number(precision.toFixed(2)), advice, reasons: [...new Set(s.reasons)].slice(0, 3) };
  }).sort((a, b) => b.hits - a.hits);
}

/** Words that describe a judgment finding's shape: its pattern and, when informative, its detection note. */
const shapeTokens = (r) => tokens(`${r.pattern} ${/^needs judgment$/i.test(r.detect) ? '' : r.detect}`);

/**
 * Cluster judgment findings that describe the same shape in different words. `count` is the
 * number of distinct *changes* it turned up in: re-running an audit on one branch must not
 * make a gap look recurrent, and recurrence across changes is what justifies a rule.
 */
function judgmentGroups(records) {
  const groups = [];
  for (const r of records.filter((x) => x.source === 'judgment' && x.verdict === 'confirmed')) {
    const t = shapeTokens(r);
    const pt = tokens(r.pattern);
    // the better of pattern-only and pattern+detect similarity: the detection note helps two
    // findings that share a mechanism and hurts two that merely word the pattern differently
    const g = groups.find((x) => x.category === r.category && Math.max(jaccard(x.tokens, t), jaccard(x.patternTokens, pt)) >= 0.33);
    const ex = { branch: r.branch, file: r.file, line: r.line, summary: r.summary };
    if (g) {
      g.branches.add(r.branch);
      g.maxSeverity = worst(g.maxSeverity, r.severity);
      g.convertible[r.convertible]++;
      g.detect.add(r.detect);
      if (!g.examples.some((e) => e.file === ex.file && e.line === ex.line && e.branch === ex.branch)) g.examples.push(ex);
      for (const w of t) g.tokens.add(w);
      for (const w of pt) g.patternTokens.add(w);
    } else {
      groups.push({
        category: r.category, pattern: r.pattern, tokens: t, patternTokens: new Set(pt), branches: new Set([r.branch]), maxSeverity: r.severity,
        convertible: { high: 0, medium: 0, low: 0, no: 0, [r.convertible]: 1 },
        detect: new Set([r.detect]), examples: [ex],
      });
    }
  }
  return groups.map((g) => {
    g.count = g.branches.size;
    const bestConv = ['high', 'medium', 'low', 'no'].find((c) => g.convertible[c] > 0);
    const score = g.count * SEVERITY_WEIGHT[g.maxSeverity] * (1 + CONVERTIBLE_WEIGHT[bestConv]);
    const recurring = g.count >= 2 || g.maxSeverity === 'blocker';
    const promote = recurring && (bestConv === 'high' || bestConv === 'medium');
    return {
      category: g.category, pattern: g.pattern, count: g.count, maxSeverity: g.maxSeverity,
      convertible: g.convertible, bestConvertible: bestConv, detect: [...g.detect], score,
      recommendation: promote ? 'promote to a mechanical rule' : recurring ? 'recurring, but hard to detect: keep as judgment' : 'seen once: keep watching',
      examples: g.examples.slice(0, 4),
    };
  }).sort((a, b) => b.score - a.score);
}

export function aggregate(records) {
  const dates = records.map((r) => r.date).filter(Boolean).sort();
  const count = (key) => records.reduce((m, r) => ({ ...m, [r[key]]: (m[r[key]] ?? 0) + 1 }), {});
  return {
    total: records.length,
    bySource: count('source'),
    byLane: records.reduce((m, r) => ({ ...m, [r.lane ?? 'audit']: (m[r.lane ?? 'audit'] ?? 0) + 1 }), {}),
    byVerdict: count('verdict'),
    from: dates[0] ?? null,
    to: dates.at(-1) ?? null,
    branches: new Set(records.map((r) => r.branch).filter(Boolean)).size,
    rules: ruleStats(records),
    judgment: judgmentGroups(records),
  };
}

export function renderReport(a, { malformed = 0 } = {}) {
  const L = [];
  L.push('# Audit ledger — what to turn into code', '');
  L.push(`${a.total} findings across ${a.branches} branch(es), ${a.from ?? '—'} to ${a.to ?? '—'}. ` +
    `Mechanical ${a.bySource.mechanical ?? 0}, judgment ${a.bySource.judgment ?? 0}; ` +
    `own audits ${a.byLane.audit ?? 0}, peer reviews ${a.byLane.review ?? 0}.` + (malformed ? ` (${malformed} malformed line(s) skipped)` : ''), '');

  const promote = a.judgment.filter((g) => g.recommendation.startsWith('promote'));
  L.push(`## Promote to mechanical rules (${promote.length})`, '');
  if (promote.length === 0) L.push('None yet — nothing the auditors found by reading has recurred in a form a rule could catch.', '');
  for (const g of promote) {
    L.push(`### ${g.category}: ${g.pattern}`, `- seen ${g.count}×, worst severity **${g.maxSeverity}**, convertibility ${g.bestConvertible}`);
    for (const d of g.detect) L.push(`- how to detect: ${d}`);
    for (const e of g.examples) L.push(`- e.g. \`${e.file}${e.line ? ':' + e.line : ''}\` (${e.branch ?? '?'}) — ${e.summary}`);
    L.push('');
  }

  const rest = a.judgment.filter((g) => !g.recommendation.startsWith('promote'));
  L.push(`## Found by judgment, not (yet) convertible (${rest.length})`, '');
  for (const g of rest) L.push(`- **${g.category}** ×${g.count} (${g.maxSeverity}, ${g.bestConvertible}): ${g.pattern} — ${g.recommendation}`);
  if (rest.length) L.push('');

  L.push('## Mechanical rules: how often were they right?', '');
  if (a.rules.length === 0) L.push('No mechanical hits recorded.', '');
  else {
    L.push('| Rule | Hits | Confirmed | False positive | Precision | Advice |', '| --- | --- | --- | --- | --- | --- |');
    for (const r of a.rules) L.push(`| ${r.rule} | ${r.hits} | ${r.confirmed} | ${r.falsePositive} | ${Math.round(r.precision * 100)}% | ${r.advice} |`);
    L.push('');
    for (const r of a.rules.filter((x) => x.reasons.length && x.falsePositive)) L.push(`- \`${r.rule}\` false positives: ${r.reasons.join('; ')}`);
  }
  return L.join('\n') + '\n';
}
