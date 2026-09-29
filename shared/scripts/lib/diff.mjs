/**
 * Unified-diff parsing shared by the audit scanners.
 */

/**
 * Lines a `git diff -U0` adds, grouped by file, each with its line number in the new file.
 * Removed lines do not advance the numbering; context lines (none at -U0, but tolerated) do.
 */
export function addedLines(diff) {
  const out = new Map();
  let file = null;
  let n = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const target = line.slice(4).replace(/^b\//, '');
      file = target === '/dev/null' ? null : target;
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      n = Number(hunk[1]);
      continue;
    }
    if (!file) continue;
    if (line.startsWith('+')) {
      if (!out.has(file)) out.set(file, []);
      out.get(file).push({ n, text: line.slice(1) });
      n++;
    } else if (line.startsWith(' ')) {
      n++;
    }
  }
  return out;
}
