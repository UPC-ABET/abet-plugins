---
name: abet-audit-pr
description: "Pre-PR self-audit. Audits the branch diff across six domains — code quality, architecture and docs, testing, antipatterns, security, runtime robustness — in one pass or six parallel auditors depending on the diff, then synthesises a severity-ranked table and a PR-readiness verdict. Use after /abet-implement or /abet-fix, before /abet-create-pr. Cost: medium by default; heavy (six parallel subagents) with `deep`, or automatically on a large or sensitive diff. Pass `lite` to force one cheap pass."
---

# Audit before the PR

Six independent domains over the same diff, then one synthesis. They do not inform each
other, so on a large or sensitive diff they run as parallel auditors; on a small one a
single careful pass covers them for a fraction of the cost (see Depth).

This is the author auditing their own work. It is read-only: it does not fix anything,
does not commit, and does not open the PR. The one thing it writes is the audit ledger
entry (see *Record what you learned*), through a script that touches nothing else.

## Depth — `auto`, `lite`, `deep`

The six domains below are the same in every depth; what changes is whether one reviewer
walks all six or six reviewers each walk one. Fan-out multiplies the tokens spent — every
auditor re-reads the rules and its files — so it is spent where a miss is expensive, not
by default.

- **`auto`** (the default): decided by Phase 0's script from the size and sensitivity of
  the diff. Over 400 changed lines or 15 files of source code (tests, docs under
  `openspec/`, markdown and the generated `openapi.json` do not count), both packages, or
  any migration, auth, raw-SQL, deploy or dependency path → `deep`. Anything else → `lite`.
  An ordinary endpoint change, which always regenerates `openapi.json`, stays `lite`.
- **`lite`**: you audit all six domains yourself, in one pass, no subagents.
- **`deep`**: six parallel auditors, then the synthesiser.

Read the depth from the invocation arguments (`lite` / `deep`); none means `auto`. Say
which depth ran, and why, at the top of the report — the reader should know how hard the
diff was looked at.

## Phase 0 — serial setup

Do this yourself before dispatching anyone. Everything below feeds the auditors.

**Run the script first.** Steps 1–5 are arithmetic and `git`, so a script does them once and
identically every time:

```bash
node node_modules/abet-plugins/shared/scripts/audit-scope.mjs --depth <auto|lite|deep>
```

It prints JSON: the changed files, line and file counts, the packages touched, the openspec
change and its open/done task counts, the `blockers` it can see mechanically (open tasks, a
task file with no checkboxes, routes or DTOs changed with `openapi.json` untouched), and
`rules` — every `POLICIES.md` in scope with its line count and `##` headings, your checklist —
`deadCode` — new files and exports nothing else references — `docsHits` — lines of
`CONTEXT.md` that name something this diff newly uses, each a candidate stale statement —
`security` — pattern hits against the team's own auth, scope and SQL rules, plus secrets and
new dependencies — `reuse` — code this diff copies, counted across the whole repo — and the
chosen `depth` with its `reasons`. Take its answers as given — do not re-derive them.
If it prints `empty` there is nothing to audit; stop. If the file is missing (the package
is not installed) or it errors, do steps 1–5 by hand as written below.

1. **Base branch**: `develop`. Confirm it exists locally and is current:
   `git fetch origin develop`.
2. **Collect the diff**:
   `git diff --stat origin/develop...HEAD` and `git diff --name-only origin/develop...HEAD`.
   If it is empty, stop — there is nothing to audit.
3. **Resolve the change**: infer `<slug>` from the branch. Note whether
   `openspec/changes/<slug>/` exists. Absent is fine and means the bug lane
   (`/abet-fix`); it is not a finding on its own.
4. **Task completeness** (only when a change folder exists):
   `grep -c '^- \[ \]' openspec/changes/<slug>/tasks*.md`
   Open tasks remaining is a **blocker** — the change is not finished.
   Zero open **and** zero `- [x]` means the file has no checkboxes at all: report that
   as a blocker too, because the gate cannot see anything and neither can you.
5. **Classify by package**: split the changed paths on `backend/` / `frontend/` prefix to
   know which package(s) this PR touches.
6. **Build PROJECT_RULES**: concatenate root `docs/POLICIES.md`, the relevant sections of
   root `docs/CONTEXT.md`, any root `docs/adr/*` the change touches, root `AGENTS.md` if it
   holds content, then the same four (`POLICIES.md`, `CONTEXT.md`, `adr/*`, `AGENTS.md`)
   under `backend/docs/` and/or `frontend/docs/` for each package classified in step 5, and
   that profile's stack rules file. Only the package(s) the diff touches — the other
   package's rules are noise. Two different reading rules, because the files differ:

   - **`POLICIES.md` and the stack rules file: read in full, once.** They are the rules the
     diff is audited against (up to ~35KB), and a rule you skimmed is a rule you missed.
     One `Read` call per file, with **no `offset` and no `limit`** — stopping partway
     because you judged the rest irrelevant is exactly how a convention gets missed.
   - **`CONTEXT.md`: never in full** — the backend's is ~100KB. Use the script's `docsHits`
     (below): the lines of `CONTEXT.md` that mention a third-party package or env var this
     diff newly uses. For each, decide whether the diff has made that line false, and if so
     it is a finding (**the diff wins**). If there is no script, grep `CONTEXT.md` for those
     same terms instead.

   Say in the rules walk which files you read in full and which you looked up.
7. **Detect the stack** from the changed paths so auditors skip what does not apply.

## Phase 1 — the six domains

Findings are `{severity, file, line, what, why, fix}` with severity in
`blocker | major | minor | suggestion`. Everyone auditing — you in `lite`, each auditor in
`deep` — follows two rules:

- **Report only what is in this diff.** Pre-existing problems in untouched code are out of
  scope; noting them buries the findings that matter.
- **Answer for every section of `POLICIES.md`.** The script's `rules` lists each
  `POLICIES.md` in scope with its `##` headings. Record one line per heading — `PASS`,
  `FAIL` or `N/A`, with one clause. **Answer from the section's body, never from its
  title:** the heading list is what you answer *for*, not what you answer *from*. A `FAIL`
  always quotes the violated rule verbatim, in double quotes, copied from the file — never
  a paraphrase — in exactly this shape:
  `- Database Access: FAIL — "A service must not import or inject DataSource" (#6)`.
  A quote is the one thing you cannot produce without having read the section. If
  you did not read a section's body, write `UNREAD` — never `PASS` — and the audit is
  incomplete: say so at the top of the report. A heading with no line is the same gap. (No
  script? `grep -n '^## '` on each `POLICIES.md` gives the same list.)
- **Dead code is a finding, never a suggestion.** Unused code is not allowed here: an
  unused file, function, export, parameter, import or commented-out block is a **major**
  finding with the fix "delete it". The script's `deadCode` lists what this diff adds that
  nothing else references; treat each as a candidate, confirm it (a Nest provider, a
  decorator or a TypeORM entity can be wired without an import), and report the real ones.

**`lite`**: work through Auditors A–F below in order, yourself, reading each changed file
once. Skip whole bullets the diff cannot exhibit.

**`deep`**: send all six in a single message, each as a subagent with `model: "sonnet"` set explicitly on every spawn (never omit it: an omitted model inherits the session model, which may be the most expensive one). Do **not**
paste the diff or the rules into the prompts — retyping thousands of tokens six times is
the most expensive way to hand over context. Give each auditor: the file list, the
paths of the rules files, the command to see the diff
(`git diff origin/develop...HEAD -- <files>`), and its own domain below. Each auditor reads
every `POLICIES.md` **in full** and answers one line per heading — `N/A` for the headings
outside its domain — so coverage is checked per auditor, not assumed. When you merge, a
heading is `FAIL` if any auditor said so.

### Auditor A — code quality
Function length and single responsibility. Parameter counts and boolean flags. Data
handling and immutability — accidental mutation of shared objects, missing `readonly`,
leaked entity instances. Class design. Error handling: swallowed exceptions, `catch`
blocks that log and continue, thrown strings, errors that lose their cause, HTTP status
codes that do not match the failure.

### Auditor B — architecture, dependencies, documentation
Layering: does anything reach past its boundary? Are repositories used only from the
layer allowed to use them? Module dependencies and cycles. New third-party dependencies —
justified, maintained, licensed, already-have-one-of-those?

Then **documentation currency**, which is this auditor's most valuable job:

- Does the diff change a domain term, business rule, integration or architectural fact
  that `docs/CONTEXT.md` states differently? **The diff wins** — flag the stale line.
- Does `docs/CONTEXT.md` mention an in-flight change that has already been archived?
- Does the change folder's `proposal.md` still describe what was actually built? If the
  diff and the proposal disagree, the diff wins and the proposal needs a dated scope
  extension.
- Was a decision made here that trips the ADR gate and has no ADR?

**API contract currency** — a same-tree check, since both packages live in this repo, when
the diff touches routes, DTOs or response shapes:

- **Backend**: was `backend/openapi.json` regenerated and committed in this PR? A route,
  DTO or response change with an unchanged spec is a **blocker** — the frontend reads that
  file directly and will be wrong.
- Read the `backend/openapi.json` diff as a contract change, not as noise. A renamed or
  retyped field is a breaking change even when nothing in `backend/` fails to compile. Say
  so, and say whether the frontend consumes it.
- If a `contract.md` exists, does the implemented spec still match it? **The spec wins** —
  flag the contract for a dated correction rather than "fixing" the code to match a
  design-time guess.
- **Frontend**: do the hand-written types in `types/` still match `backend/openapi.json`
  at HEAD? A field the backend renamed will compile fine here and fail at runtime; that is
  precisely the drift this check exists to catch. Run `/abet-verify-contract` — a local
  check against the spec on disk, not a network fetch.

### Auditor C — testing
Do the new tests actually assert the acceptance criteria, or do they assert that the
code does what it does? Was any test observed failing before the fix? Edge cases: empty
sets, nulls, boundary values, permission denied, wrong scope. Test naming. Fixtures that
silently defeat the assertion (a factory default that makes the filter under test a
no-op). Anything mocked so heavily the test no longer exercises real behaviour.

### Auditor D — antipatterns and code smells
God objects and god services. Magic numbers and stringly-typed logic. Dead code and
commented-out blocks — **major**, see the rule in this phase's preamble. Premature
abstraction.

**Duplication — the rule of three.** Two copies of a piece of logic are tolerated; the
third is the trigger to extract it into a shared home: a function in
`core/<module>.functions.ts` (or `libs/` when it crosses modules), a service, a repository
method, or on the frontend a shared hook or component. Do not judge this from memory — the
script's `reuse` counted it across the whole repo:

- `reuse.extract`: the diff makes the third (or later) copy. Confirm it is the same
  *intent*, not a coincidentally similar shape, then report a **major** finding that names
  the copies (file and lines, from `locations`) and the right home for the extraction.
  "It only exists in one other place" is not an answer when the count says otherwise.
- `reuse.tolerated`: this is the second copy. Not a finding, but say so in one line — the
  next copy must extract instead.
- `reuse.templatesSkipped` are blocks repeated across so many modules that they are a
  convention (the validation skeleton, base-class scaffolding), not a reuse miss.

The script only sees copies that are textually alike. Before writing off a new helper as
original, `git grep` for an existing function that already does it: reusing what exists is
the cheaper fix than extracting a new one.
Deep nesting. Primitive obsession. Leaky abstractions. `any` used to silence the
typechecker. Inconsistent naming against the conventions in PROJECT_RULES.

### Auditor E — security
Run the native `/security-review` over the diff. On top of it: authentication and
authorisation on every new route, input validation at the DTO boundary, injection risk
in raw SQL, secrets in code or config, unsafe deserialisation, file upload handling
(type, size, path), sensitive data in logs and in error responses returned to clients.

**The script is the floor, not the ceiling.** Its `security` list is what a pattern can
see; a real gap is often something no pattern covers, and finding those is the part of this
job only you can do. Work in two passes.

*Pass 1 — the script's hits.* Each is a candidate found by pattern, not a verdict. Read the
code around it, then either drop it (say why in one clause) or report it at the severity
below. Do not let a hit go unmentioned.

*Pass 2 — read as an attacker, ignoring the script.* For every new or changed entry point
(a route, job, event handler, upload, export), ask:

- **Who can call it, and may *this caller* touch *this record*?** A row fetched by `:id`
  with no school or owner in the query is an IDOR, whatever decorators the route carries.
- **What can they send?** A DTO spread into an entity (mass assignment); an id, path or
  URL used unchecked (traversal, SSRF); unbounded size or count; a spreadsheet cell that
  starts with `=`, `+`, `-` or `@` (formula injection in an export).
- **What comes back?** A field that should not leave (hashes, tokens, another school's
  rows); an error message that leaks a query or a path.
- **What does it touch?** A file, network call, queue, cache or storage key — is the
  school in every key and path?
- **What happens under repetition?** Work per request that grows with the data, no limit
  or pagination, an expensive route any authenticated user can hammer.
- **In what order?** The authorisation check after the side effect; check-then-write with
  no transaction.
- **What is stored or logged?** PII and tokens.

Anything you find that the script did not flag is a **judgment** finding: report it at the
severity its impact deserves, and give it the extra fields in *Record what you learned*
below. Do not pad — a finding you would not stand behind in review is not a finding — and
`no gap found` is a fine result for a diff that has none.

Label every security row in the table with where it came from: `[rule: <id>]` for a script
hit you confirmed, `[judgment]` for one you found yourself.

| Rule | If confirmed |
| ---- | ------------ |
| `scope-from-request`, `scope-in-dto` | **blocker** — a caller can ask for another school's data. Unless the task explicitly says this scope comes from the query (a cross-period comparison). |
| `scope-param-unused` | **blocker** if the function reads or writes scoped rows (an IDOR: the school is accepted and dropped); drop it only if the work is genuinely global. A controller that injects `@AcademicPeriodId()` and never passes it on is the same shape. |
| `cache-key-without-scope` | **blocker** if the cached data is scoped (one school's entry served to another); drop it only if the data is global. |
| `sql-interpolation` | **blocker** — injection, unless every interpolated value is a fixed constant. |
| `secrets` | **blocker** — and say the value must be rotated, not just removed. |
| `api-token-skip-permissions` | **blocker** — POLICIES forbids the pairing outright. |
| `public-route`, `skip-permissions` | **major** unless the proposal justifies open access; say what data the route can reach. |
| `route-without-permission` | **major**, and a **defect, not an open door**: with no decorator the guard throws `error.auth.noPermissionsConfigured`, so the endpoint always fails. Never describe it as unauthenticated. |
| `process-env`, `dangerous-api`, `weak-crypto`, `insecure-random`, `cors-any-origin`, `shell-interpolation`, `log-sensitive` | **major**, or **minor** with a stated reason (a jitter `Math.random()`, a fixed shell string). |
| `newDependencies` | Justified, maintained, licensed, and not already covered by a package the repo has. |

### Auditor F — runtime robustness
The domain the other five miss, because none of it is visible in a single file.

- **Cost at scale**: N+1 queries from relation loading inside a loop; queries with no
  pagination or limit; anything quadratic over a collection that grows with enrolment;
  report and export generation that materialises everything in memory instead of
  streaming.
- **Concurrency**: race conditions on read-modify-write, missing transactions around
  multi-write operations, non-idempotent handlers that will be retried.
- **Background work**: jobs that swallow failures, jobs with no timeout, work that
  assumes request context still exists.
- **Scope and tenancy on async paths**: the school / modality / academic-period scope is
  request-derived. Anything that crosses into a job, a cache key, or a shared service
  and loses that scope will silently serve one program's data to another. Treat every
  new cache key and every new async path as a scope-leak candidate.
- **Client lifecycle** (frontend diffs): effects without cleanup, subscriptions never
  torn down, query cache keys that omit a scope variable, state updates after unmount.

Auditor F is stack-aware: skip whole bullets that the changed files cannot exhibit.

## Phase 2 — synthesise

Merge the six reports. Deduplicate findings that several auditors reached from different
angles — but keep the strongest severity and note that it was found more than once, which
is signal rather than noise.

Output one table, ordered by severity:

| # | Severity | Area | File:line | Finding | Fix |
| - | -------- | ---- | --------- | ------- | --- |

Then the verdict:

- **READY** — no blockers, no majors. List minors as follow-ups.
- **NOT READY** — one or more blockers or majors. State exactly what must change.

Then a short **What I checked and found clean** list. An audit that only reports problems
gives no information about coverage. Include the rules walk: every `POLICIES.md` heading
from the script's `rules`, each as `PASS` / `FAIL` / `N/A`, and name any heading left
unanswered.

## Record what you learned

The audit is also how this team finds out which checks should be code. The mechanical
rules catch what a pattern can; you catch the rest; and a record of both is how a gap you
found by reading today becomes a rule that finds it for free in six months. So after the
synthesis, record every **security** finding and every **duplication** finding — one
JSON object each, in one call:

```bash
echo '[ {...}, {...} ]' | node node_modules/abet-plugins/shared/scripts/audit-ledger.mjs add
```

The script validates every record before writing any and prints what to fix if one is
wrong; correct it and run it again. In `deep`, each auditor returns its records with its
findings and you make the one call. Fields:

| Field | For | Value |
| ----- | --- | ----- |
| `area` | all | `security` or `reuse` |
| `source` | all | `mechanical` — a script hit (`security`, `reuse`); `judgment` — you found it |
| `rule` | mechanical | the script's rule id from `security.hits[].rule`, e.g. `cache-key-without-scope`; for a `reuse.extract` entry always `rule-of-three` |
| `category` | all | `scope-leak` `authz` `authn` `idor` `injection` `secrets` `crypto` `data-exposure` `file-handling` `dos` `ssrf` `deserialization` `logging` `config` `dependency` `race` `export-injection` `duplication` `existing-helper` `other` |
| `severity` | confirmed | `blocker` `major` `minor` `suggestion` |
| `verdict` | all | `confirmed`, or `false-positive` for a mechanical hit you dropped |
| `file`, `line`, `summary` | all | where, and one sentence |
| `reason` | false positives | why the rule was wrong here — this is how noisy rules get tightened |
| `pattern` | judgment | the *code shape* in one line, general enough to recur, not this diff's names |
| `detect` | judgment | how a machine could catch it: a regex, a missing decorator, a value that reaches a call with no scope argument — or `needs judgment` |
| `convertible` | judgment | your honest estimate that a mechanical rule could catch it with few false positives: `high` `medium` `low` `no` |

Record dropped mechanical hits as `false-positive` too — a rule that is wrong half the
time is as important to know about as a gap nobody caught. Be honest in `convertible`:
`no` is a valid answer and keeps the promotion report trustworthy. If the script is missing,
print the JSON at the end of the report instead, so it can be saved.

Say in the report how many records you wrote, and where (the script prints the path).

## After the audit

Fixes from the audit are real work: they go into `tasks.md` under
`## Audit fixes (/abet-audit-pr)` and get implemented through `/abet-implement`, not
patched in silently. That keeps the change's record honest about what review caught.

**This skill does not fix, commit, or push.** When the verdict is READY, the next step is
`/abet-create-pr`.
