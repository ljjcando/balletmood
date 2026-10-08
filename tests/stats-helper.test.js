const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getCurrentStatsPeriod,
  getMonthPickerBounds,
  getYearPickerOptions,
  buildPracticeCalendar,
  buildStatsSnapshot,
  buildAnnualStatsSnapshot
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

test('getMonthPickerBounds covers three calendar years and expands to earlier records', () => {
  const now = new Date('2026-10-02T08:00:00+08:00');

  assert.deepEqual(getMonthPickerBounds({}, now), {
    monthPickerStart: '2024-01-01',
    monthPickerEnd: '2026-10-01'
  });
  assert.deepEqual(getMonthPickerBounds({ '2022-06-08': {} }, now), {
    monthPickerStart: '2022-06-01',
    monthPickerEnd: '2026-10-01'
  });
});

test('getYearPickerOptions spans historical records through the current year', () => {
  const now = new Date('2026-10-02T08:00:00+08:00');

  assert.deepEqual(getYearPickerOptions({}, now, 2026), {
    yearPickerOptions: ['2024年', '2025年', '2026年'],
    selectedYearIndex: 2
  });
  assert.deepEqual(getYearPickerOptions({ '2022-06-08': {} }, now, 2025), {
    yearPickerOptions: ['2022年', '2023年', '2024年', '2025年', '2026年'],
    selectedYearIndex: 3
  });
});

test('buildStatsSnapshot computes monthly hours from the requested month without affecting total hours', () => {
  const stats = buildStatsSnapshot(sampleRecords, {
    currentYear: 2026,
    currentMonth: 4
  });

  assert.equal(stats.monthlyHours, 2.5);
  assert.equal(stats.monthlyDays, 2);
  assert.equal(stats.monthlyLessons, 2);
  assert.equal(stats.totalHours, 6);
  assert.equal(stats.totalDays, 3);
  assert.deepEqual(stats.courseDistribution.map(({ name, hours, percentage }) => ({ name, hours, percentage })), [
    { name: 'PBT', hours: 1.5, percentage: 60 },
    { name: '入门', hours: 1, percentage: 40 }
  ]);
  assert.deepEqual(stats.bodyPartsStats.map(({ name, count }) => ({ name, count })), [
    { name: '核心', count: 1 },
    { name: '背部', count: 1 }
  ]);
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
  assert.equal(stats.monthlyDays, 0);
  assert.equal(stats.monthlyLessons, 0);
  assert.deepEqual(stats.courseDistribution, []);
  assert.equal(stats.totalHours, 6);
});

test('buildPracticeCalendar marks practice intensity and calculates the longest streak', () => {
  const calendar = buildPracticeCalendar(2026, 10, {
    2: 1,
    9: 2.5,
    10: 1.5
  });

  const currentDays = calendar.calendarDays.filter((item) => !item.isOutside);
  assert.equal(currentDays.length, 31);
  assert.equal(currentDays.find((item) => item.day === 2).intensityClass, 'short');
  assert.equal(currentDays.find((item) => item.day === 9).intensityClass, 'long');
  assert.equal(currentDays.find((item) => item.day === 10).intensityClass, 'medium');
  assert.equal(calendar.longestStreak, 2);
});

test('buildAnnualStatsSnapshot summarizes the selected year and monthly trend', () => {
  const stats = buildAnnualStatsSnapshot(sampleRecords, { annualYear: 2026 });

  assert.equal(stats.annualHours, 6);
  assert.equal(stats.annualDays, 3);
  assert.equal(stats.annualLessons, 4);
  assert.equal(stats.annualLongestStreak, 1);
  assert.equal(stats.annualBestMonthLabel, '3月');
  assert.equal(stats.annualBestMonthDetail, '练习最多 · 3.5小时');
  assert.equal(stats.annualMonthlyBars.find((item) => item.month === 3).hours, 3.5);
  assert.equal(stats.annualMonthlyBars.find((item) => item.month === 4).hours, 2.5);
  assert.deepEqual(
    stats.annualCourseDistribution.map(({ name, hours, percentage }) => ({ name, hours, percentage })),
    [
      { name: '入门', hours: 2.5, percentage: 41.7 },
      { name: '提高', hours: 2, percentage: 33.3 },
      { name: 'PBT', hours: 1.5, percentage: 25 }
    ]
  );
});

test('buildAnnualStatsSnapshot returns a composed empty year', () => {
  const stats = buildAnnualStatsSnapshot(sampleRecords, { annualYear: 2025 });

  assert.equal(stats.annualHours, 0);
  assert.equal(stats.annualDays, 0);
  assert.equal(stats.annualLessons, 0);
  assert.equal(stats.annualLongestStreak, 0);
  assert.equal(stats.annualBestMonthLabel, '暂无');
  assert.equal(stats.annualMonthlyBars.length, 12);
  assert.deepEqual(stats.annualCourseDistribution, []);
});

test('monthly and annual stats ignore invalid course durations and invalid dates', () => {
  const records = {
    '2026-10-01': {
      courses: [
        { name: '合法课程', duration: '1.5' },
        { name: '负数课程', duration: '-2' },
        { name: '混合文本', duration: '1.5abc' },
        { name: '空时长', duration: '' }
      ]
    },
    '2026-13-40': {
      courses: [{ name: '越界日期', duration: '3' }]
    }
  };

  const monthly = buildStatsSnapshot(records, { currentYear: 2026, currentMonth: 10 });
  const annual = buildAnnualStatsSnapshot(records, { annualYear: 2026 });

  assert.equal(monthly.totalDays, 1);
  assert.equal(monthly.monthlyHours, 1.5);
  assert.equal(monthly.monthlyLessons, 1);
  assert.deepEqual(monthly.courseDistribution.map((item) => item.name), ['合法课程']);
  assert.equal(annual.annualHours, 1.5);
  assert.equal(annual.annualLessons, 1);
});
