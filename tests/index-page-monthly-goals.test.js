const test = require('node:test');
const assert = require('node:assert/strict');

test('diary month navigation shows and saves an independent goal for each month', async () => {
  const originalPage = global.Page;
  const originalWx = global.wx;
  const pagePath = require.resolve('../pages/index/index');
  const storage = {};

  try {
    let pageConfig;
    global.Page = (config) => { pageConfig = config; };
    global.wx = {
      getStorageSync(key) { return storage[key]; },
      setStorageSync(key, value) { storage[key] = value; },
      showToast() {}
    };

    delete require.cache[pagePath];
    require('../pages/index/index');

    const pageInstance = {
      ...pageConfig,
      data: {
        ...pageConfig.data,
        currentYear: 2026,
        currentMonth: 9,
        records: {},
        allRecords: {},
        monthlyGoals: {
          '2026-09': { text: '九月目标', updatedAt: '2026-09-01T08:00:00.000Z' },
          '2026-10': { text: '十月目标', updatedAt: '2026-10-01T08:00:00.000Z' }
        }
      },
      setData(update, callback) {
        this.data = { ...this.data, ...update };
        if (callback) callback();
      },
      trackLocalMutation() {},
      syncCurrentSnapshotInBackground() { return Promise.resolve(); }
    };

    await pageConfig.renderCalendar.call(pageInstance);
    assert.equal(pageInstance.data.monthlyGoal, '九月目标');

    await pageConfig.nextMonth.call(pageInstance);
    assert.equal(pageInstance.data.currentMonth, 10);
    assert.equal(pageInstance.data.monthlyGoal, '十月目标');

    pageConfig.saveGoal.call(pageInstance, { detail: { value: '更新后的十月目标' } });
    assert.equal(pageInstance.data.monthlyGoals['2026-09'].text, '九月目标');
    assert.equal(pageInstance.data.monthlyGoals['2026-10'].text, '更新后的十月目标');
    assert.equal(storage.balletMoodMonthlyGoals['2026-09'].text, '九月目标');

    await pageConfig.prevMonth.call(pageInstance);
    assert.equal(pageInstance.data.monthlyGoal, '九月目标');
    assert.equal(pageConfig.buildCurrentSnapshot.call(pageInstance).monthlyGoals['2026-10'].text, '更新后的十月目标');
  } finally {
    global.Page = originalPage;
    global.wx = originalWx;
    delete require.cache[pagePath];
  }
});

test('diary page migrates the single legacy goal only into the current month', async () => {
  const originalPage = global.Page;
  const originalWx = global.wx;
  const pagePath = require.resolve('../pages/index/index');
  const storage = {};

  try {
    let pageConfig;
    global.Page = (config) => { pageConfig = config; };
    global.wx = {
      setStorageSync(key, value) { storage[key] = value; }
    };

    delete require.cache[pagePath];
    require('../pages/index/index');

    const pageInstance = {
      ...pageConfig,
      data: { ...pageConfig.data, currentYear: 2026, currentMonth: 10 },
      setData(update, callback) {
        this.data = { ...this.data, ...update };
        if (callback) callback();
      }
    };

    await pageConfig.applySnapshotToPage.call(pageInstance, {
      records: {},
      terms: ['Adagio'],
      goal: '旧版目标',
      goalUpdatedAt: '2026-10-02T08:00:00.000Z',
      courseTags: []
    });

    assert.equal(pageInstance.data.monthlyGoal, '旧版目标');
    assert.equal(pageInstance.data.monthlyGoals['2026-10'].text, '旧版目标');
    assert.equal(storage.balletMoodMonthlyGoals['2026-10'].text, '旧版目标');

    pageInstance.setData({ currentMonth: 11 });
    await pageConfig.renderCalendar.call(pageInstance);
    assert.equal(pageInstance.data.monthlyGoal, '');
  } finally {
    global.Page = originalPage;
    global.wx = originalWx;
    delete require.cache[pagePath];
  }
});

test('diary page preserves an intentionally empty terms list', async () => {
  const originalPage = global.Page;
  const originalWx = global.wx;
  const pagePath = require.resolve('../pages/index/index');

  try {
    let pageConfig;
    global.Page = (config) => { pageConfig = config; };
    global.wx = { setStorageSync() {} };
    delete require.cache[pagePath];
    require('../pages/index/index');

    const pageInstance = {
      ...pageConfig,
      data: { ...pageConfig.data, currentYear: 2026, currentMonth: 10 },
      setData(update, callback) {
        this.data = { ...this.data, ...update };
        if (callback) callback();
      }
    };

    await pageConfig.applySnapshotToPage.call(pageInstance, {
      records: {},
      terms: [],
      monthlyGoals: {},
      courseTags: []
    });

    assert.deepEqual(pageInstance.data.terms, []);
    assert.deepEqual(pageInstance.data.termsOptions, []);
  } finally {
    global.Page = originalPage;
    global.wx = originalWx;
    delete require.cache[pagePath];
  }
});
