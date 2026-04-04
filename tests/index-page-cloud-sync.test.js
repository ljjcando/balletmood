const test = require('node:test');
const assert = require('node:assert/strict');

const indexPath = require.resolve('../pages/index/index');
const helperPath = require.resolve('../utils/cloud-sync-helper');

function buildPageInstance(pageConfig) {
  return {
    ...pageConfig,
    data: JSON.parse(JSON.stringify(pageConfig.data)),
    setData(update, callback) {
      this.data = { ...this.data, ...update };
      if (typeof callback === 'function') {
        callback();
      }
    }
  };
}

test('onLoad prefers local snapshot and triggers a cloud backup check', async () => {
  const originalPage = global.Page;
  const originalWx = global.wx;
  const originalHelper = require.cache[helperPath];

  let pageConfig;
  let migrateCalls = 0;
  let restoreCalls = 0;

  require.cache[helperPath] = {
    id: helperPath,
    filename: helperPath,
    loaded: true,
    exports: {
      readLocalSnapshot() {
        return {
          records: {
            '2026-04-01': { note: 'local record', courses: [] }
          },
          terms: ['Adagio'],
          goal: '四月练满十次',
          courseTags: [{ name: '入门', selected: false }]
        };
      },
      hasLocalRecords() {
        return true;
      },
      migrateLocalSnapshotToCloud() {
        migrateCalls += 1;
        return Promise.resolve({
          migrated: true,
          snapshot: {
            records: {
              '2026-03-31': { note: 'march record', updatedAt: '2026-03-31T08:00:00.000Z' },
              '2026-04-01': { note: 'local record', courses: [] }
            },
            terms: ['Adagio'],
            goal: '四月练满十次',
            courseTags: [{ name: '入门', selected: false }]
          }
        });
      },
      restoreFromCloudIfLocalEmpty() {
        restoreCalls += 1;
        return Promise.resolve({
          restored: false,
          reason: 'local-exists',
          snapshot: null
        });
      },
      pushSnapshotToCloud() {
        return Promise.resolve();
      }
    }
  };

  try {
    global.Page = (config) => {
      pageConfig = config;
    };
    global.wx = {
      showToast() {},
      showLoading() {},
      hideLoading() {},
      showModal() {},
      setStorageSync() {},
      getStorageSync() {
        return '';
      }
    };

    delete require.cache[indexPath];
    require('../pages/index/index');

    const pageInstance = buildPageInstance(pageConfig);
    await pageConfig.onLoad.call(pageInstance);

    assert.deepEqual(pageInstance.data.allRecords, {
      '2026-03-31': { note: 'march record', updatedAt: '2026-03-31T08:00:00.000Z' },
      '2026-04-01': { note: 'local record', courses: [] }
    });
    assert.equal(pageInstance.data.monthlyGoal, '四月练满十次');
    assert.deepEqual(pageInstance.data.terms, ['Adagio']);
    assert.equal(migrateCalls, 1);
    assert.equal(restoreCalls, 0);
  } finally {
    global.Page = originalPage;
    global.wx = originalWx;
    delete require.cache[indexPath];
    if (originalHelper) {
      require.cache[helperPath] = originalHelper;
    } else {
      delete require.cache[helperPath];
    }
  }
});

test('onLoad applies migrated cloud photo ids returned from startup sync', async () => {
  const originalPage = global.Page;
  const originalWx = global.wx;
  const originalHelper = require.cache[helperPath];

  let pageConfig;

  require.cache[helperPath] = {
    id: helperPath,
    filename: helperPath,
    loaded: true,
    exports: {
      readLocalSnapshot() {
        return {
          records: {
            '2026-04-01': {
              note: 'local record',
              photo: '/tmp/local-photo.jpg',
              courses: []
            }
          },
          terms: ['Adagio'],
          goal: '四月练满十次',
          courseTags: [{ name: '入门', selected: false }]
        };
      },
      hasLocalRecords() {
        return true;
      },
      migrateLocalSnapshotToCloud() {
        return Promise.resolve({
          migrated: true,
          reason: 'full-sync-complete',
          snapshot: {
            records: {
              '2026-04-01': {
                note: 'local record',
                photo: 'cloud://env-id/ballet-mood/2026-04-01-1.jpg',
                courses: []
              }
            },
            terms: ['Adagio'],
            goal: '四月练满十次',
            courseTags: [{ name: '入门', selected: false }]
          }
        });
      },
      restoreFromCloudIfLocalEmpty() {
        return Promise.resolve({
          restored: false,
          reason: 'local-exists',
          snapshot: null
        });
      },
      pushSnapshotToCloud() {
        return Promise.resolve();
      },
      fetchLatestCloudSnapshot() {
        return Promise.resolve(null);
      }
    }
  };

  try {
    global.Page = (config) => {
      pageConfig = config;
    };
    global.wx = {
      showToast() {},
      showLoading() {},
      hideLoading() {},
      showModal() {},
      stopPullDownRefresh() {},
      setStorageSync() {},
      getStorageSync() {
        return '';
      }
    };

    delete require.cache[indexPath];
    require('../pages/index/index');

    const pageInstance = buildPageInstance(pageConfig);
    await pageConfig.onLoad.call(pageInstance);

    assert.equal(
      pageInstance.data.allRecords['2026-04-01'].photo,
      'cloud://env-id/ballet-mood/2026-04-01-1.jpg'
    );
    assert.equal(
      pageInstance.data.calendarDays.some((item) => item.date === '2026-04-01' && item.photo.startsWith('cloud://')),
      true
    );
  } finally {
    global.Page = originalPage;
    global.wx = originalWx;
    delete require.cache[indexPath];
    if (originalHelper) {
      require.cache[helperPath] = originalHelper;
    } else {
      delete require.cache[helperPath];
    }
  }
});

test('onLoad restores cloud data when local records are empty', async () => {
  const originalPage = global.Page;
  const originalWx = global.wx;
  const originalHelper = require.cache[helperPath];

  let pageConfig;

  require.cache[helperPath] = {
    id: helperPath,
    filename: helperPath,
    loaded: true,
    exports: {
      readLocalSnapshot() {
        return {
          records: {},
          terms: ['local'],
          goal: '',
          courseTags: []
        };
      },
      hasLocalRecords() {
        return false;
      },
      migrateLocalSnapshotToCloud() {
        return Promise.resolve({ migrated: false, snapshot: null });
      },
      restoreFromCloudIfLocalEmpty() {
        return Promise.resolve({
          restored: true,
          reason: 'cloud-restored',
          snapshot: {
            records: {
              '2026/04/02': { note: 'cloud record', courses: [] }
            },
            terms: ['Fondu'],
            goal: '恢复成功',
            courseTags: [{ name: '提高', selected: false }]
          }
        });
      },
      pushSnapshotToCloud() {
        return Promise.resolve();
      }
    }
  };

  try {
    global.Page = (config) => {
      pageConfig = config;
    };
    global.wx = {
      showToast() {},
      showLoading() {},
      hideLoading() {},
      showModal() {},
      setStorageSync() {},
      getStorageSync() {
        return '';
      }
    };

    delete require.cache[indexPath];
    require('../pages/index/index');

    const pageInstance = buildPageInstance(pageConfig);
    await pageConfig.onLoad.call(pageInstance);

    assert.deepEqual(pageInstance.data.allRecords, {
      '2026-04-02': { note: 'cloud record', courses: [] }
    });
    assert.deepEqual(pageInstance.data.terms, ['Fondu']);
    assert.equal(pageInstance.data.monthlyGoal, '恢复成功');
    assert.deepEqual(pageInstance.data.courseTags, [{ name: '提高', selected: false }]);
    assert.equal(
      pageInstance.data.calendarDays.some((item) => item.date === '2026-04-02' && item.hasRecord),
      true
    );
  } finally {
    global.Page = originalPage;
    global.wx = originalWx;
    delete require.cache[indexPath];
    if (originalHelper) {
      require.cache[helperPath] = originalHelper;
    } else {
      delete require.cache[helperPath];
    }
  }
});

test('saveRecord keeps local persistence and backs up the latest snapshot to cloud', async () => {
  const originalPage = global.Page;
  const originalWx = global.wx;
  const originalHelper = require.cache[helperPath];

  let pageConfig;
  const pushedSnapshots = [];
  const storageWrites = [];

  require.cache[helperPath] = {
    id: helperPath,
    filename: helperPath,
    loaded: true,
    exports: {
      readLocalSnapshot() {
        return {
          records: {},
          terms: ['Adagio'],
          goal: '本月目标',
          courseTags: [{ name: '入门', selected: false }]
        };
      },
      hasLocalRecords() {
        return true;
      },
      migrateLocalSnapshotToCloud() {
        return Promise.resolve({ migrated: false, snapshot: null });
      },
      restoreFromCloudIfLocalEmpty() {
        return Promise.resolve({ restored: false, snapshot: null });
      },
      pushSnapshotToCloud(snapshot) {
        pushedSnapshots.push(snapshot);
        return Promise.resolve({
          snapshot: {
            records: {
              '2026/03/31': { note: '历史记录', updatedAt: '2026-03-31T10:00:00.000Z' },
              '2026-04-03': snapshot.records['2026-04-03']
            },
            terms: ['Adagio'],
            goal: '本月目标',
            courseTags: [{ name: '入门', selected: false }]
          }
        });
      }
    }
  };

  try {
    global.Page = (config) => {
      pageConfig = config;
    };
    global.wx = {
      showToast() {},
      showLoading() {},
      hideLoading() {},
      showModal() {},
      setStorageSync(key, value) {
        storageWrites.push({ key, value });
      },
      getStorageSync() {
        return '';
      }
    };

    delete require.cache[indexPath];
    require('../pages/index/index');

    const pageInstance = buildPageInstance(pageConfig);
    pageInstance.closeEditModal = () => {};
    pageInstance.data.currentYear = 2026;
    pageInstance.data.currentMonth = 3;
    pageInstance.data.selectedDate = '2026-04-03';
    pageInstance.data.currentPhoto = '';
    pageInstance.data.currentNote = '今天状态不错';
    pageInstance.data.terms = ['Adagio'];
    pageInstance.data.termsOptions = [{ name: 'Adagio', selected: true }];
    pageInstance.data.bodyPartsOptions = [{ name: '核心 Core', selected: true }];
    pageInstance.data.currentCourses = [{ name: '入门', duration: '1.5' }];
    pageInstance.data.courseTags = [{ name: '入门', selected: false }];
    pageInstance.data.monthlyGoal = '本月目标';
    pageInstance.data.allRecords = {};

    await pageConfig.saveRecord.call(pageInstance);

    assert.equal(storageWrites.some(({ key }) => key === 'balletMoodData'), true);
    assert.equal(pushedSnapshots.length, 1);
    assert.deepEqual(pushedSnapshots[0].records['2026-04-03'].terms, ['Adagio']);
    assert.equal(pushedSnapshots[0].goal, '本月目标');
    assert.deepEqual(pushedSnapshots[0].courseTags, [{ name: '入门', selected: false }]);
    assert.deepEqual(pageInstance.data.records, {
      '2026-03-31': { note: '历史记录', updatedAt: '2026-03-31T10:00:00.000Z' },
      '2026-04-03': pageInstance.data.allRecords['2026-04-03']
    });
    assert.equal(
      pageInstance.data.calendarDays.some((item) => item.date === '2026-03-31' && item.hasRecord),
      true
    );
  } finally {
    global.Page = originalPage;
    global.wx = originalWx;
    delete require.cache[indexPath];
    if (originalHelper) {
      require.cache[helperPath] = originalHelper;
    } else {
      delete require.cache[helperPath];
    }
  }
});

test('onLoad waits for async setData before rendering restored cloud records', async () => {
  const originalPage = global.Page;
  const originalWx = global.wx;
  const originalHelper = require.cache[helperPath];

  let pageConfig;

  require.cache[helperPath] = {
    id: helperPath,
    filename: helperPath,
    loaded: true,
    exports: {
      getDefaultSnapshot() {
        return {
          records: {},
          terms: ['Adagio'],
          goal: '',
          courseTags: [{ name: '入门', selected: false }]
        };
      },
      readLocalSnapshot() {
        return {
          records: {},
          terms: ['local'],
          goal: '',
          courseTags: []
        };
      },
      hasLocalRecords() {
        return false;
      },
      migrateLocalSnapshotToCloud() {
        return Promise.resolve({ migrated: false, snapshot: null });
      },
      restoreFromCloudIfLocalEmpty() {
        return Promise.resolve({
          restored: true,
          reason: 'cloud-restored',
          snapshot: {
            records: {
              '2026-04-03': { note: 'cloud restored', courses: [] }
            },
            terms: ['Fondu'],
            goal: '恢复成功',
            courseTags: [{ name: '提高', selected: false }]
          }
        });
      },
      pushSnapshotToCloud() {
        return Promise.resolve();
      },
      fetchLatestCloudSnapshot() {
        return Promise.resolve(null);
      }
    }
  };

  try {
    global.Page = (config) => {
      pageConfig = config;
    };
    global.wx = {
      showToast() {},
      showLoading() {},
      hideLoading() {},
      showModal() {},
      stopPullDownRefresh() {},
      setStorageSync() {},
      getStorageSync() {
        return '';
      }
    };

    delete require.cache[indexPath];
    require('../pages/index/index');

    const pageInstance = {
      ...buildPageInstance(pageConfig),
      setData(update, callback) {
        setTimeout(() => {
          this.data = { ...this.data, ...update };
          if (typeof callback === 'function') {
            callback();
          }
        }, 0);
      }
    };

    await pageConfig.onLoad.call(pageInstance);

    assert.equal(
      pageInstance.data.calendarDays.some((item) => item.date === '2026-04-03' && item.hasRecord),
      true
    );
  } finally {
    global.Page = originalPage;
    global.wx = originalWx;
    delete require.cache[indexPath];
    if (originalHelper) {
      require.cache[helperPath] = originalHelper;
    } else {
      delete require.cache[helperPath];
    }
  }
});
