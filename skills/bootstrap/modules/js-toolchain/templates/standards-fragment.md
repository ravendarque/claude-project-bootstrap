### JavaScript toolchain

Platform persona for this stack: runtime differences between Node and
wherever the code runs, module boundaries, async error handling, and the
supply-chain exposure of every dependency.

- **pnpm only.** `pnpm install`, `pnpm exec`, lockfile committed.
  `pnpm-workspace.yaml` holds new releases for three days
  (`minimumReleaseAge`) and denies install scripts unless a package is
  listed in `allowBuilds` with a reason. Don't approve a build script
  without knowing why it's needed. Transitive security fixes go in
  `overrides`, scoped to the major line they fix.
- **Lint and format with Biome.** Warnings fail CI. A deliberate exception
  gets a `biome-ignore` comment saying why.
- **Type-check with `tsc`** over JavaScript with JSDoc types and
  `strictNullChecks`. Types live in JSDoc, not TypeScript files.
- **Unit tests with Vitest**, against real code; mock only what the
  runtime can't produce.
- **Validate URL schemes server-side** for user-submitted URLs: `http:` and
  `https:` only.
- **Client-generated UUIDs** for entity ids, so a duplicate write is an
  idempotent replay rather than a collision.
