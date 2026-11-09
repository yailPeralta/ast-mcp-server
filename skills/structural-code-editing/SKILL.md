---
name: structural-code-editing
description: "Trigger: navegar, analizar o editar TypeScript/JavaScript con el compilador. Use tools AST preparadas, revisadas y vinculadas por hash."
license: "ISC"
metadata:
  author: "yail"
  version: "4.7.0"
  hermes:
    tags: ["typescript", "javascript", "ast", "refactoring", "mcp"]
    homepage: "https://github.com/yailPeralta/ast-mcp-server"
---

# Edición estructural con el servidor MCP `ast`

## Activation Contract

Cargar este skill antes de navegar semánticamente, analizar impacto o referencias, consultar diagnostics o preparar una mutación TypeScript/JavaScript gobernada por el compilador.

No forzar un roundtrip AST para Markdown, configuración, comentarios ni una edición textual trivial en un archivo ya conocido. Si las tools `ast_*` no están disponibles, declarar el fallback y no presentar búsquedas textuales como evidencia compiler-backed.

Published v0.12.0 requires Node.js `>=22.13.0` and retains immutable release evidence from exact Node.js 22.13.0 plus the governed Node.js 24 line.

## Hard Rules

- Verificar primero que las tools existen y que `ast_get_project_status` informa un proyecto usable.
- Tratar como autoritativa solo evidencia `compiler` + `exact` + `resolved` + `fresh`.
- Revisar siempre límites, `completeness`, `unresolved` y `truncation` antes de inferir ausencia.
- Preparar mutaciones, revisar preview y diagnostics, y aplicar únicamente con el `operation_id` y `plan_hash` exactos.
- Nunca reconstruir postimages desde un diff; después del apply, ejecutar el gate canónico del proyecto.
- Conservar `correlation_id` en errores públicos sin exponer source, paths absolutos, argumentos, environment, cache, stacks ni credenciales.

## Impacto y candidatos de test

`ast_get_impact` separa dos canales. `coverage` asigna a cada kind/direction/endpoint una de `not_applicable`, `completed`, `unsupported` o `unfinished`; `truncation` y `work` describen límites de recorrido. `incomplete` es true si falla cualquiera. `proven_empty` exige cero edges, cobertura aplicable completa y ningún límite agotado.

La selección default conserva los siete kinds. `contains` aplicable es `unsupported`, por lo que el default puede ser semánticamente incompleto sin truncamiento. Calls directas por identificador, `new` y tagged templates pueden ser exactas; property, element, dynamic, unresolved, multiple o external dispatch no generan edges adivinados y dejan esa dirección `unfinished`. No presentar esto como certificación de #219 o #220.

`ast_find_test_candidates` fija seis kinds incoming (`reference`, `import`, `export`, `extends`, `implements`, `call`) y excluye `contains`. Solo acepta evidencia fresh/exact/resolved/compiler-authoritative, cobertura completa y trabajo/recorrido sin agotar. Si no, devuelve `INCOMPLETE_EVIDENCE`, no una página vacía. Después de admitir, pagina candidatos ordenados sin partir paths ni ocultar `coverage`/`work`. MCP entrega JSON canónico; TOON de batch debe conservar el mismo significado lógico.

## Diagnostic aggregates

`ast_get_diagnostics` keeps its existing response shape unless `include_aggregates: true` is requested. Enabled summaries cover the complete normalized snapshot, not only the selected raw page, and cap both code and file groups at 20.

For each dimension, `groups.length + omitted_group_count = total_group_count` and group counts sum to `covered_diagnostic_count`. Code coverage plus omitted diagnostics equals the total; file coverage additionally includes `unfiled_diagnostic_count`. File groups expose normalized project-relative paths only and may include paths absent from the raw page.

## Angular templates

In an Angular project (`@angular/core` resolvable from the tsconfig directory), `ast_find_references` also reports usages of a component member inside its external `templateUrl` template and inline `template`, and binding usages in consumer templates. Each item carries `origin` (`compiler`, `template_external` or `template_inline`), and the response adds `template_coverage` and `template_reference_count`. `reference_count` stays TypeScript-only; `total` counts both kinds.

Read `template_coverage` before inferring absence. Only `completed` proves every template it covers was examined. `unfinished` (for example `compiler_missing`, `compiler_unsupported`, `template_unresolved`, `template_parse_error`, `size_exceeded`, `cross_component`, `work_exhausted`) and `unsupported` (for example an inherited member) never prove that no template usage exists. `not_applicable` means the feature is off and the response is unchanged.

Consumer templates: for a member bound through the selector (`@Input`, `@Output`, `input()`, `output()`, `model()`, a literal alias, or a literal entry of the `inputs` / `outputs` metadata), the binding keys `[x]`, `x="lit"`, `[(x)]`, `(y)` and `(xChange)` are listed with kinds `TemplateInputBinding` for `[x]`, `TemplateAttribute` for `x="lit"`, `TemplateTwoWayBinding` for `[(x)]` and `TemplateOutputBinding` for `(y)` and `(xChange)` in the templates of components whose resolved scope contains the declaring component (literal standalone `imports`, or NgModule `declarations` plus the `exports` of imported modules). For a `@Pipe` class with a literal `name`, and for its `transform` member, `| name` usages in in-scope templates are listed with kind `TemplatePipeName`. A same selector or pipe name outside that scope is ignored.

For these members, `completed` means template evidence inside the Project only: every component template of the Project (the tsconfig passed as `project_root`) was read and every match resolved. `hostDirectives`, `@Directive` inputs and outputs, and non-literal scopes, aliases, metadata or pipe names stay `unfinished` with `cross_component`. Runtime bindings (`setInput`, router input binding, `createComponent` and other dynamic component APIs) and consumers outside the Project (other tsconfigs, libraries, other applications) are never examined, so `completed` does not cover them.

`ast_rename_symbol` updates the declaring component's external templates and, for a selector-bound member with `completed` coverage, every external consumer template in the same reviewed plan; it rewrites them only through `ast_apply_operation`. Consumer rewrites keep `[`, `(`, `[(`, `bind-`, `on-`, `bindon-` and the values, a `model()` event key becomes `<name>Change`, and alias-keyed bindings stay. It fails closed: coverage `unfinished` or `unsupported`, `hostDirectives`, `@Directive` members, non-literal aliases and members listed in `inputs` / `outputs` metadata return `INCOMPLETE_EVIDENCE`. An inline template usage (own or consumer), `[(x)]` on a non-`model()` pair, a new name that collides with a template local, another input, output or alias of the directive (or its `Change` name) or a binding of another directive on the same element, `$any`, or a name in the directive's selector return `MUTATION_BLOCKED`. `#ref`/`let-` targets, host bindings and `styleUrls` are not renamed. Apply is sequential, not globally atomic; rollback restores the owned and consumer templates.

Pipes: renaming a `@Pipe` class applies with TypeScript edits only; the `name` literal and every `| name` usage stay unchanged. Renaming its `transform` member returns `INCOMPLETE_EVIDENCE`.

Limits to state when reporting:

- `ast_explore` is TypeScript-only: its references omit template usages. This is tracked in issue #380. Use `ast_find_references` for template evidence; rename still blocks independently.
- The `diagnostics` field stays TypeScript-only. When a rename edits a template, the plan also carries `template_diagnostics`, a best-effort template type-check delta (`status`, `reason`, `added`, `removed`, `added_errors`) from the project's own `@angular/compiler-cli`; it is absent for non-Angular projects and for renames that edit no template. `completed` is the only status with data; `unavailable` (`compiler_cli_missing`, `compiler_unsupported`, `typescript_incompatible`) and `unfinished` (`work_exhausted`, `deadline`, `check_failed`) mean unknown, so run the project's build or tests before applying. `block_on_template_errors` (default `false`) blocks only a `completed` delta with `added_errors`, and `allow_new_errors` waives it. `template_diagnostics[].file` is relative to the directory of the tsconfig, while `diagnostics[].file` is relative to `project_root`. `@angular/compiler-cli` is not a declared peer and must resolve from the project, otherwise the status is `unavailable/compiler_cli_missing`. Template-editing renames persist as plan schema v3, which is rejected on import after a downgrade.
- Detection uses the user's own `@angular/compiler`, never a bundled one. It is an optional peer (`>=18.0.0 <23.0.0`) that the project already installs with Angular. If it is missing or out of range, coverage is `unfinished` and rename is blocked. Yarn PnP projects without `node_modules` resolve nothing and report `unfinished`.

## Contributor contract

Al agregar o modificar una tool, mantener schemas, metadata, annotations, handler, errores y serialización en su módulo. Exportar un descriptor congelado y ubicarlo deliberadamente en `src/tools/catalog.ts`; el catálogo solo admite hechos estáticos de efecto, batch, compatibilidad y formatos directos.

Las expectativas de `tools/list` deben seguir siendo independientes: revisar el inventario y metadata completos antes de actualizar sus hashes, sin importar ni derivar valores desde el catálogo.

## Decision Gates

| Situación                              | Acción                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------- |
| Archivo o símbolo desconocido          | Descubrir con `ast_list_files`, `ast_explore` o `ast_search_symbols`   |
| Cambio cross-file                      | Consultar `ast_find_references`, `ast_get_impact` y candidatos de test |
| Evidencia stale, incompleta o ambigua  | Refrescar, usar fallback compiler-backed o fallar cerrado              |
| Rename, reemplazo de cuerpo o scaffold | Seguir el protocolo de preparación y apply por hash                    |
| Pipeline read-only conocido            | Considerar `ast-tool run`; no usar batch para exploración abierta      |

## Execution Steps

1. Leer la sección pertinente de `references/operations.md` y ejecutar el preflight.
2. Verificar trust, freshness, resolución y límites antes de decidir o mutar.
3. Para mutaciones, revisar el plan completo antes de aplicar ambos identificadores.
4. Ejecutar typecheck/build/tests relevantes y reportar evidencia y riesgo residual.

## Output Contract

Reportar tools y selectors usados, freshness, completitud y límites relevantes. Para mutaciones, incluir archivos afectados, diagnostics, identificadores aplicados y verificación. Declarar cualquier fallback textual como no compiler-backed.

## References

- `references/operations.md` — preflight, selección de tools, trust/freshness, batches, mutaciones, errores y límites.
