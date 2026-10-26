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

## Agent skills

### Issue tracker

Issues and specs are local Markdown files under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repo. Read the root `CONTEXT.md` and relevant `docs/adr/` decisions before exploring. See `docs/agents/domain.md`.
