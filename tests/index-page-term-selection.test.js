const test = require('node:test');
const assert = require('node:assert/strict');

const indexPath = require.resolve('../pages/index/index');

test('deleting one term keeps the other selected terms selected', () => {
  const originalPage = global.Page;
  const originalWx = global.wx;
  let pageConfig;

  try {
    global.Page = (config) => { pageConfig = config; };
    global.wx = {
      showModal({ success }) { success({ confirm: true }); },
      showToast() {},
      setStorageSync() {}
    };
    delete require.cache[indexPath];
    require('../pages/index/index');

    const pageInstance = {
      ...pageConfig,
      data: {
        ...JSON.parse(JSON.stringify(pageConfig.data)),
        terms: ['Adagio', 'Fondu', 'Passe'],
        termsOptions: [
          { name: 'Adagio', selected: true },
          { name: 'Fondu', selected: true },
          { name: 'Passe', selected: false }
        ]
      },
      setData(update) { this.data = { ...this.data, ...update }; },
      createMutationTimestamp() { return '2026-10-08T08:00:00.000Z'; },
      trackLocalMutation() {},
      syncCurrentSnapshotInBackground() { return Promise.resolve(); }
    };

    pageConfig.longPressTerm.call(pageInstance, {
      currentTarget: { dataset: { index: 1 } }
    });

    assert.deepEqual(pageInstance.data.terms, ['Adagio', 'Passe']);
    assert.deepEqual(pageInstance.data.termsOptions, [
      { name: 'Adagio', selected: true },
      { name: 'Passe', selected: false }
    ]);
  } finally {
    global.Page = originalPage;
    global.wx = originalWx;
    delete require.cache[indexPath];
  }
});
