# 0014 — Organize the application as a modular monolith

Status: accepted

TactiScout remains a single deployable application. Organize source code by product capability and stable ownership boundaries instead of accumulating unrelated files in broad layer-first folders.

## Target boundaries

- `src/recruitment/` owns the LangGraph recruitment-case workflow, its policies, tools, and report projection.
- `src/players/` owns player identity, search, and repository contracts.
- `src/sources/<provider>/` owns provider-specific fetching, parsing, and enrichment. Adapters implement player-facing contracts; they do not import recruitment workflow code.
- `src/domain/` owns framework-independent concepts and schemas, split by cohesive concept rather than one catch-all schema file.
- `src/datasets/`, `src/knowledge/`, `src/evaluation/`, and `src/observations/` own their corresponding product capabilities and operational entry points.
- `src/app.ts` and `src/index.ts` are composition and process entry points; dependency wiring lives at the edge.
- `web/src/app/`, `web/src/features/<capability>/`, and `web/src/shared/` group UI by route/capability and reusable primitives.

## Dependency direction

Composition roots may depend on all modules. Recruitment depends on domain/player contracts and typed provider capabilities. Source-specific rules stay in their provider modules behind explicit capabilities; the graph invokes those capabilities rather than embedding source parsing. Provider adapters depend on domain/player contracts, never on recruitment workflow or UI. Domain modules depend only on other domain modules and platform primitives. Frontend features may depend on shared UI and feature-owned modules; shared modules do not depend on features.

Do not add microservices, a generic plugin framework, or global barrels solely to make paths shorter. Do not split files only to meet a line-count target. Move cohesive modules in small behavior-preserving slices, update public entry points and docs in the same slice, and verify the existing build/test contracts after each boundary change.

## Consequences

This is a structural migration with no intended product behavior change. Existing HTTP routes, DTOs, checkpoint shape, CLI commands, saved browser data, and runtime dependency choices remain stable. Where an operational entry point changes path, update its package script and documentation atomically.
