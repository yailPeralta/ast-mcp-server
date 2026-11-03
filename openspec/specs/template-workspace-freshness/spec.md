# Template Workspace Freshness Specification

## Purpose

Make resolved template files part of workspace freshness without altering non-Angular projects.

## Requirements

### Requirement: Templates join the workspace hash

When `@angular/core/package.json` resolves from the tsconfig directory, existing, contained external template files MUST contribute to the workspace hash. The template set MUST be derived inside the workspace snapshot itself (TypeScript-only discovery, no compiler needed), so prepare, prepare re-checks, the current workspace hash, and session synchronization cannot diverge. A template content change MUST change the hash.

#### Scenario: Html edit changes hash

- GIVEN an Angular project (core resolvable)
- WHEN a resolved `.html` template is modified
- THEN the workspace hash differs

#### Scenario: Hash independent of compiler

- GIVEN core is present and the compiler is missing
- WHEN a resolved `.html` template is modified
- THEN the workspace hash still differs

### Requirement: Non-Angular hash byte-identity

When `@angular/core` does not resolve, the workspace hash MUST be byte-identical to the pre-change value.

#### Scenario: Regression guard

- GIVEN a non-Angular fixture with a stray `.html` and a fake `@Component` but no core
- WHEN the hash is computed before and after the change
- THEN the values are equal

### Requirement: Watcher invalidation

Watched directories MUST include the directories of resolved template files, so a change, add, or removal of a template in a directory with no TypeScript source invalidates cached workspace state (`source_changed`) and the next request observes it.

#### Scenario: Template edited between requests

- GIVEN a cached workspace
- WHEN a resolved `.html` changes
- THEN the next `find_references` reflects the new content

#### Scenario: Template in a directory without TypeScript

- GIVEN a component whose `templateUrl` points to a directory containing no TypeScript source
- WHEN that `.html` changes
- THEN the watcher reports the change and the cached state is invalidated

### Requirement: Unreadable templates fail closed

A template that is missing, unsafe, or cannot be read or hashed safely MUST NOT be silently skipped from coverage: template coverage MUST be `unfinished` (reason `template_unresolved` or `template_unsafe`) and MUST NOT be `completed`.

#### Scenario: Template removed

- GIVEN a `templateUrl` target is deleted
- WHEN references are collected
- THEN coverage is `unfinished` with reason `template_unresolved`

### Requirement: Plans prepared before upgrade conflict

For Angular projects the hash set grows, so a plan retained across an upgrade MUST fail closed with the existing workspace-changed `CONFLICT` path.

#### Scenario: Pre-upgrade plan

- GIVEN an Angular-project plan prepared before the template files joined the hash
- WHEN apply runs after upgrade
- THEN it returns `CONFLICT`
