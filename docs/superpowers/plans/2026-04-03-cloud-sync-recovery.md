# Cloud Sync Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Ballet Mood recover full user history after WeChat Mini Program cache cleanup, including text records and photos.

**Architecture:** Keep WeChat identity as the user boundary, treat local storage as the first available source, and use cloud sync as the durable backup. On startup, migrate any local-only photos and records to the cloud, merge the full history snapshot, and restore from cloud only when local records are empty.

**Tech Stack:** WeChat Mini Program, WeChat CloudBase database, WeChat cloud storage, Node test runner

---

### Task 1: Lock the failing recovery behaviors with tests

**Files:**
- Modify: `tests/cloud-sync-helper.test.js`
- Modify: `tests/index-page-cloud-sync.test.js`

- [ ] Add a helper-level test that proves restore skips empty same-user docs and restores the latest non-empty snapshot.
- [ ] Add a page-level test that proves startup migration replaces local temp photo paths with `cloud://` file ids in page state.
- [ ] Keep the async startup render test so `onLoad` must wait for restored calendar state before resolving.
- [ ] Run: `node --test tests/cloud-sync-helper.test.js tests/index-page-cloud-sync.test.js`
- [ ] Expect at least the current restore/render failures before implementation.

### Task 2: Fix cloud document selection and snapshot recovery

**Files:**
- Modify: `utils/cloud-sync-helper.js`
- Test: `tests/cloud-sync-helper.test.js`

- [ ] Change cloud document lookup so same-user query results choose the latest usable non-empty snapshot instead of blindly taking the first row.
- [ ] Keep fallback behavior for the latest available document when the direct user lookup does not return a usable snapshot.
- [ ] Preserve full-history merge behavior and photo upload behavior while fixing restore selection.
- [ ] Run: `node --test tests/cloud-sync-helper.test.js`

### Task 3: Fix startup rendering and photo-backed migration flow

**Files:**
- Modify: `pages/index/index.js`
- Test: `tests/index-page-cloud-sync.test.js`

- [ ] Make startup rendering wait for async `setData` completion before `onLoad` resolves.
- [ ] Ensure startup migration applies the merged snapshot returned from cloud sync so page state reflects cloud photo ids, not stale local temp paths.
- [ ] Keep local-first startup behavior and restore-from-cloud behavior unchanged apart from the timing fix.
- [ ] Run: `node --test tests/index-page-cloud-sync.test.js`

### Task 4: Verify the full relevant suite

**Files:**
- Test: `tests/cloud-sync-helper.test.js`
- Test: `tests/index-page-cloud-sync.test.js`
- Test: `tests/*.test.js`

- [ ] Run: `node --test tests/cloud-sync-helper.test.js tests/index-page-cloud-sync.test.js`
- [ ] Run: `node --test tests/*.test.js`
- [ ] Confirm the recovery path, photo migration path, and existing suite all stay green.
