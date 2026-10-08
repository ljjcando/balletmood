const test = require('node:test');
const assert = require('node:assert/strict');

const indexPath = require.resolve('../pages/index/index');

function loadPageConfig() {
  let pageConfig;
  global.Page = (config) => { pageConfig = config; };
  global.wx = {};
  delete require.cache[indexPath];
  require('../pages/index/index');
  return pageConfig;
}

function buildPageInstance(pageConfig) {
  return {
    ...pageConfig,
    data: JSON.parse(JSON.stringify(pageConfig.data)),
    setData(update, callback) {
      this.data = { ...this.data, ...update };
      if (callback) callback();
    }
  };
}

test('clicking a blank calendar cell does nothing', () => {
  const originalPage = global.Page;
  const originalWx = global.wx;

  try {
    const pageConfig = loadPageConfig();
    const pageInstance = buildPageInstance(pageConfig);
    let opened = false;
    pageInstance.data.allRecords = {};
    pageInstance.openEditModal = () => { opened = true; };
    pageInstance.openPostcard = () => { opened = true; };

    pageConfig.onDayClick.call(pageInstance, {
      currentTarget: { dataset: {} }
    });

    assert.equal(opened, false);
  } finally {
    global.Page = originalPage;
    global.wx = originalWx;
    delete require.cache[indexPath];
  }
});

test('diary navigation cannot move beyond the current month', async () => {
  const originalPage = global.Page;
  const originalWx = global.wx;

  try {
    const pageConfig = loadPageConfig();
    const pageInstance = buildPageInstance(pageConfig);
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    let renderCalls = 0;
    pageInstance.data.currentYear = currentYear;
    pageInstance.data.currentMonth = currentMonth;
    pageInstance.renderCalendar = async () => { renderCalls += 1; };

    await pageConfig.nextMonth.call(pageInstance);

    assert.equal(pageInstance.data.currentYear, currentYear);
    assert.equal(pageInstance.data.currentMonth, currentMonth);
    assert.equal(renderCalls, 0);
  } finally {
    global.Page = originalPage;
    global.wx = originalWx;
    delete require.cache[indexPath];
  }
});

test('clicking a future date never opens or creates a record', () => {
  const originalPage = global.Page;
  const originalWx = global.wx;

  try {
    const pageConfig = loadPageConfig();
    const pageInstance = buildPageInstance(pageConfig);
    let opened = false;
    pageInstance.data.allRecords = {};
    pageInstance.openEditModal = () => { opened = true; };
    pageInstance.openPostcard = () => { opened = true; };

    pageConfig.onDayClick.call(pageInstance, {
      currentTarget: { dataset: { date: '2099-01-01' } }
    });

    assert.equal(opened, false);
  } finally {
    global.Page = originalPage;
    global.wx = originalWx;
    delete require.cache[indexPath];
  }
});

test('calendar renders leap years and 28, 30, and 31 day months correctly', async () => {
  const originalPage = global.Page;
  const originalWx = global.wx;

  try {
    const pageConfig = loadPageConfig();
    const pageInstance = buildPageInstance(pageConfig);
    pageInstance.data.records = {};
    pageInstance.data.allRecords = {};
    pageInstance.data.monthlyGoals = {};

    const cases = [
      { year: 2024, month: 2, days: 29, lastDate: '2024-02-29' },
      { year: 2025, month: 2, days: 28, lastDate: '2025-02-28' },
      { year: 2026, month: 4, days: 30, lastDate: '2026-04-30' },
      { year: 2025, month: 12, days: 31, lastDate: '2025-12-31' }
    ];

    for (const item of cases) {
      pageInstance.data.currentYear = item.year;
      pageInstance.data.currentMonth = item.month;
      await pageConfig.renderCalendar.call(pageInstance);
      const dates = pageInstance.data.calendarDays.filter(day => !day.isEmpty);
      assert.equal(dates.length, item.days);
      assert.equal(dates.at(-1).date, item.lastDate);
    }
  } finally {
    global.Page = originalPage;
    global.wx = originalWx;
    delete require.cache[indexPath];
  }
});

test('diary month navigation crosses December and January without skipping dates', async () => {
  const originalPage = global.Page;
  const originalWx = global.wx;

  try {
    const pageConfig = loadPageConfig();
    const pageInstance = buildPageInstance(pageConfig);
    pageInstance.data.records = {};
    pageInstance.data.allRecords = {};
    pageInstance.data.monthlyGoals = {};
    pageInstance.data.currentYear = 2025;
    pageInstance.data.currentMonth = 12;

    await pageConfig.nextMonth.call(pageInstance);
    assert.equal(pageInstance.data.currentYear, 2026);
    assert.equal(pageInstance.data.currentMonth, 1);
    assert.equal(
      pageInstance.data.calendarDays.filter(day => !day.isEmpty).at(-1).date,
      '2026-01-31'
    );

    await pageConfig.prevMonth.call(pageInstance);
    assert.equal(pageInstance.data.currentYear, 2025);
    assert.equal(pageInstance.data.currentMonth, 12);
    assert.equal(
      pageInstance.data.calendarDays.filter(day => !day.isEmpty).at(-1).date,
      '2025-12-31'
    );
  } finally {
    global.Page = originalPage;
    global.wx = originalWx;
    delete require.cache[indexPath];
  }
});
