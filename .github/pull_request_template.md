## What and why

<!-- What does this change, and why does it matter? Link related issues, e.g. "Closes #123". -->

## How it was tested

<!-- Tests added, manual steps, screenshots for UI changes. -->

## Checklist

- [ ] `bun run check` passes (lint, typecheck, tests)
- [ ] New backend logic is covered by a `bun:test`
- [ ] New user-facing strings are added to every locale in `packages/frontend/src/i18n/` (en, tr, de, es, fr)
- [ ] New settings fields are in `ALLOWED_SETTINGS` (`packages/backend/src/routes/settings.ts`)
- [ ] DB migrations are idempotent
- [ ] Docs updated if behavior or configuration changed
- [ ] One change per PR, no unrelated cleanups

See [CONTRIBUTING.md](../CONTRIBUTING.md) for details.
