const test = require('node:test');
const assert = require('node:assert/strict');

test('stats page onShow refreshes the current year and month from the latest date', async () => {
  const originalDate = global.Date;
  const originalPage = global.Page;
  const originalWx = global.wx;
  const statsPath = require.resolve('../pages/stats/stats');

  class FakeDate extends Date {
    constructor(...args) {
      if (args.length === 0) {
        super('2026-04-01T08:00:00+08:00');
        return;
      }

      super(...args);
    }

    static now() {
      return new originalDate('2026-04-01T08:00:00+08:00').valueOf();
    }
  }

  try {
    let pageConfig;
    global.Date = FakeDate;
    global.Page = (config) => {
      pageConfig = config;
    };
    global.wx = {
      getStorageSync(key) {
        if (key === 'balletMoodData') {
          return {
            '2026-03-31': { courses: [{ name: '入门', duration: '2' }] },
            '2026-04-01': { courses: [{ name: '提高', duration: '1.5' }] }
          };
        }

        return {};
      },
      getWindowInfo() {
        return { statusBarHeight: 47 };
      },
      getMenuButtonBoundingClientRect() {
        return { top: 53, bottom: 85, height: 32 };
      },
      stopPullDownRefresh() {}
    };

    delete require.cache[statsPath];
    require('../pages/stats/stats');

    const pageInstance = {
      ...pageConfig,
      data: { ...pageConfig.data },
      setData(update) {
        this.data = { ...this.data, ...update };
      }
    };

    pageConfig.onLoad.call(pageInstance);
    assert.equal(pageInstance.data.statusBarHeight, 47);
    assert.equal(pageInstance.data.navBarHeight, 44);
    assert.equal(pageInstance.data.customNavHeight, 91);
    assert.equal(pageInstance.data.monthPickerStart, '2024-01-01');
    assert.equal(pageInstance.data.monthPickerEnd, '2026-04-01');
    assert.equal(pageInstance.data.selectedMonthValue, '2026-04-01');
    assert.equal(pageInstance.data.annualYear, 2026);
    assert.equal(pageInstance.data.annualHours, 3.5);
    assert.equal(pageInstance.data.annualDays, 2);
    assert.equal(pageInstance.data.annualLessons, 2);
    assert.equal(pageInstance.data.isNextYearDisabled, true);
    assert.deepEqual(pageInstance.data.yearPickerOptions, ['2024年', '2025年', '2026年']);
    assert.equal(pageInstance.data.selectedYearIndex, 2);

    pageConfig.onShow.call(pageInstance);

    assert.equal(pageInstance.data.currentYear, 2026);
    assert.equal(pageInstance.data.currentMonth, 4);
    assert.equal(pageInstance.data.monthlyHours, 1.5);
    assert.equal(pageInstance.data.monthlyDays, 1);
    assert.equal(pageInstance.data.monthlyLessons, 1);
    assert.equal(pageInstance.data.totalHours, 3.5);

    pageConfig.prevMonth.call(pageInstance);
    assert.equal(pageInstance.data.currentYear, 2026);
    assert.equal(pageInstance.data.currentMonth, 3);
    assert.equal(pageInstance.data.monthlyHours, 2);
    assert.equal(pageInstance.data.isNextMonthDisabled, false);
    assert.equal(pageInstance.data.isCurrentMonth, false);

    pageConfig.nextMonth.call(pageInstance);
    assert.equal(pageInstance.data.currentMonth, 4);
    assert.equal(pageInstance.data.monthlyHours, 1.5);
    assert.equal(pageInstance.data.isNextMonthDisabled, true);
    assert.equal(pageInstance.data.isCurrentMonth, true);

    pageConfig.onMonthPickerChange.call(pageInstance, { detail: { value: '2024-12' } });
    assert.equal(pageInstance.data.currentYear, 2024);
    assert.equal(pageInstance.data.currentMonth, 12);
    assert.equal(pageInstance.data.selectedMonthValue, '2024-12-01');

    pageConfig.onMonthPickerChange.call(pageInstance, { detail: { value: '2027-01' } });
    assert.equal(pageInstance.data.currentYear, 2024);
    assert.equal(pageInstance.data.currentMonth, 12);

    pageConfig.switchStatsPeriod.call(pageInstance, { currentTarget: { dataset: { period: 'year' } } });
    assert.equal(pageInstance.data.statsPeriodMode, 'year');

    pageConfig.onYearPickerChange.call(pageInstance, { detail: { value: '0' } });
    assert.equal(pageInstance.data.annualYear, 2024);
    assert.equal(pageInstance.data.annualHours, 0);
    assert.equal(pageInstance.data.selectedYearIndex, 0);

    pageConfig.onYearPickerChange.call(pageInstance, { detail: { value: '2' } });
    assert.equal(pageInstance.data.annualYear, 2026);
    assert.equal(pageInstance.data.annualHours, 3.5);

    pageConfig.prevYear.call(pageInstance);
    assert.equal(pageInstance.data.annualYear, 2025);
    assert.equal(pageInstance.data.annualHours, 0);
    assert.equal(pageInstance.data.isNextYearDisabled, false);

    pageConfig.nextYear.call(pageInstance);
    assert.equal(pageInstance.data.annualYear, 2026);
    assert.equal(pageInstance.data.annualHours, 3.5);
    assert.equal(pageInstance.data.isNextYearDisabled, true);

    pageConfig.nextYear.call(pageInstance);
    assert.equal(pageInstance.data.annualYear, 2026);
  } finally {
    global.Date = originalDate;
    global.Page = originalPage;
    global.wx = originalWx;
    delete require.cache[statsPath];
  }
});

test('stats page month navigation crosses year boundaries without entering the future', () => {
  const originalDate = global.Date;
  const originalPage = global.Page;
  const originalWx = global.wx;
  const statsPath = require.resolve('../pages/stats/stats');

  class FakeDate extends Date {
    constructor(...args) {
      if (args.length === 0) {
        super('2026-01-15T08:00:00+08:00');
        return;
      }

      super(...args);
    }
  }

  try {
    let pageConfig;
    global.Date = FakeDate;
    global.Page = (config) => {
      pageConfig = config;
    };
    global.wx = {
      getStorageSync() {
        return {};
      },
      stopPullDownRefresh() {}
    };

    delete require.cache[statsPath];
    require('../pages/stats/stats');

    const pageInstance = {
      ...pageConfig,
      data: {
        ...pageConfig.data,
        currentYear: 2026,
        currentMonth: 1,
        isNextMonthDisabled: false
      },
      setData(update) {
        this.data = { ...this.data, ...update };
      }
    };

    pageConfig.prevMonth.call(pageInstance);
    assert.equal(pageInstance.data.currentYear, 2025);
    assert.equal(pageInstance.data.currentMonth, 12);
    assert.equal(pageInstance.data.isNextMonthDisabled, false);

    pageConfig.nextMonth.call(pageInstance);
    assert.equal(pageInstance.data.currentYear, 2026);
    assert.equal(pageInstance.data.currentMonth, 1);
    assert.equal(pageInstance.data.isNextMonthDisabled, true);

    pageConfig.nextMonth.call(pageInstance);
    assert.equal(pageInstance.data.currentMonth, 1);

    pageConfig.prevMonth.call(pageInstance);
    pageConfig.returnToCurrentMonth.call(pageInstance);
    assert.equal(pageInstance.data.currentYear, 2026);
    assert.equal(pageInstance.data.currentMonth, 1);
    assert.equal(pageInstance.data.isCurrentMonth, true);
  } finally {
    global.Date = originalDate;
    global.Page = originalPage;
    global.wx = originalWx;
    delete require.cache[statsPath];
  }
});
