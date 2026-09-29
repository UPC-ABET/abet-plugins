---
name: abet-review-pr
description: "Review someone else's pull request. Runs the native security review alongside three ABET lenses — in one pass, or in parallel on a large or sensitive PR — checks the openspec change is in the right state, and produces blocker/major/minor/suggestion findings with What/Why/Fix. Read-only against GitHub until you approve posting. Cost: medium by default; heavy (parallel lenses) with `deep`, or automatically on a large or sensitive PR. Pass `lite` to force one cheap pass."
---

# Review someone else's PR

This is the **reviewer's** side. For your own branch before opening a PR, use
`/abet-audit-pr` instead — that one is an author self-check and assumes you can change the
code. Here you cannot, so the output is findings and a verdict, not fixes.

Everything against GitHub stays **read-only** until you explicitly approve posting.

## Phase 0 — gather, serially

```bash
gh pr view <number> --json title,body,author,baseRefName,headRefName,files,additions,deletions
gh pr diff <number>
gh pr checks <number>
```

Then establish context the diff alone cannot give you:

1. **Base branch** should be `develop`. A PR targeting `staging` or `production` directly
   is a **blocker** — those only ever receive fast-forward promotions.
2. **Load the rules**: classify the diff by `backend/` / `frontend/` path prefix to know
   which package(s) it touches. Then:
   - Read **in full**: root `docs/POLICIES.md`, `backend/docs/POLICIES.md` and/or
     `frontend/docs/POLICIES.md` for the package(s) the diff touches, and that profile's
     stack rules file. They hold every convention the PR is reviewed against; a section
     you skipped is a rule you missed. One `Read` call per file, with **no `offset` and no
     `limit`**. Then list the headings with `grep -n '^## '` on each file — that list is
     your checklist (see the lenses below).
   - Do **not** read `CONTEXT.md` whole: the backend's is ~100KB. Grep root and package
     `CONTEXT.md` for what the diff newly introduces (third-party imports, env vars,
     integration names) and check whether any matching line is now false. Read the ADRs
     the change touches.

   You are reviewing against the project's rules, not your personal preferences — a
   finding you cannot tie to a rule or a defect is a *suggestion*, and must be labelled as
   one.
3. **CI status.** Failing checks are the author's to fix; note it and do not spend review
   effort on what CI already caught.
   **Run the scanners.** With the PR's head checked out (`gh pr checkout <number>`), run
   `node node_modules/abet-plugins/shared/scripts/audit-scope.mjs --base <baseRefName>`.
   It prints, among other things, `security` (pattern hits against the team's auth, scope
   and SQL rules), `reuse` (code the PR copies, counted across the repo), `deadCode` and
   `docsHits`. They cost nothing and do not depend on you noticing. If the head is not
   checked out or the script is missing, apply the same checks by hand with `git grep`.
4. **Read the change folder** if one exists: `proposal.md` for the acceptance criteria,
   `design.md` for the intended approach. Review against what was agreed, not against how
   you would have built it.

## Phase 1 — the openspec state check

This is state-aware, and the states mean different things:

| State | Verdict |
| ----- | ------- |
| Change active in `openspec/changes/<slug>/`, all tasks checked | ✅ correct |
| Change active, **open `- [ ]` tasks remain** | **blocker** — the work is not finished |
| Task file has no checkboxes at all | **blocker** — the completeness gate cannot see anything, so its silence means nothing |
| Change already in `openspec/specs/` before merge | **major** — archived too early; the spec says done while the code is unmerged |
| No change folder inferable | fine — that is the `/abet-fix` bug lane |

Infer the slug from the PR's head branch. Do not treat a missing change folder as a
finding on its own; a one-shot defect legitimately skips it. Do treat a *multi-step* change
with no folder — one with a migration, a contract change, or work across several layers —
as a **major**.

## Depth — `auto`, `lite`, `deep`

The four lenses below are the same in every depth; what changes is whether you walk all
four yourself or four subagents each walk one. Fan-out multiplies the tokens spent — each
lens re-reads the rules and its files — so it is spent where a miss is expensive.

Read the depth from the invocation arguments (`lite` / `deep`); none means `auto`:

- **`auto`**: `deep` when the PR is over 400 changed lines or 15 files of source code
  (tests, `openspec/` and `docs/` files, markdown and the generated `openapi.json` do not
  count — the spec is regenerated on every API change), touches both packages, or touches a
  migration, auth or guard code, raw SQL, `docker/`, `.github/` or a dependency manifest.
  Otherwise `lite`.
- **`lite`**: you walk the four lenses yourself, in order, reading each file once.
- **`deep`**: four parallel subagents with `model: "sonnet"` set explicitly on every spawn (never omit it: an omitted model inherits the session model, which may be the most expensive one), one per lens in Phase 2. Do not paste
  the diff or the rules into their prompts — give each the PR number, the paths of the
  rules files to read, and its lens. In the same message send a fifth for Phases 1 and 3,
  which are procedural (folder state, checkbox counts, whether `openapi.json` is in the
  diff, whether frontend call sites match it) with `model: "haiku"` set explicitly on every spawn — the work is mechanical and needs no more; it reports facts and
  never grades severity beyond what those phases already prescribe.

Say which depth ran, and why, at the top of the review.

## Phase 2 — four lenses

Each returns findings as `{severity, file, line, what, why, fix}`.

**Security** — run the native `/security-review` over the diff. **The scanner is the floor,
not the ceiling**: a pattern sees only what someone already wrote a rule for, and a real
gap is often something none covers. Work in two passes.

*Pass 1 — the scanner's hits* (`security`, Phase 0). Each is a candidate found by pattern:
read the code around it, then drop it with a clause or report it. A school, modality or
period read from the query, body or a DTO field; a cache key or storage key without scope;
a function that accepts a scope id and never uses it (`scope-param-unused`); SQL built from
values; a secret; and `@ApiTokenAuth()` with `@SkipPermissions()` are **blockers**;
`@Public()` / `@SkipPermissions()` need the proposal to justify them. A route with no
`@RequirePermission` is a **defect, not an open door**: the guard throws
`error.auth.noPermissionsConfigured`, so it always fails.

*Pass 2 — read as an attacker, ignoring the script.* For every new or changed entry point
(a route, job, event handler, upload, export), ask:

- **Who can call it, and may *this caller* touch *this record*?** A row fetched by `:id`
  with no school or owner in the query is an IDOR, whatever decorators the route carries.
- **What can they send?** A DTO spread into an entity (mass assignment); an id, path or
  URL used unchecked (traversal, SSRF); unbounded size or count; a spreadsheet cell that
  starts with `=`, `+`, `-` or `@` (formula injection in an export).
- **What comes back?** A field that should not leave (hashes, tokens, another school's
  rows); an error message that leaks a query or a path. **A number is data too:** a count,
  sum or average over rows that can belong to another school leaks those rows as a total.
  Guarding the *parent* is not enough — a section owned by your school can still hold
  another school's students, and a `JOIN` or `COUNT` over them needs its own school filter.
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

Label every security row with where it came from: `[rule: <id>]` for a scanner hit you
confirmed, `[judgment]` for one you found yourself.

**Correctness** — does it do what `proposal.md` says? Walk the acceptance criteria one at
a time and find the code that satisfies each. Missing edge cases, wrong conditions, error
paths that swallow failures, off-by-one, null handling. State explicitly which ACs you
could *not* trace to code.

**Rules and architecture** — conformance to `docs/POLICIES.md` and the profile's stack
rules: layering and boundaries, naming, i18n keys instead of raw text, validation in the
right layer, scope headers read from headers only, response shape. Plus documentation
currency: if the diff changes a domain term, business rule or integration that
`docs/CONTEXT.md` states differently, **the diff wins** and the stale line is a finding.

**Runtime and tests** — the things invisible in a single file. N+1 queries, unbounded
result sets, anything quadratic over data that grows with enrolment, concurrency and
transaction boundaries, scope lost on an async or cached path, client lifecycle. On the
test side: do the tests assert the acceptance criteria or merely that the code does what it
does? Any fixture default that makes the condition under test a no-op? Was anything
observed failing before the fix?

Every lens **answers for every `##` heading** of each `POLICIES.md` from Phase 0: one line
each — `PASS`, `FAIL` or `N/A`, with one clause. **Answer from the section's body, never
from its title:** the heading list is what you answer *for*, not what you answer *from*. A
`FAIL` always quotes the violated rule verbatim, in double quotes, copied from the file —
never a paraphrase — in exactly this shape:
`- Database Access: FAIL — "A service must not import or inject DataSource" (#6)`.
A quote is the one thing you cannot produce without having read the section. A section whose body you did not read is
`UNREAD`, never `PASS`, and the review is incomplete — say so at the top. A heading with no
line is the same gap. Carry the walk into the final "what I checked" list.

**Duplication follows the rule of three.** Two copies of a piece of logic are tolerated; the
third is the trigger to extract it into a shared function, service, repository method or
component. Take the count from the scanner's `reuse` (Phase 0), not from memory: an
`extract` entry is a **major** finding naming the copies and the right home; a `tolerated`
entry is one line noting that the next copy must extract; `templatesSkipped` are
convention, not findings. The scanner only sees textually similar code, so also
`git grep` for an existing helper before accepting a new one as original.

**Dead code is a finding, never a suggestion.** An unused file, function, export,
parameter, import or commented-out block the PR adds is a **major** finding with the fix
"delete it". Confirm before reporting: a Nest provider, a decorator or a TypeORM entity
can be wired without an import. `git grep -w <name>` settles most cases.

Instruct every lens: **only report what is in this diff.** Pre-existing problems in
untouched code bury the findings that matter. If something adjacent is genuinely alarming,
raise it once, separately, marked as out of scope.

## Phase 3 — contract checks

If the diff touches `frontend/src`:

- Run `/abet-verify-contract` (a local, same-tree check against `backend/openapi.json` at
  HEAD — no remote fetch). Do the frontend's API call sites match the spec? A renamed
  field compiles fine and fails at runtime.

If the diff touches `backend/src` and altered a route, DTO or response shape:

- Was `backend/openapi.json` regenerated and committed in the same PR? If not,
  **blocker** — the frontend reads that file directly and will be wrong.
- Read the spec diff as a contract change. A retyped field is breaking even when nothing in
  `backend/` fails to compile.

## Phase 4 — synthesise

One table, ordered by severity:

| Severity | Meaning |
| -------- | ------- |
| **blocker** | Must change before merge. Correctness, security, a violated policy, unfinished work. |
| **major** | Should change. Real problem, but arguably shippable if the author disagrees with reason. |
| **minor** | Worth fixing, not worth blocking on. |
| **suggestion** | Preference. Explicitly optional — say so, so the author can decline without friction. |

Each finding: **What** (one sentence), **Why** (the rule or the failure mode — not "I
prefer"), **Fix** (concrete, so the author is not left guessing).

Then a verdict — **approve**, **approve with comments**, or **request changes** — and a
short **what I checked and found clean** list. A review that only lists problems tells the
author nothing about coverage, and makes a light review look identical to a thorough one.

## Record what you learned

A review is also how this team finds out which checks should be code. The scanner catches
what a pattern can and you catch the rest; a record of both is how a gap you found by
reading today becomes a rule that finds it for free in six months. So after the synthesis,
record every **security** finding and every **duplication** finding, one JSON object each,
in one call — with the PR number, because this is someone else's branch and the records go
to their own file for it (`openspec/audit-ledger/review-<number>.jsonl`), never into the
author's change folder:

```bash
echo '[ {...}, {...} ]' | node node_modules/abet-plugins/shared/scripts/audit-ledger.mjs add --lane review --pr <number>
```

This is a local file. It posts nothing to GitHub and is not part of the PR. The script
validates every record before writing any and prints what to fix if one is wrong; correct
it and run it again. In `deep`, each lens returns its records with its findings and you
make the one call. Fields:

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

Say in the review how many records you wrote, and where (the script prints the path).

## How to write it

- Review the code, never the person. "This query runs per row" not "you wrote an N+1".
- Distinguish rules from taste. If you cannot cite a policy, an ADR, or a concrete failure,
  it is a suggestion.
- Do not re-litigate decisions the proposal or an ADR already settled. If you disagree with
  a settled decision, that is a separate conversation, not a PR comment.
- Ask when you do not understand something, rather than asserting it is wrong. Half of
  "this looks wrong" turns out to be missing context — and the answer usually belongs in
  `docs/CONTEXT.md`.
- Praise is information too. Say what was done well; it tells the author what to repeat.

## Phase 5 — show, then post

Render the complete review and **wait for explicit approval**. Nothing is posted to GitHub
until you say so — no comments, no approval, no change request.

Once approved:

```bash
gh pr review <number> --comment --body-file <file>          # or --approve / --request-changes
```

Confirm the active GitHub account first (`gh auth status`) — a review posted from the wrong
identity is awkward to retract.

**Never merge.** That is the author's call, after the findings are addressed.
