# Multi-tab synchronization semantics

NutriTrack synchronizes the persisted application snapshot between tabs through the browser `storage` event.

## Ownership

`src/lib/storage.ts` owns the synchronization metadata and conflict policy. Domain/store callers do not manipulate revisions directly.

Every persisted storage snapshot contains two internal fields:

- `revision`: monotonically increasing integer for committed snapshots;
- `originTabId`: per-tab identifier used only to break ties when two tabs commit the same revision concurrently.

These fields are persistence metadata. User JSON exports intentionally omit them.

## Ordering

A local commit receives a revision greater than both:

1. the latest revision already observed by the current tab;
2. the revision currently present in `localStorage`.

Remote snapshots are applied only when their `(revision, originTabId)` stamp is newer than the current one. Revision is compared first; `originTabId` is a deterministic tie-break only for equal revisions.

## Local dirty state

A local state change may exist before the RAF-batched autosave runs. When a remote snapshot arrives, or when a deferred remote snapshot is flushed after a modal closes, NutriTrack first commits any dirty local persisted state. That local commit receives a newer revision, so the older remote snapshot can no longer overwrite it.

This is the invariant M1.1 protects: **a stale remote snapshot must never replace a newer local mutation**.

## Open modal behavior

While a top-level modal is open, newer remote snapshots are deferred. Only the newest pending snapshot is retained. When the last modal closes:

1. local dirty persisted state is committed first;
2. the pending remote snapshot is re-evaluated against the new local revision;
3. it is applied only if it is still newer.

Editor draft ownership will be refined later in M3; M1.1 deliberately fixes data loss without expanding the UI-state refactor scope.

## Concurrent writes

Synchronization is snapshot-based, not field-merge-based. If two tabs independently commit from the same predecessor, both may initially produce the same revision. `originTabId` provides a stable total order, and the winning snapshot can be re-persisted at a higher revision when necessary.

NutriTrack does not attempt CRDT or operation-log merging. That complexity is not justified for the current local-first single-user application.

## Legacy payloads

Payloads created before revision metadata existed remain readable and are treated as revision `0`. Once a tab has established versioned history, versioned snapshots take precedence over legacy revision-0 snapshots. Concurrent editing between an upgraded tab and a still-running pre-M1 build is not a supported merge scenario; users should allow all open tabs to update to the same application version.
