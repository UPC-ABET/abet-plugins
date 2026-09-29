/**
 * Is this module the script node was started with?
 *
 * The CLIs run `main()` only when invoked directly, so tests can import their pure functions
 * without side effects. The obvious check — `import.meta.url === pathToFileURL(argv[1])` —
 * is wrong exactly where these scripts live: pnpm installs `node_modules/abet-plugins` as a
 * link into `.pnpm/`, node resolves `import.meta.url` to the real path but leaves `argv[1]`
 * as the link path the caller typed, and the two never match. The script then exits without
 * printing a byte, which looks like "cannot run the script". Comparing real paths fixes it.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function isMain(metaUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return realpathSync.native(argv1) === realpathSync.native(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}
