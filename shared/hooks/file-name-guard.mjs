#!/usr/bin/env node
/**
 * file-name-guard — denies creating a file whose name breaks the file-naming standard
 * (see `checks/file-naming.mjs`): a backend `<name>.<kind>.ts` outside its one folder, a
 * retired kind (`.functions.ts`, `.utils.ts`, ...), a backend barrel, or a frontend
 * `*Utils.ts` / `helpers/`.
 *
 * It fires on `Write` only, and only when the target does not exist yet: rewriting a
 * legacy file that already sits outside the vocabulary must not be blocked. Denying at
 * creation is the cheapest place for the correction — the model has not built anything on
 * top of the wrong name yet, so it renames and moves on instead of unpicking imports later.
 */
import { existsSync } from 'node:fs';
import { readInput, deny, allow, run } from './lib/hook.mjs';
import { checkNewFile } from './checks/file-naming.mjs';

run(async () => {
  const input = await readInput();
  if (input?.tool_name !== 'Write') allow();

  const path = input?.tool_input?.file_path;
  if (typeof path !== 'string' || existsSync(path)) allow();

  const content = input?.tool_input?.content;
  const problem = checkNewFile(path, typeof content === 'string' ? content : null);
  if (problem) {
    deny(
      `file-name-guard: ${problem}\n` +
      'Create the file under a name that follows the convention. If a new kind of file is ' +
      'genuinely needed, that is a change to the repo POLICIES, `rules/backend.md` (or ' +
      '`rules/frontend.md`) and `checks/file-naming.mjs`, not something to decide per file.'
    );
  }
  allow();
});
