# Design a feature

Takes the ticket and produces the plan: `design.md` (how it will be built and why) and
`tasks.md` (the executable slices). This is where architectural decisions are caught,
before code exists to defend them.

## Preconditions

`openspec/changes/<slug>/proposal.md` must exist and its ACs must be unambiguous. If it
does not exist, run `/abet-define-task` first. If the ACs still contain open questions,
stop — designing against unresolved ACs wastes the design.

Resolve `<slug>` from the branch name; see the slug inference rules in
`plugins/abet-common/reference/conventions.md`.

## Steps

### 1. Load context

Read, in this order: `proposal.md`; root `docs/POLICIES.md` and, for whichever package(s)
`proposal.md` marks as affected, `backend/docs/POLICIES.md` and/or `frontend/docs/POLICIES.md`
— **each in full**, because they hold every convention the design must respect; every ADR
in `docs/adr/` (and the package's `adr/`) whose title touches this area; and the archived
sibling change in `openspec/specs/` if the proposal identified prior art.

Do not read `CONTEXT.md` whole — the backend's is ~100KB. Search root and package
`CONTEXT.md` for the terms the proposal involves (modules, integrations, domain words).

Then read the code. Design that has not read the code it modifies is fiction.

Record what you read as a **Read first** list at the top of `design.md`, so the next
person — and `/abet-implement` — starts where you started.

### 2. Decide single-package or cross-package

Backend and frontend are packages in one repository (`backend/`, `frontend/`), read from
`proposal.md`'s **Packages affected** line.

**Single-package** — one `tasks.md`, no contract file, no H2 sectioning. Each task is a
vertical slice: schema + endpoint + tests + docs together, never a horizontal "all the
entities" layer.

**Both** — one change folder, same as always, with `design.md` and `tasks.md` split into
`## Backend` and `## Frontend` H2 sections in the **same file**. `proposal.md` stays a
single copy; there is nothing to duplicate across repositories anymore.

Then pick the contract mode. This is a real decision, not a formality:

| | **Sequential** — prefer this | **Parallel** |
| --- | --- | --- |
| When | One person does the backend, then the frontend, usually one PR | Two people, or the frontend cannot wait for the backend to land |
| `contract.md` | **Do not create it.** `backend/openapi.json` on disk at HEAD is the contract | **Optional**, agreed before either side writes code |

Sequential is the lower-ceremony default and usually the right answer. Only write a
`contract.md` when the frontend genuinely cannot wait — otherwise you have created a
second source of truth that will drift from the implementation.

For parallel mode, write `contract.md` from
`plugins/abet-common/templates/contract.md` **before** either side's tasks: endpoints,
request and response shapes, scope headers, error keys with statuses, pagination. Say
explicitly what is *not* in the contract, so neither side builds against it speculatively.
One copy, in this change's folder — not duplicated anywhere.

State in `design.md` which mode this change is in and why.

### 3. Walk the ADR gate — mandatory, and record it

This is a checklist, not a judgement call. Walk every row and write the result into
`design.md` as a table:

```markdown
## ADR gate (walked, not skipped)

| Trigger                                          | Hit? |
| ------------------------------------------------ | ---- |
| Datastore, broker or cache choice                 | No   |
| Auth or payments provider                         | No   |
| Public API contract change or breaking change     | ...  |
| New module boundary or cross-package split        | ...  |
| Language, runtime or framework                    | No   |
| Contradicting an existing ADR                     | ...  |

Conclusion: no ADR required.
```

Any **Yes** → stop, run `/abet-adr`, and link the resulting ADR from `design.md` before
continuing. `/abet-design-feature` never writes an ADR itself.

Recording the table even when nothing is hit is the point: it makes the decision *not*
to write an ADR reviewable, instead of invisible. "Partially — assessed, not an ADR"
with the reasoning spelled out is a legitimate answer; silence is not.

### 4. Write design.md

From `plugins/abet-common/templates/design.md`. Sections:

- **Read first** — the pointer list from step 1.
- **ADR gate** — the table from step 3.
- **Approach** — organised per AC, not per layer. A reader should be able to trace
  AC-3 to the paragraph that explains how AC-3 is met.
- **Backend** / **Frontend** — module, entity, migration, endpoint, guard, i18n keys. Use
  both H2 sections when `proposal.md` says both packages are affected; keep just the one
  that applies for a single-package change. `design.md` is one file, never duplicated.
- **Cross-package mode** — sequential or parallel and why, where the contract lives (if
  any), and the ordering rule. Delete the section for a single-package change.
- **Testing strategy** — which ACs get unit tests, which need integration, which are
  only verifiable by hand (those go in the runbook).
- **Risks** — and the mitigation for each.
- **Docs to update in this PR** — be specific. Vague entries here are why
  `docs/CONTEXT.md` goes stale.

### 5. Write tasks.md

Vertical milestones. Each milestone delivers something demonstrable; each task inside it
is one commit-sized unit. Use `plugins/abet-common/templates/tasks.md`.

**Every task block carries its own `- [ ]` checkbox.** Headings alone break the
completeness gate that `/abet-audit-pr` and `/abet-create-pr` depend on — see the task
checkbox rule in `reference/conventions.md`. This is not optional formatting.

Each task states its **Files** (with modify/create/test marked), its **Steps** in TDD
order with the exact command to run, and its proposed **Commit** subject.

The preamble is addressed to whoever executes it, and carries the repo's execution
rules: how tests are run, what must not be run, and that commits are never autonomous.

### 6. Decide whether a runbook is needed

Create `runbook.md` when the change carries any of:

- a data migration or backfill,
- a permission or seed sync that must run at deploy time,
- manual verification steps that no test covers,
- anything that needs a documented way to revert.

Given how much of this platform is migration- and seed-driven, most non-trivial backend
changes need one. Lead it with the deploy prerequisite if there is one — that is the
line someone will miss at 6pm on a Friday.

### 7. Report and stop

Show the milestone breakdown, the ADR gate conclusion, and whether a runbook was created.
Then stop. **Do not implement, do not create the branch, do not commit.**
