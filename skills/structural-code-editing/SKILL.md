---
name: structural-code-editing
description: "Trigger: navegar, analizar o editar TypeScript/JavaScript con el compilador. Use tools AST preparadas, revisadas y vinculadas por hash."
license: "ISC"
metadata:
  author: "yail"
  version: "4.5.0"
  hermes:
    tags: ["typescript", "javascript", "ast", "refactoring", "mcp"]
    homepage: "https://github.com/yailPeralta/ast-mcp-server"
---

# Edición estructural con el servidor MCP `ast`

## Activation Contract

Cargar este skill antes de navegar semánticamente, analizar impacto o referencias, consultar diagnostics o preparar una mutación TypeScript/JavaScript gobernada por el compilador.

No forzar un roundtrip AST para Markdown, configuración, comentarios ni una edición textual trivial en un archivo ya conocido. Si las tools `ast_*` no están disponibles, declarar el fallback y no presentar búsquedas textuales como evidencia compiler-backed.

## Hard Rules

- Verificar primero que las tools existen y que `ast_get_project_status` informa un proyecto usable.
- Tratar como autoritativa solo evidencia `compiler` + `exact` + `resolved` + `fresh`.
- Revisar siempre límites, `completeness`, `unresolved` y `truncation` antes de inferir ausencia.
- Preparar mutaciones, revisar preview y diagnostics, y aplicar únicamente con el `operation_id` y `plan_hash` exactos.
- Nunca reconstruir postimages desde un diff; después del apply, ejecutar el gate canónico del proyecto.
- Conservar `correlation_id` en errores públicos sin exponer source, paths absolutos, argumentos, environment, cache, stacks ni credenciales.

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
