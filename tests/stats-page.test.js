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

    pageConfig.onShow.call(pageInstance);

    assert.equal(pageInstance.data.currentYear, 2026);
    assert.equal(pageInstance.data.currentMonth, 4);
    assert.equal(pageInstance.data.monthlyHours, 1.5);
    assert.equal(pageInstance.data.totalHours, 3.5);
  } finally {
    global.Date = originalDate;
    global.Page = originalPage;
    global.wx = originalWx;
    delete require.cache[statsPath];
  }
});
