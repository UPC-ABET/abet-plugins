# Define a task

This is the head of the pipeline. ABET has no ticket system, so the change folder *is*
the tracker and `proposal.md` *is* the ticket. Everything downstream reads it.

Your job is to interrogate a vague request until the acceptance criteria are sharp
enough that someone else could implement it and someone else again could verify it.

## When not to use this

- **A one-shot defect** — reproduce, fix, regression test. Use `/abet-fix`.
- **A change folder already exists for this work** — go straight to `/abet-design-feature`.

## Steps

### 1. Read the ground truth first

Before asking the requester anything, read what the repo already tells you:

- `docs/POLICIES.md` — the repo-wide mandatory rules this change must respect. Read in full.
- `backend/docs/POLICIES.md` and/or `frontend/docs/POLICIES.md` — whichever package(s) the
  request looks like it touches. Read in full: they hold every convention the change must
  respect, and a section you skipped is one the proposal can quietly contradict.
- `docs/CONTEXT.md` — repo-wide topology: server, environments, deploy pipeline, CI. Small
  enough to read. The packages' `CONTEXT.md` files are not (the backend's is ~100KB):
  search them for the terms the request involves instead of reading them whole.
- `docs/adr/` — index the titles; note any cross-cutting ADR that touches this area.
- `openspec/specs/` — list the capability folders and decide which capabilities the
  request touches; those become the **Specs affected** line. Then read
  `openspec/specs/<capability>/spec.md` **in full** for each one. It is the current truth
  about what the capability does and which rules it must keep, so "What already exists"
  starts from it, not from an archived change. If a capability has no spec yet (or the
  repo still uses the legacy layout, where `openspec/specs/` holds archived change folders
  with a `proposal.md` and no `spec.md`), say so and work from the code.
- `openspec/changes/archive/` (legacy: `openspec/specs/<slug>/`) — only when a spec links
  to a past change and you need the reasoning behind that specific decision. An archived
  change is history: never quote it as current behaviour, because a later change may have
  superseded it.

Then read the actual code the request implicates. You cannot write "What already
exists" from imagination, and where the code and a spec disagree, say so — the code is
what runs, and the stale spec is a finding for the next archive.

### 2. Derive the slug

Plain kebab-case, 3–6 words, naming the thing rather than the action:
`bulk-edit-rubric-weights`, not `add-bulk-editing-feature`.

Check for collisions against in-flight changes (`openspec/changes/<slug>/`) and archived
ones (`openspec/changes/archive/<slug>/`, or legacy `openspec/specs/<slug>/`). A slug
that is already archived means this is likely an extension of prior work — say so, and
link it. Never use `archive` as a slug.

### 3. Interrogate the request

Work through each of these. Where the answer is already unambiguous from the request or
the code, note it and move on; do not perform an interview for its own sake.

| Field | What you are trying to pin down |
| --- | --- |
| Problem | What is wrong today, for whom, and what does it cost them? Not "we need feature X." |
| What already exists | Which modules, endpoints, entities and screens are in play. Most ABET stories are additive, not new construction. |
| Goals | What must be true when this is done. |
| Non-goals | What is explicitly out of scope, so review does not drift into it. |
| Acceptance criteria | Testable Given/When/Then. Each one must be verifiable by a human or a test. |
| Packages affected | Backend only, frontend only, or both. This decides the `## Backend`/`## Frontend` sectioning in design. |
| Specs affected | The capabilities (`openspec/specs/<capability>/`) whose behaviour or rules this change alters or adds to — existing names where one fits, a proposed new kebab-case name otherwise — or `none`. `/abet-archive` updates exactly these after merge. |
| Scope | For every table the change reads, joins or aggregates: how the caller's school reaches those rows, and whether one row or group can belong to **several** schools (a section under programs of two schools). An aggregate over a shared table must count only the caller's school's rows, and that case gets its own AC. Filled into the proposal's **Scope check** table. |
| Dependencies | Other changes, data migrations, external systems (Banner, uPlanner, Azure, S3). |
| Risks | What could break, what is uncertain, what has bitten us here before. |

### 4. The ambiguity gate — stop here if it fails

**Never fabricate an acceptance criterion.** If you cannot write an AC that is testable
without inventing a product decision, you do not have enough information.

When that happens: write out what you *do* know, list the open questions under
**Questions for the requester**, and **stop**. Do not create the change folder. Do not
proceed to design. A proposal built on guessed ACs produces a PR nobody can review
against, and the guess only surfaces at merge time.

Ambiguity that must escalate rather than be resolved by you:
- Any question of what the product *should* do, as opposed to how it should be built.
- Anything that contradicts `docs/POLICIES.md` or an accepted ADR.
- Anything that changes a public API contract the frontend already consumes.

### 5. Write the proposal

Create `openspec/changes/<slug>/proposal.md` from
`plugins/abet-common/templates/proposal.md`.

The traceability table is the part that matters most. Every AC gets a row; the
"Satisfied by" column starts as `TBD` and `/abet-design-feature` fills it in with the
actual file, endpoint or component. That table is what makes review verifiable rather
than narrative — a reviewer checks rows, not vibes.

### 6. Report and stop

Show the requester:

- The slug and the branch name to use: `feat/<slug>` (or `fix/<slug>`).
- The ACs, numbered.
- Anything you flagged as a risk or dependency.
- The next step: `/abet-design-feature`.

**Do not** create the branch, do not commit, and do not start designing. Creating the
change folder is the whole deliverable.

## Scope changes later

When scope grows after the proposal is agreed, **append** a dated section rather than
rewriting the original:

```markdown
### Scope extension — bulk deactivation (2026-07-29)

...what was added and why, plus the new ACs numbered continuing from the existing set.
```

Rewriting history in the proposal destroys the record of what was actually agreed at
the start, which is the one thing review needs it for.
