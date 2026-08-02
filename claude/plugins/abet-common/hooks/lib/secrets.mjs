/**
 * A small, dependency-free secret scanner for staged content.
 *
 * The creai original shelled out to `detect-secrets` (Python). Neither ABET repo
 * has a Python toolchain, so this covers the credential shapes that actually show
 * up here: cloud keys, JWTs, DB URLs with inline passwords, and hardcoded literals
 * assigned to obviously-secret names.
 *
 * Escape hatch: put `abet-allow-secret` in a comment on the same line. Use it for
 * fixtures and examples, never to silence a real credential.
 */

const RULES = [
  { name: 'AWS access key ID', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'private key block', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'JSON Web Token', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'connection string with inline password', re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|mssql|sqlserver):\/\/[^\s:/@]+:[^\s@]{3,}@/ },
  {
    name: 'hardcoded credential literal',
    re: /\b(?:password|passwd|pwd|secret|client_secret|clientSecret|api_?key|apiKey|access_?token|accessToken|private_?key|privateKey|sa_?password)\s*[:=]\s*(['"`])(?!\s*$)(?:(?!\1).){8,}\1/i,
  },
];

/** Values that look like secrets but are placeholders, not credentials. */
const PLACEHOLDER = /\b(?:xxx+|yyy+|zzz+|changeme|your[-_]?\w*|example|placeholder|dummy|fake|sample|redacted|<[^>]+>|\$\{[^}]+\}|process\.env\.)/i;

// Which paths to skip is shared with the format and lint checks — see lib/paths.mjs.
import { isScannable } from './paths.mjs';

export { isScannable };

/**
 * Scan added lines from a unified diff.
 * Returns `[{ file, line, rule, preview }]`.
 */
export function scanDiff(diff) {
  const findings = [];
  let file = '';
  let lineNo = 0;

  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      file = raw.slice(4).replace(/^b\//, '').trim();
      continue;
    }
    if (raw.startsWith('@@')) {
      const m = /\+(\d+)/.exec(raw);
      lineNo = m ? parseInt(m[1], 10) - 1 : 0;
      continue;
    }
    if (!raw.startsWith('+') || raw.startsWith('+++')) continue;

    lineNo++;
    const content = raw.slice(1);
    if (!file || !isScannable(file)) continue;
    if (/abet-allow-secret/.test(content)) continue;
    if (PLACEHOLDER.test(content)) continue;

    for (const rule of RULES) {
      if (rule.re.test(content)) {
        findings.push({
          file,
          line: lineNo,
          rule: rule.name,
          preview: content.trim().slice(0, 120),
        });
        break;
      }
    }
  }
  return findings;
}
