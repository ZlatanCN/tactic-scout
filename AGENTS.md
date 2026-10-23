## Task tracking

- Keep feature specs and implementation tickets under `.scratch/<feature-slug>/`.
- Use `Status:` values `open`, `claimed`, or `resolved`.
- Use triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`.

## Domain docs

- Keep the project vocabulary in root `CONTEXT.md`.
- Record accepted architecture decisions in `docs/adr/`.

## TypeScript style

- Use arrow functions; do not write function declarations.
- Use `type`, never `interface`.
- Keep exports together at the bottom of each source file.
