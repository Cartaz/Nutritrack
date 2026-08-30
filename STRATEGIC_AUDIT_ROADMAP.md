# NutriTrack — Strategic Audit Remediation Roadmap

Status: **active**  
Baseline audit: `main` at `e21d6575d21b96dccd5343735e9ce38a7d051cac`  
Created: 2026-08-30

## Goal

Reduce permanent complexity while fixing the correctness, data-integrity and release-safety issues identified in the strategic audit.

The objective is **not** to rewrite NutriTrack or introduce a framework. The existing strengths — vanilla TypeScript, pure nutrition/normalization modules, snapshot-based diary history, local-first storage, PWA support and deterministic unit tests — should be preserved.

Priorities, in order:

1. correctness;
2. data integrity;
3. conceptual simplicity;
4. maintainability / information hiding;
5. testability and robustness;
6. measured performance.

## Working rules

For every non-trivial change:

- fix the cause rather than adding another guard when feasible;
- keep one owner for each invariant or policy;
- prefer semantic operations to generic `Partial<T>` mutation APIs;
- avoid new Manager/Service/Repository layers unless they remove more complexity than they add;
- avoid speculative configuration and performance optimizations;
- add tests for contracts and failure modes, not implementation details;
- remove the obsolete path after a replacement is introduced;
- keep the repository green after every milestone.

---

# M0 — Immediate correctness and safety

**Objective:** remove known incorrect behavior before structural refactors.

### M0.1 Goal-calorie safety semantics

- [ ] Stop treating `500 kcal/day` as a "safe" fallback.
- [ ] Make invalid TDEE inputs produce an explicit invalid result instead of a plausible-looking target.
- [ ] Separate mathematical estimate from application safety policy.
- [ ] Update unit tests and user-facing warnings.
- [ ] Remove unsupported health-source wording from code/docs unless a precise source is maintained.

**Done when:** invalid TDEE cannot silently become a normal calorie target.

### M0.2 Biometric temporal correctness

- [ ] When viewing a historical date, infer weight only from measurements on or before that date.
- [ ] Add regression coverage for future measurements.
- [ ] Clarify whether weight moving average means 7 observations or 7 calendar days; rename or change the algorithm accordingly.

**Done when:** historical UI cannot use future biometric information.

### M0.3 Barcode abort contract

- [ ] Ensure native `BarcodeDetector` path resolves `null` on abort.
- [ ] Add deterministic abort tests.

**Done when:** every scanner backend has the same cancellation contract and leaves no pending promise after close.

### M0.4 Macro split invariant

- [ ] Guarantee normalized macro percentages sum to exactly 100 for finite inputs.
- [ ] Add property-style regression coverage for values slightly above and below 100.

**Done when:** `normalizeMacroSplit()` cannot return a total other than 100.

### M0.5 Privacy/documentation correctness

- [ ] Update privacy policy to disclose local water/sleep/weight storage.
- [ ] Remove stale claim that NutriTrack sets a custom browser `User-Agent` header.
- [ ] Reconcile the declared set of outbound data with the current implementation.

**Done when:** privacy documentation describes the shipped program rather than an older version.

---

# M1 — Data integrity and release integrity

## M1.1 Revisioned multi-tab synchronization

**Root cause:** remote snapshots can be deferred while a modal is open and later overwrite newer local work because snapshots have no causal/revision metadata.

### Chosen design

Use a monotonically increasing persisted revision plus a per-tab origin id.

Avoid CRDT/operation-log machinery: it would be disproportionate for the current local-first single-user application.

- [ ] Add persisted `revision` metadata without duplicating domain data.
- [ ] Increment revision on committed local state changes.
- [ ] Ignore stale remote snapshots.
- [ ] Preserve pending updates only when they are newer than local state.
- [ ] Add deterministic two-tab race regression tests.
- [ ] Document conflict semantics.

**Done when:** a stale remote state cannot overwrite a newer local mutation.

## M1.2 Deploy must depend on validation

- [ ] Make GitHub Pages deployment depend on the complete quality gate.
- [ ] Avoid duplicating validation logic in two independent workflows.
- [ ] Ensure tests/lint/format failure prevents deployment.
- [ ] Keep manual deployment possible only through the same validated artifact/path.

**Done when:** a commit that fails CI cannot deploy.

## M1.3 Coverage policy must be real or removed

- [ ] Run coverage in CI if thresholds are intended as a gate; otherwise remove misleading thresholds.
- [ ] Prefer risk-based integration tests over increasing coverage numbers for their own sake.

---

# M2 — Store API and persistence ownership

## M2.1 Narrow the store interface

**Root cause:** generic mutation functions push invariants and failure handling to callers.

- [ ] Inventory external calls to `setState`, `updateFood`, `updateRecipe`, `updateDiaryEntry`.
- [ ] Introduce semantic operations only where they remove real caller knowledge.
- [ ] Start with diary mutations: amount change, move entry, delete entry, add recipe atomically.
- [ ] Return explicit outcomes for semantic failures instead of partial silent success.
- [ ] Restrict direct generic mutation usage to hydration/testing/internal implementation.

**Done when:** normal UI code does not need to understand store representation invariants.

## M2.2 Separate persistence from domain state

**Root cause:** `store.ts` knows localStorage details because `storage.ts` already depends on the store.

- [ ] Define a one-way snapshot persistence boundary.
- [ ] Remove direct localStorage deletion from the store.
- [ ] Keep browser/storage details owned by persistence.
- [ ] Remove circular-import workarounds made unnecessary by the new ownership.

**Done when:** the domain store can exist and be tested without knowing localStorage keys.

## M2.3 Real schema migrations

- [ ] Keep normalization and schema migration as separate concepts.
- [ ] Introduce sequential migration functions before the first breaking schema change.
- [ ] Reject unsupported future schema versions instead of best-effort silent coercion.
- [ ] Add migration fixture tests.

---

# M3 — UI state and modal architecture

**Root cause:** adding one dialog currently requires touching AppState flags, renderer branches, modal-open detection, cleanup logic and often sync/reset code.

## M3.1 Consolidate dialog state

- [ ] Replace proliferating mutually-exclusive top-level modal flags with one discriminated dialog state where appropriate.
- [ ] Keep local/transient sub-dialog state inside the owning UI module when persistence/global coordination is unnecessary.
- [ ] Centralize `isAnyDialogOpen` knowledge.
- [ ] Eliminate duplicated modal inventories from keyboard shortcuts, storage sync and reset code.

**Done when:** adding a normal application dialog has one state owner and one render path.

## M3.2 Draft ownership for editors

- [ ] Treat editor form contents as drafts owned by the editor, not as reasons to freeze all remote state synchronization.
- [ ] Detect entity-level concurrent edits at save time when needed.
- [ ] Keep unrelated remote changes live while an editor is open.

---

# M4 — Remove duplicated knowledge

## M4.1 Shared statistics core

- [ ] Move statistics calculation into one pure module.
- [ ] Make worker and main-thread fallback call the same implementation.
- [ ] Remove "keep these implementations aligned" duplication.

## M4.2 Shared Open Food Facts search policy

- [ ] Centralize transient-error classification.
- [ ] Centralize partial-match expansion/effective-query/pagination policy.
- [ ] Keep search UI rendering and recipe ingredient UI separate.
- [ ] Expose a small search-domain API rather than another generic service layer.

## M4.3 Clarify debounce contracts

- [ ] Separate debounced trigger (`void`) from awaitable search execution (`Promise`).
- [ ] Remove misleading `await` usage on debounced functions.

---

# M5 — Rendering simplification and measured performance

## M5.1 Remove manual render-signature invalidation

- [ ] Establish a correctness baseline without manual view-signature caches.
- [ ] Delete signature bookkeeping if no measured regression justifies it.
- [ ] Profile before reintroducing any memoization.
- [ ] If needed, confine caching to demonstrably expensive derived statistics behind a small API.

**Done when:** correctness does not depend on developers remembering to update a hand-built signature after every new feature.

---

# M6 — Test campaign and cleanup

## M6.1 High-value integration tests

Add deterministic coverage for:

- [ ] multi-tab stale snapshot race;
- [ ] diary/store invariants;
- [ ] atomic recipe insertion;
- [ ] barcode cancellation;
- [ ] search cancellation/retry;
- [ ] schema migrations/import;
- [ ] one dashboard → search → add → edit → reload smoke flow.

## M6.2 Dead/stale code removal

- [ ] Remove unused constants/imports and speculative placeholders.
- [ ] Remove compatibility re-exports with no current caller.
- [ ] Replace historical `Fix BUG #...` comments with current invariants/rationale where the comment still adds value.
- [ ] Remove shallow wrappers that provide no information hiding.

## M6.3 Security/CSP hardening

- [ ] Remove inline image event-handler JavaScript.
- [ ] Make modal content construction safer by default so escaping is not purely caller discipline.
- [ ] Evaluate a restrictive CSP after inline handlers are gone.

## M6.4 Toolchain maintenance

- [ ] Upgrade Vite/PWA/Workbox in an isolated change.
- [ ] Validate typecheck, lint, test, build and offline/PWA smoke behavior.
- [ ] Do not mix dependency upgrades with architecture changes.

---

# Explicit non-goals

This roadmap does **not** propose:

- adopting React/Vue/Svelte;
- Redux or another global-state framework;
- a dependency injection container;
- generic Manager/Service/Repository layers;
- CRDTs unless multi-user/concurrent editing requirements materially change;
- a backend merely to simplify local code;
- speculative performance work without measurement;
- rewriting working pure modules for style alone.

---

# Milestone validation checklist

Every milestone must finish with:

- [ ] requirement satisfied;
- [ ] relevant regression tests added;
- [ ] typecheck green;
- [ ] lint green;
- [ ] formatting check green;
- [ ] unit/integration tests green;
- [ ] production build green;
- [ ] no obsolete implementation path left behind;
- [ ] no new duplicated invariant or configuration without a clear owner;
- [ ] final simplification pass: same behavior with fewer concepts?

## Current execution order

`M0.1 → M0.2 → M0.3 → M0.4 → M0.5 → M1.1 → M1.2 → M1.3 → M2 → M3 → M4 → M5 → M6`

The order can change only when a later dependency must be pulled forward to fix a correctness or integrity problem cleanly.
