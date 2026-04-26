# Injection Prevention

- **Parameterized queries only** — never concatenate user input into SQL. Use prepared statements, query builders, or ORMs with bound parameters.
- **No shell string interpolation** — use `execFile` with an argument array instead of `exec` with template strings. Command injection via unsanitized input is trivially exploitable.
- **No `eval()` or `new Function()`** — dynamic code execution from any external input is a code injection vector. Parse structured data formats (JSON, YAML) instead.
- **Sanitize HTML output** — never interpolate untrusted content directly into HTML. Use `textContent` for text nodes; use a proven sanitizer (DOMPurify) if HTML fragments are unavoidable.
- **Validate at every trust boundary** — re-validate input when it crosses a trust boundary (user → server, server → database, server → shell). Don't assume upstream validation happened.
- **Escape for the target context** — different injection contexts (SQL, shell, HTML, LDAP, XML) require different escaping strategies. Use context-aware libraries, not generic string replace.
