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
