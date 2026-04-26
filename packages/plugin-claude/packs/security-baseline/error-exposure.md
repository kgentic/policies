# Error Exposure Prevention

- **Never return internal errors to clients** — stack traces, SQL query text, file paths, and library versions must never appear in API responses or rendered HTML. Log them server-side only.
- **Generic error messages at the boundary** — return a user-facing message like "an unexpected error occurred" or a correlation ID. The correlation ID links to the full server-side log.
- **Structured error logging** — log error type, message, stack trace, request context (method, path, correlation ID) as structured JSON. Never log raw request bodies that may contain credentials.
- **Distinguish 4xx from 5xx** — client errors (validation failure, not found) return 4xx with a helpful message. Server errors return 5xx with only a correlation ID. Do not conflate them.
- **No debug mode in production** — ensure verbose error output (e.g. Django DEBUG, Flask debug mode, Express error handler with stack traces) is disabled in production environments.
- **Rate-limit error responses** — repeated error responses can be used to enumerate valid usernames, tokens, or resource IDs. Apply the same rate limiting to error paths as to success paths.
