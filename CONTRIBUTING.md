# Contributing

Use the [product specification](docs/product-specification.md) for requirements, the [interface contract](docs/interfaces.md) for module/data/UI behavior and the [development guide](docs/development.md) for commands. Read the sections relevant to your change and update the maintained contract when behavior changes.

- Use rootless Podman for local dependency installation, development, builds, type checking, unit tests and Playwright; do not use host-native app tools. GitHub-hosted application CI uses the exact project Node version, `npm ci` and the same shared validation/build commands directly on its disposable runner; see [Development](docs/development.md#github-hosted-application-ci).
- Keep changes small and preserve scheduling, correction, XP, lifecycle, atomic replacement and PWA update/cache safeguards. Do not weaken Web Locks to claim compatibility.
- Project-authored documentation, comments, identifiers and tests are in English; Portuguese localization and literal user content are intentional exceptions.
- Write clear, accessible copy for anyone building or tracking habits, with varied, non-prescriptive examples and supportive, non-punitive feedback. Preserve self-report framing, non-clinical limits, accessibility, privacy and user control; XP and levels do not measure health, intelligence or personal worth.
- Use isolated fictional fixtures and injected clocks. Never inspect, seed, clear or migrate a real diary to prove a test.
- Match verification to the change. Application changes normally need local typecheck, units, a production build and relevant browser checks inside containers. Documentation-only changes need link, terminology and whitespace checks, not the application matrix. Keep the full unit suite, including mocked Podman wrapper tests, in hosted CI; real container/browser integration is classified in the development guide. State actual commands/results, skips, failures and device limitations. Specialized compiled suites need explicit fixtures; a bare full E2E invocation is not a fresh-clone release gate.
- Review relative links, notices, public assets, the generated artifact and `git diff --check`. Keep `dist/`, backups, browser profiles/databases, logs, traces and private evidence out of commits and reports.
- For bug reports, provide reproduction steps, browser/OS versions and the relevant app version/status without private exports or real-person screenshots. Remove identifying goals from examples.
- The project’s own code, documentation and original assets (including supplied logos and derived icons) use [Apache-2.0](LICENSE), to the extent of available rights; preserve third-party terms and attribution. See [branding provenance](docs/branding-pwa.md) for artwork details.

## TypeScript style and checks

Follow the conventions below and the repository's configured tools.

- Prefer straightforward code that another contributor can understand and modify
  easily. Choose clear control flow over clever, compressed or unnecessarily abstract solutions.
- Give functions and components cohesive responsibilities. Split them when that
  clarifies meaningful responsibilities, not to meet arbitrary line limits. Avoid
  speculative abstractions, unnecessary dependencies and trivial helpers that
  fragment otherwise readable logic.
- Keep related code together. Use blank lines between functions and meaningful
  logical groups, while retaining concise expressions when they are easy to understand.
- Use descriptive names that communicate domain meaning and intent; avoid ambiguous
  abbreviations and generic names when more informative names would help. Use
  PascalCase for components, interfaces and type aliases, camelCase for functions,
  variables and properties, and `use` prefixes for actual React hooks.
- Use two-space indentation, semicolons and single quotes in TypeScript; JSX
  attributes use double quotes. Prettier targets 100 columns, not a hard maximum
  for every literal. Declare one variable per statement and prefer `const`.
- Use named props interfaces for complex component contracts. Keep multi-member
  interfaces/object types, expressions, callbacks and JSX readable rather than
  packing multiple operations into single lines.
- Prefer explicit type imports (`import type` or inline `type` specifiers), while
  retaining isolated `import()` type queries in test instrumentation. Rely on useful
  inference rather than redundant annotations. Explain non-obvious intent, invariants
  and constraints in comments; do not add comments or annotations that repeat obvious code.

Prettier handles formatting. ESLint enforces the configured code-quality and Hooks
rules, including unused bindings, unnecessary `let` declarations, combined declarations
and unreachable/invalid constructs; legitimate reassignment remains allowed.
TypeScript checks types. Human review assesses clarity, naming, organization and
maintainability. Prefix intentionally unused bindings with `_`, for example when
excluding fields from object rest.

Run locally through the existing container workflow:

```sh
sh scripts/containers.sh format:check
sh scripts/containers.sh format
sh scripts/containers.sh lint
```

These map to `npm run format:check`, `npm run format` and `npm run lint`.
Formatting selects authored TypeScript/TSX, tests/E2E, TypeScript configs/declarations
and the small tooling configs, not existing JavaScript (including the worker and
landing), locale JSON, artwork, documentation or generated/dependency/artifact trees.
CI runs the same check/lint scripts directly with its exact Containerfile-derived
Node version; it never rewrites formatting. Keep both validation workflows aligned.

Hooks order checks apply to application source, not Playwright's unrelated `use`
fixture callbacks. Dependency checks are errors. Hook dependency exceptions must be
narrowly scoped and explained beside the affected code. Review callback lifetimes
and synchronization before changing dependencies; do not add blanket disables or
mechanically introduce `useCallback`.
Justified non-null assertions, casts and isolated browser instrumentation remain allowed.
