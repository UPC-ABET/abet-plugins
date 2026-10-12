/**
 * Where change folders live under openspec/, in-flight and archived.
 *
 *   openspec/changes/<slug>/            in flight
 *   openspec/changes/archive/<slug>/    merged and archived (current layout)
 *   openspec/specs/<slug>/              merged and archived (legacy layout)
 *
 * `archive/` sits inside `changes/`, so anything that lists `changes/` must skip it or it
 * reads the archive as one more change in flight. In the current layout `specs/` holds one
 * `<capability>/spec.md` per capability instead, so a legacy archived change is told apart
 * by having a `proposal.md` and no `spec.md`.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const ARCHIVE_DIR = 'archive';

const subdirs = (base) =>
  existsSync(base) ? readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() : [];

/** True for a slug that names an in-flight change folder that exists. */
export function isInFlight(slug, root = '.') {
  return Boolean(slug) && slug !== ARCHIVE_DIR && existsSync(join(root, 'openspec', 'changes', slug));
}

/** Slugs of every in-flight change: the folders under `changes/`, never `archive/`. */
export function inFlightChanges(root = '.') {
  return subdirs(join(root, 'openspec', 'changes')).filter((d) => d !== ARCHIVE_DIR);
}

/** Paths of every archived change folder: `changes/archive/*`, then legacy `specs/*`. */
export function archivedChanges(root = '.') {
  const archive = join(root, 'openspec', 'changes', ARCHIVE_DIR);
  const legacy = join(root, 'openspec', 'specs');
  return [
    ...subdirs(archive).map((d) => join(archive, d)),
    ...subdirs(legacy)
      .map((d) => join(legacy, d))
      .filter((p) => existsSync(join(p, 'proposal.md')) && !existsSync(join(p, 'spec.md'))),
  ];
}
