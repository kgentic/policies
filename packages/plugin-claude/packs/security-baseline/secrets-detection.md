# Secrets Detection

- **No hardcoded secrets** — API keys, tokens, passwords, and credentials must never appear in source code, config files, or test fixtures. Use environment variables or a secrets manager.
- **No `.env` files in version control** — `.env`, `.env.local`, `.env.production` and their variants must be in `.gitignore`. Commit `.env.example` with placeholder values only.
- **No secrets in logs** — never pass secrets to `console.log`, `logger.*`, error messages, stack traces, or any audit trail. Mask or omit before logging.
- **No secrets in URLs** — do not embed API keys, tokens, or passwords in URL query strings or path segments. Use headers or request bodies.
- **Rotate on exposure** — if a secret is accidentally committed or logged, treat it as compromised immediately. Revoke, rotate, and audit access before continuing.
- **Use short-lived tokens** — prefer ephemeral credentials (OAuth tokens, STS temporary credentials) over long-lived static keys wherever the infrastructure supports it.
