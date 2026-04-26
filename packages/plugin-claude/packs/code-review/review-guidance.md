# Code Review Guidance

## Naming
- Boolean vars: is/has/should/can prefix
- No abbreviations except: URL, API, ID, DB, OK, IO. All others: spell out.
- Function names include domain object (validateOrder not validate, parseConfig not parse)

## Error Handling
- Never swallow errors — catch must log or re-throw
- Typed errors over generic strings
- Error messages: what operation, what failed, what the caller can do about it

## Security
- Never log secrets, tokens, passwords, or PII
- Parameterised queries only — never interpolate user data into query strings
- Escape output appropriate to context (HTML, SQL, shell, URL)
- Validate external input at HTTP handlers, CLI arg parsers, queue consumers, and file/config readers

## Testing
- Every conditional branch must have test coverage
- Assertions must fail when behaviour is wrong, not just when code crashes
- Mock external I/O (network, filesystem, clock). Test real logic directly.

## API Contracts
- Changes to function signatures, response shapes, or config schemas visible to consumers require a version bump
- Error responses: consistent shape with code, message, and detail fields
- Validate request bodies with schema at the handler/route/endpoint/controller layer

## Data & Storage
- Every migration must include a rollback step. If irreversible, document why in a comment.
- Schema changes on high-traffic tables: specify migration strategy (online DDL, shadow table, blue-green)
- Use transactions for multi-step writes
- Paginate unbounded queries — no SELECT without LIMIT on user-facing paths

## Dependencies
- No new dependency without a comment in the package manifest explaining why

## Performance
- No N+1 queries — batch or join
- Paginate unbounded lists at API and data layer
- No blocking I/O in request handlers or event loops
- Measure before optimising — no speculative perf changes without evidence

## Complexity
- Flatten nesting beyond 2 levels with early returns or extraction
- Delete dead code — never comment it out
