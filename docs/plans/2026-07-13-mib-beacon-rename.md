# MIB Beacon Rename Implementation Plan

> **For Codex:** Execute this plan task-by-task in the current checkout, preserving unrelated working-tree changes.

**Goal:** Rename Open MIB Catalog to MIB Beacon across every source, package, runtime, bundle, repository, path, and release identity surface.

**Architecture:** Use `MIB Beacon` as the product name, `SNMP toolkit` as the generic descriptor, `com.librestatic.mibbeacon` as the application ID, `@mibbeacon/*` as the workspace package scope, and `MIB_BEACON_*` as the environment-variable prefix. Keep LibreStatic as publisher and use `.mibbeacon` for new local data because the application has not yet been published.

**Tech Stack:** TypeScript, React Native, Electron, Expo, pnpm workspaces, Flatpak, GitHub Actions, Vitest.

---

### Task 1: Lock the new release identity in tests

**Files:**
- Modify: `tests/release-identity.test.ts`

1. Change expected product, app ID, executable, package scope, scheme, and Flatpak filenames.
2. Add assertions that release metadata uses the generic descriptor `SNMP toolkit` and does not retain the old identity.
3. Run `pnpm verify:release-metadata` and confirm it fails against the old metadata.

### Task 2: Rename package and runtime identity

**Files:**
- Modify: root/app/package `package.json` files, `tsconfig.base.json`, imports, lint rules, source comments, runtime labels, URLs, user agent, environment variables, and data paths.
- Modify: `pnpm-lock.yaml` through `pnpm install --lockfile-only`.

1. Replace `@omc/*` with `@mibbeacon/*` and update aliases/dependencies/filters.
2. Replace product labels, repository URLs, user agent, deep-link scheme, environment variables, and default data directories.
3. Keep compatibility fallbacks for legacy `OMC_*` environment variables and legacy `.openmibcatalog` data when appropriate.

### Task 3: Rename platform packaging paths

**Files:**
- Rename: `packaging/flatpak/com.librestatic.openmibcatalog.*` to `packaging/flatpak/com.librestatic.mibbeacon.*`.
- Modify: Electron, Expo, Android/iOS generation inputs, Flatpak metadata, and release workflow.

1. Rename Flatpak files and internal references.
2. Set Electron/Expo identifiers and artifact names to MIB Beacon.
3. Update generated native projects through Expo prebuild where practical; generated ignored build artifacts are not source of truth.

### Task 4: Rename documentation and fixtures

**Files:**
- Modify: `README.md`, `docs/**`, `dev/snmpd/snmpd.conf`, tracked Playwright snapshots.

1. Replace historical product and package references while preserving technical meaning.
2. Use `SNMP toolkit` as a descriptor, not a second product title.

### Task 5: Verify the complete rename

1. Search tracked files and tracked pathnames for every old identity variant.
2. Run release identity tests, full tests, lint, typecheck, desktop build, and relevant mobile/Flatpak metadata checks.
3. Inspect `git diff --check`, `git status`, and the final diff to ensure unrelated pre-existing changes remain intact.
