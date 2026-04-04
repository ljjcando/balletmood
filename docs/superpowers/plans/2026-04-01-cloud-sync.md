# Cloud Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local-first cloud backup and restore for Ballet Mood user data with WeChat cloud development.

**Architecture:** Initialize cloud development once in `app.js`, centralize sync behavior in a small helper under `utils/`, and have the index page use that helper for startup restore and save-time backup. Keep local storage as the source of truth on first launch, and only restore from cloud when local records are empty.

**Tech Stack:** WeChat Mini Program, CloudBase database, Node test runner

---

### Task 1: Lock the expected cloud-sync behavior with tests

**Files:**
- Create: `tests/index-page-cloud-sync.test.js`
- Test: `tests/index-page-cloud-sync.test.js`

- [ ] Add tests covering local-first bootstrap, cloud restore when local records are empty, and save-time cloud backup.
- [ ] Run: `node --test tests/index-page-cloud-sync.test.js`
- [ ] Expect initial failures before implementation.

### Task 2: Add the cloud initialization and helper

**Files:**
- Modify: `app.js`
- Create: `utils/cloud-sync-helper.js`
- Test: `tests/index-page-cloud-sync.test.js`

- [ ] Initialize `wx.cloud` with the provided env id in `app.js`.
- [ ] Add a focused helper for snapshot read/write, bootstrap backup, restore, and push-to-cloud.
- [ ] Run: `node --test tests/index-page-cloud-sync.test.js`

### Task 3: Wire the index page into cloud sync

**Files:**
- Modify: `pages/index/index.js`
- Test: `tests/index-page-cloud-sync.test.js`

- [ ] Make page load local data first and restore from cloud only when local records are empty.
- [ ] Make record saves back up the latest snapshot to cloud without blocking local persistence.
- [ ] Run: `node --test tests/index-page-cloud-sync.test.js`

### Task 4: Verify the full suite

**Files:**
- Test: `tests/*.test.js`

- [ ] Run: `node --test tests/*.test.js`
- [ ] Confirm the full suite stays green.
