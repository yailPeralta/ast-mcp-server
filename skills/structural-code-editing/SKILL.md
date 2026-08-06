---
name: structural-code-editing
description: Leer, navegar y editar proyectos TypeScript/JavaScript mediante el resolver real del compilador y operaciones AST preparadas, revisadas y vinculadas por hash.
version: "4.0.0"
author: "yail"
license: "ISC"
metadata:
  hermes:
    tags: ["typescript", "javascript", "ast", "refactoring", "mcp"]
    homepage: "https://github.com/yailPeralta/ast-mcp-server"
---

# Edición estructural con el servidor MCP `ast`

## Cuándo usarlo

Usar las tools del servidor MCP `ast` en proyectos TypeScript/JavaScript con `tsconfig.json` cuando haya que:

- orientarse en archivos o módulos grandes/desconocidos;
- leer rangos acotados del source exacto de un archivo conocido;
- encontrar declaraciones o referencias reales;
- medir el radio de impacto de un rename;
- renombrar un símbolo en varios archivos;
- reemplazar solo el cuerpo de una función, método, accessor o callable property;
- crear un archivo de clase nuevo mediante un scaffold estructurado y revisado;
- obtener diagnostics sin cargar el proyecto como texto en el contexto.

Para configs, Markdown, comentarios o una edición textual trivial en un archivo ya conocido, usar las tools normales de archivos. El AST no cobra alquiler, pero cada roundtrip sí.

## Preflight de disponibilidad

La presencia de este skill no demuestra que el transporte MCP esté configurado. Si las tools `ast_*` no aparecen, no simularlas con búsquedas textuales mientras se afirma que son estructurales:

- desde el checkout del servidor, ejecutar `yarn setup` para detectar agentes, registrar el MCP e instalar el skill;
- desde un paquete instalado, ejecutar `ast-tool setup`;
- verificar Claude Code con `/mcp` o `claude mcp get ast`;
- verificar Hermes con `hermes mcp test ast` y recargar la sesión si acaba de cambiar la configuración.

El setup falla cerrado ante un registro `ast` conflictivo. No eliminar ni reemplazar una configuración existente sin revisión explícita.

## Flujo compacto de lectura

1. `ast_list_files` para descubrir archivos. Paginar; no pedir todo un monorepo si alcanza con un filtro.
2. `ast_get_project_status` para comprobar compiler, freshness, watcher, index y operation queue antes de confiar en una lectura sensible.
3. `ast_explore` para una pregunta de lectura que combine descubrimiento y evidencia. Usar `summary` por defecto, `context` para source seleccionado y `full` para source más referencias.
4. `ast_get_file` si ya se conoce el archivo y hace falta source exacto. Usar `offset`/`limit`; no cargar el archivo completo por defecto.
5. `ast_search_symbols` si todavía no se conoce el archivo o el selector exacto.
6. `ast_get_outline` para ver contratos sin cuerpos. No pedir `include_symbols` salvo que haga falta la metadata detallada.
7. `ast_get_symbol_source` solo para las declaraciones cuya implementación haya que inspeccionar.
8. `ast_find_references` antes de renames o cambios con impacto cross-file.
9. `ast_get_impact` para explorar impacto directo/transitivo con relaciones compiler-backed y límites explícitos.
10. `ast_get_diagnostics` para establecer y verificar el estado del proyecto.

`ast_search_symbols` devuelve por default hasta 20 records `summary` rankeados. Su campo `selector` es el valor que se pasa como `symbol_path` a la siguiente tool; pedir `detail: "selectors"` para routing puro o `detail: "full", limit: 100` para el perfil v0.4.0. `ast_find_references` devuelve `detail: "locations"` por default; expandir a `detail: "context"` únicamente cuando la línea fuente aporte evidencia necesaria.

`file_path` debe ser preferentemente relativo al proyecto. Si un suffix coincide con varios archivos, la tool falla y devuelve candidatos en vez de elegir uno silenciosamente.

`ast_get_file` es read-only y solo acepta archivos incluidos por el tsconfig activo. Su modo normal devuelve líneas exactas, paginadas y numeradas desde 1, junto con el hash SHA-256 de los bytes actuales. `symbols_only: true` devuelve selectors y signatures sin cuerpos. `snapshot_state: "fresh"` describe sincronización con el snapshot del compilador, no ausencia de diagnostics; consultar `ast_get_diagnostics` por separado.

`ast_explore` es read-only y no prepara ni aplica operaciones. Sus selectors son directamente reutilizables por las tools primitivas y de mutación. La respuesta declara `freshness`, `completeness`, `truncation`, `unresolved` y `budget`; si el límite de bytes impide incluir todo el contexto, el resultado queda marcado como incompleto.

## Modelo de confianza y freshness

No tratar toda salida como evidencia equivalente. Cuando una relación expone metadata de trust:

- `provenance: "compiler"` + `confidence: "exact"` + `resolution: "resolved"` + `freshness.state: "fresh"` es la única combinación que puede llevar `compiler_authoritative: true`.
- `provenance: "syntax"` describe estructura AST sin resolución semántica; sirve para navegación, no para afirmar que dos símbolos están conectados.
- `provenance: "heuristic"` describe una sugerencia por convención o nombre; nunca autoriza una mutación ni un candidato de test compiler-backed.
- El índice es una aceleración derivada y no una autoridad. Validar cualquier selector contra el compilador; si el índice está stale, falta o no coincide, usar el fallback compiler-backed o fallar cerrado.

`fresh` significa que la evidencia coincide con el snapshot sincronizado. `pending`, `rebuilding`, `stale` y `degraded` no deben presentarse como evidencia actual. Las respuestas preservan `causes` (`source_change`, `config_change`, `index_failure`, `watcher_failure`, `compiler_rebuild`) y `checked_at`. `ast_get_impact` rechaza relaciones que no estén fresh; `ast_explore` conserva `completeness`, `unresolved`, `budget` y `truncation` para que una lectura parcial no parezca un negativo.

El resolver interno de candidatos de tests solo acepta impacto fresh y exacto, devuelve evidencia de relación directa o transitiva con IDs bounded y no ejecuta tests. Si la relación es stale, está truncada, es ambigua o solo heurística, no genera candidatos.

Todos los reads son bounded. Respetar `limit`, `reference_limit`, `max_bytes`, y en impacto `max_depth`, `max_nodes` y `max_edges`; revisar siempre `budget` y `truncation` antes de razonar sobre ausencia. Los límites de batch son independientes y también deben mantenerse explícitos.

Los clientes pueden prefijar los nombres publicados (`ast_*`) según su convención MCP; elegir por el nombre base y el schema, no adivinar el prefijo.

## Formato de resultado para el modelo

`ast_search_symbols`, `ast_find_references`, `ast_get_impact` y `ast_get_diagnostics` aceptan `output_format: "toon"`. Usarlo cuando la respuesta vaya directo al modelo y se espere una colección uniforme con varios registros. Omitirlo, o usar `json`, para automatización que dependa del objeto canónico.

En MCP, TOON llega como un único envelope estructurado `{ "format": "toon", "data": "..." }`; `data` contiene el documento TOON lossless. No hay una copia JSON completa en paralelo. Las cuatro tools validan primero el valor canónico con Zod, pero no publican un `outputSchema` MCP único porque tienen dos representaciones de éxito.

No pedir TOON para `ast_list_files`, outlines, source, previews ni mutaciones: los benchmarks muestran que el envelope empeora esas formas pequeñas, multiline o diff-heavy. Para un pipeline read-only conocido, se puede compactar únicamente el resultado final con:

```text
ast-tool run pipeline.json --output-format toon
```

Los pasos internos del batch siempre son JSON estructurado. TOON dentro de `step.input` y TOON final para un batch de preparación se rechazan antes de ejecutar la operación.

## Batch CLI para clientes con Bash

Cuando un pipeline conocido requiere varias llamadas MCP dependientes y el cliente tiene Bash, usar `ast-tool run pipeline.json` para colapsar los roundtrips del modelo. No usar batch para exploración abierta ni asumir que reduce el trabajo interno del compilador.

- Encadenar outputs previos con objetos `{ "$ref": "#/steps/id/campo" }`.
- Usar `foreach` más `{ "$item": "/campo" }` solamente para lecturas acotadas.
- Definir `emit` para que los resultados intermedios no entren al contexto.
- Mantener paginación y filtros: batch elimina roundtrips, no vuelve razonable leer un monorepo entero.
- No generar JavaScript/eval dentro del documento; el contrato es declarativo y limitado.

`ast-tool validate pipeline.json` valida schema, orden de referencias y política sin cargar el proyecto. Límites por defecto: 50 steps, 500 invocaciones, 200 items por foreach, concurrencia 4 (máximo 16), input 1 MiB, 10 MiB por resultado retenido/output y 50 MiB de contexto intermedio acumulado. Los errores del CLI permanecen como JSON en stderr aunque el output exitoso solicitado sea TOON.

## Flujo obligatorio de mutación

Las tools de rename, reemplazo y scaffold **solo preparan**. `dry_run: false` directo está deshabilitado.

1. Llamar `ast_rename_symbol`, `ast_replace_symbol_body` o `ast_scaffold_class` con `dry_run: true`.
2. Revisar:
   - `affected_files`;
   - summaries y previews;
   - diagnostics agregados/removidos;
   - `blocked` y el valor visible de `allow_new_errors`.
3. Si el preview inline está truncado o hay varios archivos, pedir diffs completos con `ast_get_operation_preview`.
4. Aplicar con `ast_apply_operation`, pasando **ambos**:
   - `operation_id`;
   - `plan_hash`.
5. Ejecutar el typecheck/build/test canónico del proyecto después del apply.

Nunca reconstruir el contenido a aplicar a partir del diff. Apply escribe los postimages exactos retenidos en el plan.

### Scaffold de clase

Usar `ast_scaffold_class` solo para crear un `.ts`/`.tsx` ausente con una clase estructurada. Pasar imports, heritage, decorators, constructor params, properties inicializadas y métodos mediante el schema; no inyectar un archivo completo como string. Debe haber al menos un método.

Cada método generado contiene exclusivamente `throw new Error("Not implemented: Class.method")`. Preparar el scaffold, revisar el diff desde `/dev/null`, diagnostics, `pending_methods`, `blocked` y `plan_hash`, aplicar y luego reemplazar cada selector pendiente con `ast_replace_symbol_body`. Un target existente, path fuera del proyecto o parent simbólico debe fallar; no buscar un fallback textual.

### Mutaciones desde el CLI

Un batch puede terminar en una sola preparación, pero nunca puede incluir `ast_apply_operation`. El resultado expone `operation_id`, `plan_hash` y `plan_file` en el nivel superior aunque `emit` los omita; revisar preview, diagnostics y affected files, y aplicar en otra llamada:

```text
ast-tool apply <plan_file> --plan-hash <reviewed_sha256>
```

Los planes CLI sobreviven al proceso bajo `${XDG_STATE_HOME:-~/.local/state}/ast-tool/plans` (o `AST_TOOL_STATE_DIR`), contienen bytes de código exactos y son privados. No copiar su contenido al chat si el repo es sensible.

## Seguridad que sí ofrece

- proyecto fresco al preparar mutaciones;
- diagnostics pre/post y bloqueo de errores nuevos por default;
- plan vinculado por hash al workspace completo, configs extendidos/referenciados y postimages;
- rechazo si cambió cualquier source/config antes de apply;
- lock filesystem cooperativo por config/workspace canónico compartido por MCP y CLI;
- staging, flush, rename para reemplazos y creación no-clobber para targets nuevos, con verificación de hash y rollback conservador;
- scaffold create-only con target ausente, parent real, postimage incluida en el fingerprint y diff contra `/dev/null`;
- retry idempotente de un operation ya aplicado;
- preservación de modo y UTF-8 BOM.

La edición AST no demuestra que un cambio sea semánticamente correcto ni vuelve imposible romper código. La garantía práctica surge de combinar selección estructural, diagnostics, preview exacto, hash revisado, freshness checks y apply fail-closed.

## Límites

- No es una transacción global multiarchivo: la atomicidad depende del rename por archivo.
- El rollback es best effort y no pisa cambios de otro writer.
- El lock coordina superficies de apply que usan el mismo state directory; no coordina editores, NFS ni writers hostiles.
- Los planes MCP son in-memory y se pierden al reiniciar el servidor; los planes CLI son archivos privados, versionados y con el mismo TTL.
- El receipt se persiste dentro de la sección crítica. Si esa persistencia falla después de reemplazar sources, apply sale no-cero y el retry recupera sólo si el workspace completo coincide exactamente con el fingerprint post-apply revisado.
- Un crash duro puede dejar un lock stale: retirarlo requiere inspeccionar metadata y confirmar que no hay apply activo. Un estado parcial o divergente sigue fallando cerrado.
- Solo admite sources UTF-8 con o sin BOM.
- No implementa migración arbitraria de firmas, creación/eliminación general de archivos ni lenguajes fuera de TS/JS; la única creación admitida es el scaffold de una clase.
- `allow_new_errors: true` evita el bloqueo del plan; no convierte código roto en código sano.

## Verificación

Después de aplicar, correr el gate canónico del repo. Como mínimo, un typecheck/build. Para cambios cross-file o con dinero/producción en juego, también la suite focalizada y la completa que corresponda.
