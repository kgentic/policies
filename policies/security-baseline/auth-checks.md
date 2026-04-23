# Authentication and Authorisation Checks

- **Authenticate before authorise** — verify identity before checking permissions. An unauthenticated request must never reach authorisation logic.
- **Deny by default** — start from a position of no access. Grant specific permissions explicitly; never rely on "no one will guess this path".
- **Check authorisation on every request** — do not trust session state alone. Re-verify permissions server-side on every request that accesses protected resources.
- **No client-side authorisation enforcement** — UI guards (hidden buttons, disabled menus) are UX, not security. All access control decisions must be enforced server-side.
- **Validate JWT claims** — check `iss`, `aud`, `exp`, and `nbf` on every token. Reject tokens with algorithm `none`. Use a well-maintained JWT library, not hand-rolled parsing.
- **Short session lifetimes** — access tokens should expire in minutes to hours, not days. Provide refresh token rotation with revocation for long-lived sessions.
- **Revoke on logout** — invalidate server-side session state and blacklist tokens on explicit logout or account compromise, not just expire on the client.
