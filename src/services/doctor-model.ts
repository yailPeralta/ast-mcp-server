import { sanitizePublicText } from "./public-errors.js";

export type DoctorStatus = "healthy" | "degraded" | "failed";
export type DoctorCheckStatus = DoctorStatus | "not_run";
export interface DoctorCheck {
  code: string;
  status: DoctorCheckStatus;
  summary: string;
  reason_code: string;
  continuation?: string;
}
export interface DoctorResult {
  schema_version: 1;
  status: DoctorStatus;
  checks: DoctorCheck[];
}

interface ComponentEvidence {
  state: string;
}
export interface DoctorEvidence {
  runtime_invalid: boolean;
  project_authority: "registered" | "isolated" | "unavailable" | "failed";
  runtime_admission: "open" | "closed";
  config: {
    state: "ready" | "missing" | "ambiguous" | "unsafe";
    continuation?: string;
    continuation_trusted?: boolean;
  };
  project?: {
    compiler: ComponentEvidence;
    watcher: ComponentEvidence;
    index: ComponentEvidence;
    operation_queue: {
      admission: string;
      rejected_operations: number;
      queue_timeout_operations: number;
      deadline_exceeded_operations: number;
    };
  };
  cache: { state: "ready" | "disabled" | "missing" | "failed"; unsafe_entry_count: number };
  package: { state: "ready" | "unsupported" | "failed"; version?: string };
  setup: { state: "ready" | "missing" | "outdated" | "conflict" | "failed" };
}

function item(
  code: string,
  status: DoctorCheckStatus,
  summary: string,
  reasonCode: string,
  continuation?: string,
  continuationTrusted = false,
): DoctorCheck {
  return {
    code,
    status,
    summary: sanitizePublicText(summary),
    reason_code: reasonCode,
    ...(continuation
      ? { continuation: continuationTrusted ? continuation : sanitizePublicText(continuation) }
      : {}),
  };
}

function overall(checks: readonly DoctorCheck[]): DoctorStatus {
  if (checks.some((check) => check.status === "failed")) return "failed";
  return checks.some((check) => check.status === "degraded") ? "degraded" : "healthy";
}

export function evaluateDoctor(evidence: DoctorEvidence): DoctorResult {
  const checks: DoctorCheck[] = [];
  checks.push(
    evidence.runtime_invalid
      ? item(
          "runtime_policy",
          "degraded",
          "Runtime limits contain invalid values and defaults were applied.",
          "invalid_runtime_policy",
          "Fix AST runtime limit values, then run: ast-tool doctor",
        )
      : item("runtime_policy", "healthy", "Runtime limits are admitted.", "runtime_policy_ready"),
  );
  checks.push(
    evidence.config.state === "ready"
      ? item("project_config", "healthy", "A unique project config was resolved.", "config_ready")
      : item(
          "project_config",
          "failed",
          "Project config discovery did not produce a safe unique identity.",
          `config_${evidence.config.state}`,
          evidence.config.continuation,
          evidence.config.continuation_trusted,
        ),
  );

  if (evidence.project) {
    const { compiler, watcher, index, operation_queue: queue } = evidence.project;
    checks.push(
      compiler.state === "ready"
        ? item("compiler", "healthy", "Compiler synchronization is ready.", "compiler_ready")
        : item(
            "compiler",
            compiler.state === "failed" ? "failed" : "degraded",
            "Compiler synchronization is not ready.",
            `compiler_${compiler.state}`,
            "Run: ast-tool doctor",
          ),
    );
    checks.push(
      watcher.state === "ready"
        ? item("watcher", "healthy", "Project watcher is ready.", "watcher_ready")
        : item(
            "watcher",
            "degraded",
            "Project watcher is unavailable; compiler reads may require resynchronization.",
            `watcher_${watcher.state}`,
            "Restart MCP clients, then run: ast-tool doctor",
          ),
    );
    checks.push(
      evidence.project_authority === "isolated" && index.state === "disabled"
        ? item(
            "derived_index",
            "not_run",
            "Persistent derived-index inspection is disabled for an isolated diagnosis.",
            "index_not_run_diagnostic_policy",
          )
        : index.state === "ready" || index.state === "disabled"
          ? item(
              "derived_index",
              "healthy",
              index.state === "ready"
                ? "Derived symbol index is ready."
                : "Derived symbol index is disabled by admitted policy.",
              `index_${index.state}`,
            )
          : item(
              "derived_index",
              "degraded",
              compiler.state === "ready"
                ? "Derived index is unavailable; compiler-backed file operations remain available."
                : "Derived index is unavailable while compiler synchronization is not ready.",
              compiler.state === "ready" ? "index_degraded_compiler_ready" : `index_${index.state}`,
              "Run: ast-tool cache inspect",
            ),
    );
    const queueDegraded =
      evidence.runtime_admission !== "open" ||
      queue.admission !== "open" ||
      queue.rejected_operations > 0 ||
      queue.queue_timeout_operations > 0 ||
      queue.deadline_exceeded_operations > 0;
    checks.push(
      evidence.project_authority === "isolated" && evidence.runtime_admission === "open"
        ? item(
            "operation_queue",
            "not_run",
            "No registered project queue exists to inspect.",
            "queue_not_run_no_registered_session",
          )
        : queueDegraded
          ? item(
              "operation_queue",
              "degraded",
              "Operation queue reports admission or timeout pressure.",
              evidence.runtime_admission === "closed"
                ? "runtime_admission_closed"
                : "queue_pressure",
              "Run: ast-tool doctor",
            )
          : item("operation_queue", "healthy", "Operation queue is accepting work.", "queue_ready"),
    );
  } else if (evidence.config.state === "ready" && evidence.project_authority === "unavailable") {
    checks.push(
      item(
        "compiler",
        "not_run",
        "Compiler diagnosis is unavailable while runtime admission is closed.",
        "compiler_not_run_runtime_closed",
      ),
      item("watcher", "not_run", "Watcher check requires compiler diagnosis.", "watcher_not_run"),
      item(
        "derived_index",
        "not_run",
        "Derived index check requires compiler diagnosis.",
        "index_not_run",
      ),
      item(
        "operation_queue",
        "degraded",
        "Project runtime admission is closed.",
        "runtime_admission_closed",
        "Restart MCP clients, then run: ast-tool doctor",
      ),
    );
  } else if (evidence.config.state === "ready") {
    checks.push(
      item(
        "compiler",
        "failed",
        "Compiler creation failed.",
        "compiler_creation_failed",
        "Run: ast-tool doctor",
      ),
      item("watcher", "not_run", "Watcher check requires a ready compiler.", "watcher_not_run"),
      item(
        "derived_index",
        "not_run",
        "Derived index check requires a ready compiler.",
        "index_not_run",
      ),
      item(
        "operation_queue",
        "not_run",
        "Queue check requires a diagnostic project.",
        "queue_not_run",
      ),
    );
  } else {
    checks.push(
      item("compiler", "not_run", "Compiler check requires a project config.", "compiler_not_run"),
      item("watcher", "not_run", "Watcher check requires a project config.", "watcher_not_run"),
      item(
        "derived_index",
        "not_run",
        "Derived index check requires a project config.",
        "index_not_run",
      ),
      item("operation_queue", "not_run", "Queue check requires a project config.", "queue_not_run"),
    );
  }

  checks.push(
    evidence.cache.state === "failed" || evidence.cache.unsafe_entry_count > 0
      ? item(
          "index_cache",
          "degraded",
          "Index cache inspection found unavailable or unsafe state.",
          evidence.cache.unsafe_entry_count > 0 ? "cache_unsafe" : "cache_failed",
          "Run: ast-tool cache inspect",
        )
      : item(
          "index_cache",
          "healthy",
          `Index cache is ${evidence.cache.state}.`,
          `cache_${evidence.cache.state}`,
        ),
  );
  checks.push(
    evidence.package.state === "ready"
      ? item(
          "package",
          "healthy",
          `Package version ${evidence.package.version ?? "unknown"} is locally admitted.`,
          "package_ready",
        )
      : item(
          "package",
          "degraded",
          "Running package provenance could not be admitted locally.",
          `package_${evidence.package.state}`,
          "Run: ast-tool upgrade --check",
        ),
  );
  checks.push(
    evidence.setup.state === "ready"
      ? item("client_setup", "healthy", "Detected client skills are current.", "setup_ready")
      : item(
          "client_setup",
          "degraded",
          "Detected client skill setup requires attention.",
          `setup_${evidence.setup.state}`,
          evidence.setup.state === "conflict"
            ? "Run: ast-tool setup --agents all --yes --force-skill"
            : "Run: ast-tool setup --agents all --yes",
        ),
  );
  return { schema_version: 1, status: overall(checks), checks: checks.slice(0, 9) };
}
