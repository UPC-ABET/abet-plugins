#!/usr/bin/env node
/**
 * audit-ledger — record what the security and reuse audits find, and report what to promote.
 *
 *   echo '<json record or array>' | node audit-ledger.mjs add
 *   echo '<json record or array>' | node audit-ledger.mjs add --lane review --pr 123
 *   node audit-ledger.mjs report [--json]
 *   node audit-ledger.mjs path
 *
 * `add` validates every record before writing any, and says exactly what is wrong, so a model
 * that gets a field wrong fixes it instead of leaving a corrupt file. It is the only thing the
 * read-only audit is allowed to write. Records live with the change they came from
 * (`openspec/changes/<slug>/audit.jsonl`, archived along with it) or, on the bug lane with no
 * change folder, in `openspec/audit-ledger/<slug>.jsonl`. `report` reads them all.
 *
 * See lib/ledger.mjs for the schema and for why judgment findings carry a `detect` note.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMain } from './lib/is-main.mjs';
import { aggregate, renderReport, validateRecord } from './lib/ledger.mjs';

const git = (args) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

/**
 * Where records go. A self-audit writes beside the change it audits. A review is of someone
 * else's branch, so it must not write into that change's folder: it gets its own file per PR.
 */
export function ledgerPath(branch, root = '.', { lane = 'audit', pr } = {}) {
  if (lane === 'review') return join(root, 'openspec', 'audit-ledger', `review-${pr}.jsonl`);
  const slug = (branch.includes('/') ? branch.slice(branch.indexOf('/') + 1) : branch).replace(/[^\w.-]+/g, '-') || 'unknown';
  const change = join(root, 'openspec', 'changes', slug);
  return existsSync(change) ? join(change, 'audit.jsonl') : join(root, 'openspec', 'audit-ledger', `${slug}.jsonl`);
}

/** Every ledger file under openspec/: live changes, archived specs, and the bug-lane ledger. */
export function ledgerFiles(root = '.') {
  const out = [];
  const openspec = join(root, 'openspec');
  for (const dir of ['changes', 'specs']) {
    const base = join(openspec, dir);
    if (!existsSync(base)) continue;
    for (const d of readdirSync(base, { withFileTypes: true })) {
      const f = join(base, d.name, 'audit.jsonl');
      if (d.isDirectory() && existsSync(f)) out.push(f);
    }
  }
  const lane = join(openspec, 'audit-ledger');
  if (existsSync(lane)) for (const f of readdirSync(lane)) if (f.endsWith('.jsonl')) out.push(join(lane, f));
  return out;
}

export function readLedger(root = '.') {
  const records = [];
  let malformed = 0;
  for (const file of ledgerFiles(root)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line));
      } catch {
        malformed++;
      }
    }
  }
  return { records, malformed };
}

/** `--name value` from an argument list, or undefined. */
const optionValue = (args, name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  if (command === 'add') {
    let input;
    try {
      input = JSON.parse(await readStdin());
    } catch (e) {
      console.error(JSON.stringify({ ok: false, errors: [`stdin is not valid JSON: ${e.message}`] }));
      process.exit(1);
    }
    const records = Array.isArray(input) ? input : [input];
    const lane = optionValue(rest, '--lane') ?? 'audit';
    const pr = optionValue(rest, '--pr');
    const setup = [
      ...(['audit', 'review'].includes(lane) ? [] : [`--lane must be audit or review (got ${lane})`]),
      ...(lane === 'review' && !/^\d+$/.test(pr ?? '') ? ['--lane review needs --pr <number>, the pull request being reviewed'] : []),
    ];
    const problems = [...setup, ...records.flatMap((r, i) => validateRecord(r).map((e) => `record ${i + 1}: ${e}`))];
    if (problems.length > 0) {
      console.error(JSON.stringify({ ok: false, errors: problems }, null, 2));
      process.exit(1); // nothing is written unless every record is valid
    }
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
    const sha = git(['rev-parse', '--short', 'HEAD']);
    const date = new Date().toISOString().slice(0, 10);
    const file = ledgerPath(branch, '.', { lane, pr });
    mkdirSync(join(file, '..'), { recursive: true });
    const stamp = lane === 'review' ? { lane, pr: Number(pr) } : { lane };
    appendFileSync(file, records.map((r) => JSON.stringify({ v: 1, date, branch, sha, ...stamp, ...r })).join('\n') + '\n');
    console.log(JSON.stringify({ ok: true, appended: records.length, path: file.replace(/\\/g, '/') }));
  } else if (command === 'report') {
    const { records, malformed } = readLedger();
    const agg = aggregate(records);
    console.log(rest.includes('--json') ? JSON.stringify({ ...agg, malformed }, null, 2) : renderReport(agg, { malformed }));
  } else if (command === 'path') {
    console.log(ledgerPath(git(['rev-parse', '--abbrev-ref', 'HEAD'])).replace(/\\/g, '/'));
  } else {
    console.error('usage: audit-ledger.mjs <add [--lane review --pr N]|report [--json]|path>');
    process.exit(2);
  }
}

if (isMain(import.meta.url)) await main();
