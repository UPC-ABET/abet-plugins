# Fix a bug

The short lane. No proposal, no design, no change folder, no archive — a defect that can
be reproduced, root-caused and fixed in a handful of coordinated edits goes straight
through here to `/abet-audit-pr`.

## Is this actually the right lane?

Use `/abet-fix` when the defect is **one-shot**: a wrong condition, a missing guard, an
off-by-one, a bad query, a missing filter.

Use the feature lane instead when the fix needs a schema migration, an API contract
change, a new module, or more than a couple of coordinated edits across layers. The gate
is **multi-step, not feature-vs-bug** — a fix with a migration and a retention decision
belongs in a change folder like any feature.

Branch: `fix/<slug>`.

## Steps

### 1. Reproduce before anything else

Do not read code looking for something that looks wrong. Get the bug to happen.

- Write a failing test, hit the endpoint, or run the exact scenario from the report.
- Capture the actual observed behaviour: the error, the wrong value, the missing row.
- If you cannot reproduce it, **say so and stop.** Ask for the inputs, the account, the
  academic period, the school/modality scope headers, the exact request. A fix for a bug
  you never saw is a guess wearing a commit message.

Record what reproduction required — it is usually most of the regression test.

### 2. Find the root cause systematically

Narrow, hypothesise, test. One hypothesis at a time.

- Read the actual data. In this platform most "logic bugs" turn out to be scope bugs:
  a missing `is_active` filter, the wrong academic period, an unapplied school/modality
  scope header, a soft-deleted row still being counted.
- Trace the value from where it is wrong back to where it was right.
- Check `git log`/`git blame` on the suspect lines — the same bug may have been fixed
  and reverted before, and there may be an ADR explaining why the "obvious" fix is wrong.

Do not apply speculative fixes in sequence until the symptom disappears. That produces
code nobody can explain and frequently leaves the real cause in place.

State the root cause in one sentence before writing any fix. If you cannot, you have not
found it yet.

### 3. Escape hatch — check before you fix

Once you know the root cause, ask: **does fixing this properly require new architecture,
a schema change, or a contract change?**

If yes, **stop here.** This is no longer a bugfix. Report the root cause, say what the
proper fix would require, and hand off to `/abet-define-task` → `/abet-design-feature`.

Do not smuggle a schema migration into a `fix/` branch. That is how a "small fix" ends up
unreviewable.

### 4. Write the regression test first

The test must **fail before the fix and pass after**. Run it and see it red — a
regression test that was never observed failing does not pin anything.

Name it after the behaviour, not the bug: `returns only active programs for the GRA
report`, not `fixes issue with report`.

Put it where the module's other tests live, following the testing conventions in
`docs/POLICIES.md`.

### 5. Apply the minimal fix

Minimal means: addresses the root cause, and nothing else.

- No opportunistic refactoring in a fix branch. Note it and move on.
- No reformatting of surrounding code — it buries the one line that matters in a diff
  nobody can review.
- If you find adjacent bugs, list them for a separate fix rather than folding them in.

Re-run the regression test, then the module's suite, then the typecheck.

### 6. Update docs only if a documented rule was wrong

Usually nothing. But if the bug existed because `docs/CONTEXT.md` documented a business
rule incorrectly, fix that line — the wrong documentation would have reproduced the bug.

Never touch `docs/POLICIES.md` or `docs/adr/`.

### 7. Propose the commit and stop

Usually two:

```
fix(gra): apply is_active filter to the report query
test(gra): cover inactive programs excluded from the report
```

Report: reproduction, root cause in one sentence, the fix, the regression test, and
anything adjacent you deliberately left alone.

**Do not commit or push.** Next step is `/abet-audit-pr`.
