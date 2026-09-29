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
