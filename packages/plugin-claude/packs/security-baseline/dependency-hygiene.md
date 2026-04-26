# Dependency Hygiene

- **Pin versions in lockfiles** — commit `package-lock.json`, `pnpm-lock.yaml`, or `poetry.lock`. Do not regenerate lockfiles without reviewing the diff.
- **Audit before adding** — before adding a new dependency, check its download count, last publish date, number of maintainers, and open CVEs. Prefer well-maintained packages with a track record.
- **Minimal transitive surface** — prefer packages with few or no transitive dependencies. A utility with 50 transitive deps carries 50 attack surfaces.
- **No abandoned packages** — avoid packages with no commits in the past 12 months and no active maintainer. Fork or find an alternative.
- **Regular vulnerability scans** — run `npm audit`, `pnpm audit`, or `pip-audit` as part of CI. Treat critical/high CVEs as build failures, not warnings.
- **Remove unused dependencies** — dead dependencies are attack surface you don't benefit from. Prune them before release.
- **Verify checksums for scripts** — when executing install scripts from third-party packages, verify the package integrity hash matches the registry record before trusting it.
