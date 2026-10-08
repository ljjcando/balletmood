const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseAdminOpenIds,
  isCleanupAdmin
} = require('../cloudfunctions/cleanupDuplicateRecords/authorization');

test('cleanup admin allowlist is trimmed, de-duplicated, and fail-closed', () => {
  assert.deepEqual(parseAdminOpenIds(' admin-a,admin-b, admin-a '), ['admin-a', 'admin-b']);
  assert.equal(isCleanupAdmin('admin-a', 'admin-a,admin-b'), true);
  assert.equal(isCleanupAdmin('user-c', 'admin-a,admin-b'), false);
  assert.equal(isCleanupAdmin('admin-a', ''), false);
  assert.equal(isCleanupAdmin('', 'admin-a'), false);
});
