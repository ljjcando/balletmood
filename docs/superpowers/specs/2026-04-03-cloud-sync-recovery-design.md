# Cloud Sync Recovery Design

**Date:** 2026-04-03

## Goal

Solve the data-loss case where a WeChat user clears Mini Program cache and then reopens Ballet Mood. If the user has opened a fixed version at least once before clearing cache, text records and photos should both be recoverable from cloud data.

## Scope

- Persist structured user data in WeChat cloud database.
- Persist record photos in WeChat cloud storage.
- Automatically migrate any still-local history to the cloud when the app starts.
- Restore cloud data back to local storage when local records are empty after cache cleanup.
- Use WeChat Mini Program user identity as the data boundary.

## Out Of Scope

- No standalone account system.
- No username/password/phone-number login flow.
- No manual export/import flow for this iteration.

## Product Decision

Use WeChat identity binding without adding a visible account system. Each user's cloud document stays isolated by WeChat user identity. The app may expose sync status later, but this fix should work automatically with no extra user action.

## Recovery Flow

### 1. App launch with local records still present

When the app launches and local records exist:

- Read the full local snapshot.
- Scan every record in the local snapshot.
- For each record photo:
  - If the photo path already starts with `cloud://`, keep it unchanged.
  - If the photo path is still a local temp path, upload it to WeChat cloud storage and replace the local path with the returned cloud file id.
- Read the existing cloud snapshot for the same WeChat user.
- Merge local and cloud full-history snapshots by normalized date key.
- If both sides contain the same date, choose the newer record using `updatedAt`.
- Write the merged snapshot back to both local storage and cloud database.

This launch path is the automatic migration path for old users who still have records only on-device.

### 2. App launch after local cache was cleared

When the app launches and local records are empty:

- Read the latest cloud snapshot for the current WeChat user.
- If cloud data exists, restore the full snapshot to local storage and page state.
- If no cloud data exists, keep the local empty/default state.

### 3. Saving a record

When the user saves or updates a record:

- Persist locally first.
- Upload any new local photo to cloud storage.
- Merge the full local snapshot with the latest cloud snapshot.
- Write the merged snapshot back to cloud database and local storage.

Local save success must not depend on cloud success. If cloud sync fails, the user should still keep the local save and the app should retry on a later launch/save.

## Data Model

### Cloud database document

Collection: `ballet_mood_users`

Fields:

- `records`: object keyed by `YYYY-MM-DD`
- `terms`: string array
- `goal`: string
- `courseTags`: array
- `updatedAt`: timestamp/date

### Record photo field

- Stored in each record as `photo`
- Valid recoverable photo values must be WeChat cloud file ids such as `cloud://...`
- Local temp paths are considered migration-needed values, not durable values

## Merge Rules

- Normalize all record keys to `YYYY-MM-DD`.
- Merge the full snapshot, not only the current day.
- Keep records unique by normalized day.
- When both local and cloud have the same day, use the record with the newer `updatedAt`.
- If neither side has a valid `updatedAt`, prefer the local record while keeping existing field merge behavior consistent.

## Failure Handling

- If photo upload fails for one or more local records during migration, do not delete local data.
- If cloud database write fails, keep the latest local snapshot and retry on the next launch/save.
- Restore should never overwrite non-empty local records during normal startup.
- Startup should remain usable even when cloud sync fails; the user can still access local records.

## Required Tests

- Startup with local history uploads local-only photos and writes cloud file ids back into the merged snapshot.
- Startup with local history merges full local and cloud history instead of overwriting one side.
- Same-day local/cloud conflicts choose the newer `updatedAt`.
- Startup with empty local storage restores text records from cloud.
- Startup with empty local storage restores photo-backed records whose `photo` is already a `cloud://` file id.
- Saving a new record persists locally first and then syncs the merged full snapshot.

## Files Expected To Change

- `app.js`
- `utils/cloud-sync-helper.js`
- `pages/index/index.js`
- `tests/cloud-sync-helper.test.js`
- `tests/index-page-cloud-sync.test.js`

## Success Criteria

- A user with only local history can open the new version once and have both records and photos migrated to the cloud.
- That same user can later clear WeChat cache, reopen the Mini Program, and recover their history from the cloud.
- The app does not require a separate visible account-registration flow to achieve this.
