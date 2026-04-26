# Testing Principles

- **Test behaviour, not implementation** — assert on observable outcomes, not internal mechanics or private state.
- **Arrange-Act-Assert** — one setup block, one action, one set of assertions. Keep it readable.
- **Mock at I/O boundaries only** — mock the filesystem, network, and external APIs. Never mock core business logic.
- **Don't mock what you don't own** — wrap third-party APIs in a thin adapter; mock the adapter, not the library.
- **Test the sad path** — error cases and edge cases matter more than the happy path.
- **One concept per test** — a test that asserts multiple unrelated things is two tests in a trenchcoat.
- **Realistic test data** — use plausible values, not trivial placeholders like `"foo"` or `123`.
- **Fail with meaning** — assertion messages should explain what broke, not just that something did.
- **No existence checks** — `expect(result).toBeDefined()` proves nothing. Assert on actual values.
