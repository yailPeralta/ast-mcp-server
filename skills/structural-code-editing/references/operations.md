# Operaciones estructurales

## Preflight y disponibilidad

La presencia del skill no demuestra que MCP esté configurado. Confirmar las tools `ast_*` y consultar `ast_get_project_status` antes de confiar en evidencia sensible.

El setup falla cerrado ante un registro `ast` conflictivo. No borrar ni reemplazar configuración ajena sin revisión explícita. El transporte soportado es stdio local bajo los permisos filesystem del usuario; no asumir autenticación HTTP, sandbox, aislamiento entre tenants ni seguridad para clientes remotos no confiables.

## Ruta de lectura

| Necesidad                       | Tool y contrato                                                              |
| ------------------------------- | ---------------------------------------------------------------------------- |
| Descubrir archivos              | `ast_list_files`; filtrar y paginar                                          |
| Ver salud y freshness           | `ast_get_project_status`; revisar compiler, watcher, index y operation queue |
| Resolver una pregunta compuesta | `ast_explore`; usar `summary`, `context` o `full` con presupuesto explícito  |
| Leer contrato o implementación  | `ast_get_file`, `ast_get_outline` o `ast_get_symbol_source`                  |
| Encontrar declaraciones         | `ast_search_symbols`; reutilizar `selector` como `symbol_path`               |
| Usos, impacto y tests           | `ast_find_references`, `ast_get_impact` y `ast_find_test_candidates`         |
| Comprobar errores               | `ast_get_diagnostics` antes y después del cambio                             |

Preferir `file_path` relativo; un suffix ambiguo debe devolver candidatos. `ast_get_file` solo admite archivos del tsconfig activo y `snapshot_state: "fresh"` no implica cero diagnostics. `ast_explore` es read-only: revisar `budget`, `completeness`, `unresolved` y `truncation`; sus `call_spines` son recorridos estáticos, no stacks de runtime.

### Angular templates

`ast_find_references` adds template usages (`origin: "template_external" | "template_inline"`, `template_coverage`, `template_reference_count`) only when `@angular/core` resolves; otherwise the response is unchanged. Treat `template_coverage.status` other than `completed` as not proving absence. Selector-bound members (`@Input`, `@Output`, `input()`, `output()`, `model()`, literal aliases, literal `inputs` / `outputs` metadata) also list their bindings in consumer templates (kinds `TemplateInputBinding` for `[x]`, `TemplateAttribute` for `x="lit"`, `TemplateTwoWayBinding` for `[(x)]` and `TemplateOutputBinding` for `(y)` and `(xChange)`), and `@Pipe` classes and their `transform` list `| name` usages (kind `TemplatePipeName`), for components whose resolved standalone or NgModule scope contains the declaring class. For them, `completed` covers templates inside the Project only. `hostDirectives`, `@Directive` inputs and outputs, and non-literal scopes, aliases or names stay `unfinished` with `cross_component`; runtime bindings (`setInput`, router input binding, `createComponent`) and consumers outside the Project are never examined. `ast_explore` is TypeScript-only for references (tracked in issue #380).

The `diagnostics` field stays TypeScript-only. When a rename edits a template, the plan also carries `template_diagnostics`, a best-effort template type-check delta (`status`, `reason`, `added`, `removed`, `added_errors`) from the project's own `@angular/compiler-cli`; it is absent for non-Angular projects and for renames that edit no template. `completed` is the only status with data; `unavailable` (`compiler_cli_missing`, `compiler_unsupported`, `typescript_incompatible`) and `unfinished` (`work_exhausted`, `deadline`, `check_failed`) mean unknown, so run the project's build or tests before applying. `block_on_template_errors` (default `false`) blocks only a `completed` delta with `added_errors`, and `allow_new_errors` waives it. `template_diagnostics[].file` is relative to the directory of the tsconfig, while `diagnostics[].file` is relative to `project_root`. `@angular/compiler-cli` is not a declared peer and must resolve from the project, otherwise the status is `unavailable/compiler_cli_missing`. Template-editing renames persist as plan schema v3, which is rejected on import after a downgrade.

`ast_rename_symbol` edits external templates, including consumer templates of a selector-bound member with `completed` coverage, and returns `INCOMPLETE_EVIDENCE` (coverage `unfinished` or `unsupported`, `hostDirectives`, `@Directive` members, metadata-listed members, non-literal aliases) or `MUTATION_BLOCKED` (inline usage, template-local or binding-name collision, `[(x)]` on a non-`model()` pair, `$any`, name in the selector). Renaming a `@Pipe` class applies TypeScript edits only and keeps the `name` literal and `| name` usages; renaming `transform` returns `INCOMPLETE_EVIDENCE`. The user's `@angular/compiler` is an optional peer, never bundled; Yarn PnP projects without `node_modules` report `unfinished`. See the Angular templates section of `SKILL.md`.

## Trust, freshness y ausencia

Solo `provenance: "compiler"`, `confidence: "exact"`, `resolution: "resolved"` y `freshness.state: "fresh"` producen evidencia autoritativa. `syntax` describe estructura; `heuristic` nunca autoriza una mutación. El índice acelera, pero el compilador valida. Administrar su cache derivada solo con `ast-tool cache inspect` y `ast-tool cache clear --yes`, nunca borrándola manualmente. La ausencia usa el contrato específico: solo `ast_find_test_candidates` usa `completeness.proven_empty` para evidencia vacía de tests afectados; `ast_explore.call_spines` usa `empty_proven`; listados, búsquedas y referencias agotan paginación con `total`, `has_more` y `next_offset` según corresponda, nunca con `proven_empty`.

## Resultados y batches

Las búsquedas, referencias, impacto y diagnostics aceptan `output_format: "toon"`; usar JSON para automatización y evitar TOON en source, previews o mutaciones. Para un pipeline read-only conocido, `ast-tool run pipeline.json` admite `$ref`, `foreach`/`$item` acotado y `emit`; validar con `ast-tool validate pipeline.json`. Batch no admite apply, JavaScript ni eval, y no reduce el trabajo del compilador. Si termina preparando, revisar y aplicar aparte con `ast-tool apply <plan_file> --plan-hash <reviewed_sha256>`; mantener privados los planes con código exacto.

## Protocolo obligatorio de mutación

`ast_rename_symbol`, `ast_replace_symbol_body` y `ast_scaffold_class` solo preparan operaciones.

1. Preparar con `dry_run: true`.
2. Revisar `affected_files`, preview, diagnostics, `blocked` y `allow_new_errors`.
3. Si el preview está truncado o hay varios archivos, pedir diffs con `ast_get_operation_preview`.
4. Aplicar con `ast_apply_operation` pasando el `operation_id` y `plan_hash` exactos.
5. Ejecutar el gate canónico del proyecto.

Nunca reconstruir contenido desde el diff: apply usa las postimages retenidas y falla si cambió el workspace.

### Scaffold

`ast_scaffold_class` crea únicamente un `.ts`/`.tsx` ausente con una clase estructurada y al menos un método. Revisar el diff desde `/dev/null`, `pending_methods` y diagnostics; aplicar y completar cada método con `ast_replace_symbol_body`. Un target existente, fuera del proyecto o con parent simbólico debe fallar, no activar un fallback textual.

## Seguridad, errores y límites

Las operaciones preparadas vinculan el plan al workspace, configuración, diagnostics y postimages. Apply verifica cambios, coordina con lock cooperativo, conserva modo/BOM, usa reemplazos seguros y rollback conservador, y admite retry idempotente del mismo plan aplicado.

Estas garantías no demuestran corrección semántica ni coordinan editores, NFS o writers hostiles. El rollback es best effort; un crash puede dejar un lock stale; los planes tienen TTL; solo se admiten sources UTF-8. No hay migración arbitraria de firmas, creación/eliminación general ni lenguajes fuera de TS/JS.

Los errores MCP públicos usan `{ "error": { "code", "message", "correlation_id" } }` con `isError: true`. Conservar `correlation_id`; no pedir ni exponer stacks, source, paths absolutos, cache, argumentos crudos, environment ni credenciales.
