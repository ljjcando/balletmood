const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getCurrentStatsPeriod,
  buildStatsSnapshot
} = require('../pages/stats/stats-helper');

const sampleRecords = {
  '2026-03-30': {
    courses: [
      { name: '入门', duration: '1.5' },
      { name: '提高', duration: '2' }
    ],
    bodyParts: ['核心 Core', '脚背 Arch']
  },
  '2026-04-01': {
    courses: [
      { name: '入门', duration: '1' }
    ],
    bodyParts: ['核心 Core']
  },
  '2026-04-15': {
    courses: [
      { name: 'PBT', duration: '1.5' }
    ],
    bodyParts: ['背部 Back']
  }
};

test('getCurrentStatsPeriod derives the current year and month from the provided date', () => {
  assert.deepEqual(
    getCurrentStatsPeriod(new Date('2026-04-01T08:00:00+08:00')),
    { currentYear: 2026, currentMonth: 4 }
  );
});

test('buildStatsSnapshot computes monthly hours from the requested month without affecting total hours', () => {
  const stats = buildStatsSnapshot(sampleRecords, {
    currentYear: 2026,
    currentMonth: 4
  });

  assert.equal(stats.monthlyHours, 2.5);
  assert.equal(stats.totalHours, 6);
  assert.equal(stats.totalDays, 3);
});

test('buildStatsSnapshot exposes monthly summary buckets for historical trend views', () => {
  const stats = buildStatsSnapshot(sampleRecords, {
    currentYear: 2026,
    currentMonth: 4
  });

  assert.deepEqual(stats.monthlySummaries, [
    { monthKey: '2026-03', year: 2026, month: 3, hours: 3.5, days: 1 },
    { monthKey: '2026-04', year: 2026, month: 4, hours: 2.5, days: 2 }
  ]);
});

test('buildStatsSnapshot resets monthly hours to zero when the current month has no records', () => {
  const stats = buildStatsSnapshot(sampleRecords, {
    currentYear: 2026,
    currentMonth: 5
  });

  assert.equal(stats.monthlyHours, 0);
  assert.equal(stats.totalHours, 6);
});
