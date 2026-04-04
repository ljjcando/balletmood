# Full Cloud Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Ballet Mood cloud sync to migrate and preserve the full history of local records by deeply merging local and cloud snapshots, resolving same-day conflicts by the newer `updatedAt`.

**Architecture:** Keep `records` as one full snapshot in the `ballet_mood_users` document, but always read local + cloud full snapshots before startup migration or save-time sync. Normalize date keys, deep-merge by date, choose the newer same-day record by `updatedAt`, then write the merged snapshot back to both local storage and cloud.

**Tech Stack:** WeChat Mini Program, CloudBase database, Node test runner

---

### Task 1: Add failing tests for full-history merge and migration

**Files:**
- Modify: `tests/cloud-sync-helper.test.js`
- Modify: `tests/index-page-cloud-sync.test.js`

- [ ] Add tests that prove startup migration uploads merged full history.
- [ ] Add tests that prove same-day conflicts choose the newer `updatedAt`.
- [ ] Run: `node --test tests/cloud-sync-helper.test.js tests/index-page-cloud-sync.test.js`
- [ ] Expect failures before implementation.

### Task 2: Implement full-snapshot merge in the helper

**Files:**
- Modify: `utils/cloud-sync-helper.js`

- [ ] Add normalization and merge helpers for full `records` snapshots.
- [ ] Make startup migration and save-time push load cloud + local, merge all history, then write the merged snapshot back to cloud.
- [ ] Run: `node --test tests/cloud-sync-helper.test.js`

### Task 3: Wire startup and save flows into full sync

**Files:**
- Modify: `pages/index/index.js`

- [ ] Make startup migration use the merged full snapshot and write it back to page state.
- [ ] Make save flow sync the complete merged snapshot, not only the current day.
- [ ] Run: `node --test tests/index-page-cloud-sync.test.js`

### Task 4: Verify the full suite

**Files:**
- Test: `tests/*.test.js`

- [ ] Run: `node --test tests/*.test.js`
- [ ] Confirm the whole suite stays green.
