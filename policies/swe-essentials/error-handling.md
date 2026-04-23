# Error Handling

- **Fail fast on the critical path** — if it can't recover, don't try. Let the error propagate with full context.
- **Never swallow errors** — `catch {}` with no action is a bug. Log, rethrow, or return a typed error.
- **Catch only when you can act** — handle locally if you can recover, provide a fallback, or add context before rethrowing. Otherwise let it bubble.
- **Type your errors** — use discriminated unions or custom error classes, not bare `throw new Error()`. Callers shouldn't parse strings.
- **User-facing vs internal** — user errors get friendly messages with actionable next steps. Internal errors get full stack traces and context.
- **Log with context** — include what operation failed, what input caused it, and what state was expected. A bare "something went wrong" helps nobody.
- **No error-string matching** — `if (err.message.includes('timeout'))` is fragile. Use error codes or typed errors.
- **Errors at boundaries, trust internally** — validate at system edges (user input, API responses, file I/O). Don't defensively try/catch every internal call.
