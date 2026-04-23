# Design Principles

- **Extract for testability, not just reuse** — if a block of logic deserves its own unit test, it deserves its own function. Don't wait for duplication; wait for a clear behavioral boundary.
- **YAGNI** — solve the actual problem. Don't build for hypothetical future requirements.
- **KISS** — prefer the simplest solution that works. Complexity must justify itself.
- **Single Responsibility** — if you need "and" to describe it, split it.
- **Composition over inheritance** — compose small behaviours rather than deep hierarchies.
- **Right abstraction, right time** — too early is as bad as too late. Let the pattern emerge.
- **Readability at the call site** — prefer named, well-bounded functions over inline blocks, but don't fragment a linear flow into a scavenger hunt.
- **Boundaries are explicit** — side effects and I/O live at the edges; pure logic lives in the centre.
- **Name things accurately** — a misleading name is worse than no name. Rename when meaning drifts.
