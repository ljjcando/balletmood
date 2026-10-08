const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeMonthlyGoals,
  migrateLegacyGoal,
  getMonthlyGoalEntry,
  setMonthlyGoalEntry,
  mergeMonthlyGoals
} = require('../pages/index/monthly-goals-helper');
const {
  normalizeSnapshot,
  mergeSnapshots,
  readLocalSnapshot,
  writeLocalSnapshot
} = require('../utils/cloud-sync-helper');

test('monthly goals stay isolated by month', () => {
  let goals = setMonthlyGoalEntry({}, 2026, 9, '每周练习两次', '2026-09-01T08:00:00.000Z');
  goals = setMonthlyGoalEntry(goals, 2026, 10, '加强核心', '2026-10-01T08:00:00.000Z');

  assert.equal(getMonthlyGoalEntry(goals, 2026, 9).text, '每周练习两次');
  assert.equal(getMonthlyGoalEntry(goals, 2026, 10).text, '加强核心');
  assert.equal(getMonthlyGoalEntry(goals, 2026, 11).text, '');
});

test('legacy goal migrates once into the upgrade month without filling later months', () => {
  const migrated = migrateLegacyGoal({}, '旧版本目标', '2026-10-02T08:00:00.000Z', 2026, 10);
  const revisited = migrateLegacyGoal(migrated, '旧版本目标', '2026-10-02T08:00:00.000Z', 2026, 11);

  assert.deepEqual(migrated, {
    '2026-10': { text: '旧版本目标', updatedAt: '2026-10-02T08:00:00.000Z' }
  });
  assert.equal(getMonthlyGoalEntry(revisited, 2026, 11).text, '');
});

test('newer monthly goal wins per month and an empty goal acts as a tombstone', () => {
  const merged = mergeMonthlyGoals(
    {
      '2026-09': { text: '本地九月', updatedAt: '2026-09-08T08:00:00.000Z' },
      '2026-10': { text: '', updatedAt: '2026-10-09T08:00:00.000Z' }
    },
    {
      '2026-09': { text: '云端旧九月', updatedAt: '2026-09-07T08:00:00.000Z' },
      '2026-10': { text: '云端旧十月', updatedAt: '2026-10-08T08:00:00.000Z' },
      '2026-11': { text: '云端十一月', updatedAt: '2026-11-01T08:00:00.000Z' }
    }
  );

  assert.equal(merged['2026-09'].text, '本地九月');
  assert.equal(merged['2026-10'].text, '');
  assert.equal(merged['2026-11'].text, '云端十一月');
});

test('cloud snapshot normalization, merge, and local storage preserve monthly goals', () => {
  const local = normalizeSnapshot({
    monthlyGoals: {
      '2026-09': { text: '九月目标', updatedAt: '2026-09-01T08:00:00.000Z' }
    }
  });
  const merged = mergeSnapshots(local, {
    monthlyGoals: {
      '2026-10': { text: '十月目标', updatedAt: '2026-10-01T08:00:00.000Z' }
    }
  });
  const storage = {};
  const wxApi = {
    getStorageSync(key) { return storage[key]; },
    setStorageSync(key, value) { storage[key] = value; }
  };

  writeLocalSnapshot(merged, wxApi);
  const restored = readLocalSnapshot(wxApi);

  assert.equal(restored.monthlyGoals['2026-09'].text, '九月目标');
  assert.equal(restored.monthlyGoals['2026-10'].text, '十月目标');
  assert.deepEqual(storage.balletMoodMonthlyGoals, restored.monthlyGoals);
});

test('normalizeMonthlyGoals accepts legacy string entries and rejects invalid month keys', () => {
  assert.deepEqual(normalizeMonthlyGoals({
    '2026-08': '八月目标',
    '2026-13': { text: '无效月份' },
    invalid: { text: '无效键' }
  }), {
    '2026-08': { text: '八月目标', updatedAt: '' }
  });
});
