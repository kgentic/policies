# Security

- **No `eval()` or `new Function()`** — dynamic code execution from any input is a code injection vector.
- **No `innerHTML` or `dangerouslySetInnerHTML`** — use `textContent` or a sanitizer (DOMPurify). XSS is the most common web vulnerability.
- **Parameterized queries only** — never concatenate strings into SQL. Use prepared statements or ORM query builders.
- **No shell command string interpolation** — use `execFile` with argument arrays, not `exec` with template strings. Command injection is trivial to exploit.
- **Sanitize at system boundaries** — validate and sanitize all external input (user input, API responses, file content) before processing.
- **Never log secrets** — API keys, tokens, passwords, PII must never appear in logs, error messages, or stack traces.
- **Principle of least privilege** — request only the permissions, scopes, and access you actually need. Don't default to admin.
- **Dependencies are attack surface** — fewer dependencies = smaller attack surface. Audit what you add.
