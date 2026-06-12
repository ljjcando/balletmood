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

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

test('onLoad renders local records first while startup cloud sync continues in background', async () => {
  const originalPage = global.Page;
  const originalWx = global.wx;
  const originalHelper = require.cache[helperPath];

  let pageConfig;
  let resolveMigration;
  const migrationPromise = new Promise((resolve) => {
    resolveMigration = resolve;
  });

  require.cache[helperPath] = {
    id: helperPath,
    filename: helperPath,
    loaded: true,
    exports: {
      readLocalSnapshot() {
        return {
          records: {
            '2026-04-01': { note: 'local first', courses: [] }
          },
          terms: ['Adagio'],
          goal: '本地目标',
          courseTags: [{ name: '入门', selected: false }]
        };
      },
      hasLocalRecords() {
        return true;
      },
      migrateLocalSnapshotToCloud() {
        return migrationPromise;
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
    const onLoadPromise = pageConfig.onLoad.call(pageInstance);
    await flushMicrotasks();

    assert.deepEqual(pageInstance.data.allRecords, {
      '2026-04-01': { note: 'local first', courses: [] }
    });
    assert.equal(pageInstance.data.monthlyGoal, '本地目标');

    resolveMigration({
      migrated: true,
      reason: 'full-sync-complete',
      snapshot: {
        records: {
          '2026-03-31': { note: 'cloud merged', courses: [] },
          '2026-04-01': { note: 'local first', courses: [] }
        },
        terms: ['Adagio'],
        goal: '云端目标',
        courseTags: [{ name: '入门', selected: false }]
      }
    });

    await onLoadPromise;
    await pageInstance.startupSyncPromise;

    assert.deepEqual(pageInstance.data.allRecords, {
      '2026-03-31': { note: 'cloud merged', courses: [] },
      '2026-04-01': { note: 'local first', courses: [] }
    });
    assert.equal(pageInstance.data.monthlyGoal, '云端目标');
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

test('onLoad renders stale local cache first and then applies a newer cloud tombstone snapshot', async () => {
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
            '2026-04-08': { note: '电脑端旧缓存', updatedAt: '2026-04-08T08:00:00.000Z', courses: [] }
          },
          terms: ['Adagio'],
          goal: '旧目标',
          courseTags: [{ name: '入门', selected: false }]
        };
      },
      hasLocalRecords() {
        return true;
      },
      migrateLocalSnapshotToCloud() {
        migrateCalls += 1;
        return Promise.resolve({
          migrated: false,
          reason: 'cloud-newer',
          snapshot: {
            records: {},
            terms: ['Adagio'],
            goal: '云端目标',
            courseTags: [{ name: '入门', selected: false }]
          }
        });
      },
      restoreFromCloudIfLocalEmpty() {
        restoreCalls += 1;
        return Promise.resolve({ restored: false, snapshot: null });
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
    const onLoadPromise = pageConfig.onLoad.call(pageInstance);
    await flushMicrotasks();

    assert.deepEqual(Object.keys(pageInstance.data.allRecords), ['2026-04-08']);

    await onLoadPromise;
    await pageInstance.startupSyncPromise;

    assert.deepEqual(pageInstance.data.allRecords, {});
    assert.equal(pageInstance.data.monthlyGoal, '云端目标');
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
    await pageInstance.startupSyncPromise;

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
    await pageInstance.startupSyncPromise;

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

test('deleteFromPostcard removes the record from page state and syncs the reduced snapshot', async () => {
  const originalPage = global.Page;
  const originalWx = global.wx;
  const originalHelper = require.cache[helperPath];

  let pageConfig;
  const pushedSnapshots = [];
  const pushedOptions = [];
  const storageWrites = [];

  require.cache[helperPath] = {
    id: helperPath,
    filename: helperPath,
    loaded: true,
    exports: {
      readLocalSnapshot() {
        return {
          records: {
            '2026-04-01': { note: '保留', courses: [] },
            '2026-04-02': { note: '删除我', photo: 'cloud://env/expired.jpg', courses: [] }
          },
          terms: ['Adagio'],
          goal: '本月目标',
          courseTags: [{ name: '入门', selected: false }]
        };
      },
      hasLocalRecords() {
        return true;
      },
      migrateLocalSnapshotToCloud() {
        return Promise.resolve({
          migrated: false,
          reason: 'local-only',
          snapshot: {
            records: {
              '2026-04-01': { note: '保留', courses: [] },
              '2026-04-02': { note: '删除我', photo: 'cloud://env/expired.jpg', courses: [] }
            },
            terms: ['Adagio'],
            goal: '本月目标',
            courseTags: [{ name: '入门', selected: false }]
          }
        });
      },
      restoreFromCloudIfLocalEmpty() {
        return Promise.resolve({ restored: false, reason: 'local-exists', snapshot: null });
      },
      pushSnapshotToCloud(snapshot) {
        pushedSnapshots.push(snapshot);
        pushedOptions.push(arguments[2] || {});
        return Promise.resolve({ snapshot });
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
      setStorageSync(key, value) {
        storageWrites.push({ key, value });
      },
      getStorageSync() {
        return '';
      },
      showModal({ success }) {
        success({ confirm: true });
      }
    };

    delete require.cache[indexPath];
    require('../pages/index/index');

    const pageInstance = buildPageInstance(pageConfig);
    await pageConfig.onLoad.call(pageInstance);
    await pageInstance.startupSyncPromise;

    pageInstance.data.selectedDate = '2026-04-02';
    pageInstance.data.showPostcard = true;
    await pageConfig.deleteFromPostcard.call(pageInstance);
    await pageInstance.waitForPendingCloudSync();

    assert.deepEqual(Object.keys(pageInstance.data.allRecords), ['2026-04-01']);
    assert.deepEqual(Object.keys(pageInstance.data.records), ['2026-04-01']);
    assert.equal(
      pageInstance.data.calendarDays.some((item) => item.date === '2026-04-02' && item.hasRecord),
      false
    );
    assert.equal(storageWrites.some(({ key, value }) => key === 'balletMoodData' && !value['2026-04-02']), true);
    assert.equal(pushedSnapshots.length, 1);
    assert.equal(pushedSnapshots[0].records['2026-04-02'], undefined);
    assert.deepEqual(pushedOptions[0].deletedRecordDates, ['2026-04-02']);
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

test('onRefresh waits for a pending delete sync before reading cloud data again', async () => {
  const originalPage = global.Page;
  const originalWx = global.wx;
  const originalHelper = require.cache[helperPath];

  let pageConfig;
  let resolvePush;
  let pushResolved = false;
  let fetchCalls = 0;

  require.cache[helperPath] = {
    id: helperPath,
    filename: helperPath,
    loaded: true,
    exports: {
      readLocalSnapshot() {
        return {
          records: {
            '2026-04-01': { note: '保留', courses: [] },
            '2026-04-02': { note: '删除我', courses: [] }
          },
          terms: ['Adagio'],
          goal: '本月目标',
          courseTags: [{ name: '入门', selected: false }]
        };
      },
      getDefaultSnapshot() {
        return {
          records: {},
          terms: ['Adagio'],
          goal: '',
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
      pushSnapshotToCloud() {
        return new Promise((resolve) => {
          resolvePush = () => {
            pushResolved = true;
            resolve({
              snapshot: {
                records: {
                  '2026-04-01': { note: '保留', courses: [] }
                },
                terms: ['Adagio'],
                goal: '本月目标',
                courseTags: [{ name: '入门', selected: false }]
              }
            });
          };
        });
      },
      fetchLatestCloudSnapshot() {
        fetchCalls += 1;
        return Promise.resolve(pushResolved ? {
          records: {
            '2026-04-01': { note: '保留', courses: [] }
          },
          terms: ['Adagio'],
          goal: '本月目标',
          courseTags: [{ name: '入门', selected: false }]
        } : {
          records: {
            '2026-04-01': { note: '保留', courses: [] },
            '2026-04-02': { note: '删除我', courses: [] }
          },
          terms: ['Adagio'],
          goal: '本月目标',
          courseTags: [{ name: '入门', selected: false }]
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
      stopPullDownRefresh() {},
      setStorageSync() {},
      getStorageSync() {
        return '';
      },
      showModal({ success }) {
        success({ confirm: true });
      }
    };

    delete require.cache[indexPath];
    require('../pages/index/index');

    const pageInstance = buildPageInstance(pageConfig);
    await pageConfig.onLoad.call(pageInstance);
    await pageInstance.startupSyncPromise;

    pageInstance.data.selectedDate = '2026-04-02';
    pageInstance.data.showPostcard = true;
    pageConfig.deleteFromPostcard.call(pageInstance);

    const refreshPromise = pageConfig.onRefresh.call(pageInstance);
    await flushMicrotasks();

    assert.equal(fetchCalls, 0);

    resolvePush();
    await refreshPromise;

    assert.deepEqual(Object.keys(pageInstance.data.allRecords), ['2026-04-01']);
    assert.equal(fetchCalls, 1);
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

test('onShow keeps the current page interactive and only applies a newer cloud snapshot in the background', async () => {
  const originalPage = global.Page;
  const originalWx = global.wx;
  const originalHelper = require.cache[helperPath];

  let pageConfig;
  let resolveCloudFetch;
  let fetchCalls = 0;

  const cloudPromise = new Promise((resolve) => {
    resolveCloudFetch = resolve;
  });

  require.cache[helperPath] = {
    id: helperPath,
    filename: helperPath,
    loaded: true,
    exports: {
      readLocalSnapshot() {
        return {
          records: {
            '2026-04-08': { note: '本地旧记录', updatedAt: '2026-04-08T08:00:00.000Z', courses: [] }
          },
          terms: ['Adagio'],
          goal: '本地目标',
          courseTags: [{ name: '入门', selected: false }]
        };
      },
      hasLocalRecords() {
        return true;
      },
      migrateLocalSnapshotToCloud() {
        return Promise.resolve({
          migrated: false,
          reason: 'up-to-date',
          snapshot: {
            records: {
              '2026-04-08': { note: '本地旧记录', updatedAt: '2026-04-08T08:00:00.000Z', courses: [] }
            },
            terms: ['Adagio'],
            goal: '本地目标',
            courseTags: [{ name: '入门', selected: false }]
          }
        });
      },
      restoreFromCloudIfLocalEmpty() {
        return Promise.resolve({ restored: false, snapshot: null });
      },
      pushSnapshotToCloud() {
        return Promise.resolve();
      },
      fetchLatestCloudSnapshot() {
        fetchCalls += 1;
        return cloudPromise;
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
    await pageInstance.startupSyncPromise;

    pageConfig.onShow.call(pageInstance);
    assert.equal(fetchCalls, 1);
    assert.equal(pageInstance.data.allRecords['2026-04-08'].note, '本地旧记录');

    resolveCloudFetch({
      records: {
        '2026-04-08': { note: '云端新记录', updatedAt: '2026-04-09T09:00:00.000Z', courses: [] }
      },
      terms: ['Adagio'],
      goal: '云端目标',
      courseTags: [{ name: '入门', selected: false }]
    });

    await flushMicrotasks();

    assert.equal(pageInstance.data.allRecords['2026-04-08'].note, '云端新记录');
    assert.equal(pageInstance.data.monthlyGoal, '云端目标');
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

test('onShow ignores older cloud snapshots and keeps newer local cache intact', async () => {
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
            '2026-04-08': { note: '本地新记录', updatedAt: '2026-04-10T08:00:00.000Z', courses: [] }
          },
          terms: ['Adagio'],
          goal: '本地目标',
          courseTags: [{ name: '入门', selected: false }]
        };
      },
      hasLocalRecords() {
        return true;
      },
      migrateLocalSnapshotToCloud() {
        return Promise.resolve({
          migrated: false,
          reason: 'up-to-date',
          snapshot: {
            records: {
              '2026-04-08': { note: '本地新记录', updatedAt: '2026-04-10T08:00:00.000Z', courses: [] }
            },
            terms: ['Adagio'],
            goal: '本地目标',
            courseTags: [{ name: '入门', selected: false }]
          }
        });
      },
      restoreFromCloudIfLocalEmpty() {
        return Promise.resolve({ restored: false, snapshot: null });
      },
      pushSnapshotToCloud() {
        return Promise.resolve();
      },
      fetchLatestCloudSnapshot() {
        return Promise.resolve({
          records: {
            '2026-04-08': { note: '云端旧记录', updatedAt: '2026-04-08T08:00:00.000Z', courses: [] }
          },
          terms: ['Adagio'],
          goal: '云端旧目标',
          courseTags: [{ name: '入门', selected: false }]
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
    await pageInstance.startupSyncPromise;

    pageConfig.onShow.call(pageInstance);
    await flushMicrotasks();

    assert.equal(pageInstance.data.allRecords['2026-04-08'].note, '本地新记录');
    assert.equal(pageInstance.data.monthlyGoal, '本地目标');
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

test('startup migration does not reapply a deleted record after a local mutation', async () => {
  const originalPage = global.Page;
  const originalWx = global.wx;
  const originalHelper = require.cache[helperPath];

  let pageConfig;
  let resolveMigration;
  const migrationPromise = new Promise((resolve) => {
    resolveMigration = resolve;
  });

  require.cache[helperPath] = {
    id: helperPath,
    filename: helperPath,
    loaded: true,
    exports: {
      readLocalSnapshot() {
        return {
          records: {
            '2026-04-01': { note: '保留', courses: [] },
            '2026-04-02': { note: '待删除', courses: [] }
          },
          terms: ['Adagio'],
          goal: '本月目标',
          courseTags: [{ name: '入门', selected: false }]
        };
      },
      hasLocalRecords() {
        return true;
      },
      migrateLocalSnapshotToCloud() {
        return migrationPromise;
      },
      restoreFromCloudIfLocalEmpty() {
        return Promise.resolve({ restored: false, snapshot: null });
      },
      pushSnapshotToCloud(snapshot) {
        return Promise.resolve({ snapshot });
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
      stopPullDownRefresh() {},
      setStorageSync() {},
      getStorageSync() {
        return '';
      },
      showModal({ success }) {
        success({ confirm: true });
      }
    };

    delete require.cache[indexPath];
    require('../pages/index/index');

    const pageInstance = buildPageInstance(pageConfig);
    const onLoadPromise = pageConfig.onLoad.call(pageInstance);
    await flushMicrotasks();

    pageInstance.data.selectedDate = '2026-04-02';
    pageInstance.data.showPostcard = true;
    pageConfig.deleteFromPostcard.call(pageInstance);

    resolveMigration({
      migrated: true,
      reason: 'full-sync-complete',
      snapshot: {
        records: {
          '2026-04-01': { note: '保留', courses: [] },
          '2026-04-02': { note: '待删除', courses: [] }
        },
        terms: ['Adagio'],
        goal: '云端目标',
        courseTags: [{ name: '入门', selected: false }]
      }
    });

    await onLoadPromise;
    await pageInstance.startupSyncPromise;

    assert.deepEqual(Object.keys(pageInstance.data.allRecords), ['2026-04-01']);
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

test('startup migration does not restore a deleted term into the edit modal after local changes', async () => {
  const originalPage = global.Page;
  const originalWx = global.wx;
  const originalHelper = require.cache[helperPath];

  let pageConfig;
  let resolveMigration;
  const migrationPromise = new Promise((resolve) => {
    resolveMigration = resolve;
  });

  require.cache[helperPath] = {
    id: helperPath,
    filename: helperPath,
    loaded: true,
    exports: {
      readLocalSnapshot() {
        return {
          records: {
            '2026-04-01': { note: '已有记录', terms: ['Adagio'], courses: [] }
          },
          terms: ['Adagio', 'Fondu'],
          goal: '本月目标',
          courseTags: [{ name: '入门', selected: false }]
        };
      },
      hasLocalRecords() {
        return true;
      },
      migrateLocalSnapshotToCloud() {
        return migrationPromise;
      },
      restoreFromCloudIfLocalEmpty() {
        return Promise.resolve({ restored: false, snapshot: null });
      },
      pushSnapshotToCloud(snapshot) {
        return Promise.resolve({ snapshot });
      },
      fetchLatestCloudSnapshot() {
        return Promise.resolve(null);
      },
      getDefaultSnapshot() {
        return {
          records: {},
          terms: ['Adagio'],
          goal: '',
          courseTags: [{ name: '入门', selected: false }]
        };
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
      stopPullDownRefresh() {},
      setStorageSync() {},
      getStorageSync() {
        return '';
      },
      showModal({ success }) {
        success({ confirm: true });
      }
    };

    delete require.cache[indexPath];
    require('../pages/index/index');

    const pageInstance = buildPageInstance(pageConfig);
    const onLoadPromise = pageConfig.onLoad.call(pageInstance);
    await flushMicrotasks();

    pageConfig.longPressTerm.call(pageInstance, {
      currentTarget: {
        dataset: { index: 1 }
      }
    });

    resolveMigration({
      migrated: true,
      reason: 'full-sync-complete',
      snapshot: {
        records: {
          '2026-04-01': { note: '已有记录', terms: ['Adagio'], courses: [] }
        },
        terms: ['Adagio', 'Fondu'],
        goal: '云端目标',
        courseTags: [{ name: '入门', selected: false }]
      }
    });

    await onLoadPromise;
    await pageInstance.startupSyncPromise;

    pageConfig.openEditModal.call(pageInstance, '2026-04-01');

    assert.deepEqual(
      pageInstance.data.termsOptions.map((item) => item.name),
      ['Adagio']
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

test('startup migration does not restore a deleted course tag after local changes', async () => {
  const originalPage = global.Page;
  const originalWx = global.wx;
  const originalHelper = require.cache[helperPath];

  let pageConfig;
  let resolveMigration;
  const migrationPromise = new Promise((resolve) => {
    resolveMigration = resolve;
  });

  require.cache[helperPath] = {
    id: helperPath,
    filename: helperPath,
    loaded: true,
    exports: {
      readLocalSnapshot() {
        return {
          records: {
            '2026-04-01': { note: '已有记录', courses: [{ name: '入门', duration: '1.5' }] }
          },
          terms: ['Adagio'],
          goal: '本月目标',
          courseTags: [
            { name: '入门', selected: false },
            { name: '提高', selected: false }
          ]
        };
      },
      hasLocalRecords() {
        return true;
      },
      migrateLocalSnapshotToCloud() {
        return migrationPromise;
      },
      restoreFromCloudIfLocalEmpty() {
        return Promise.resolve({ restored: false, snapshot: null });
      },
      pushSnapshotToCloud(snapshot) {
        return Promise.resolve({ snapshot });
      },
      fetchLatestCloudSnapshot() {
        return Promise.resolve(null);
      },
      getDefaultSnapshot() {
        return {
          records: {},
          terms: ['Adagio'],
          goal: '',
          courseTags: [{ name: '入门', selected: false }]
        };
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
      stopPullDownRefresh() {},
      setStorageSync() {},
      getStorageSync() {
        return '';
      },
      showModal({ success }) {
        success({ confirm: true });
      },
      showActionSheet({ success }) {
        success({ tapIndex: 1 });
      }
    };

    delete require.cache[indexPath];
    require('../pages/index/index');

    const pageInstance = buildPageInstance(pageConfig);
    const onLoadPromise = pageConfig.onLoad.call(pageInstance);
    await flushMicrotasks();

    pageConfig.longPressCourseTag.call(pageInstance, {
      currentTarget: {
        dataset: { index: 1 }
      }
    });

    resolveMigration({
      migrated: true,
      reason: 'full-sync-complete',
      snapshot: {
        records: {
          '2026-04-01': { note: '已有记录', courses: [{ name: '入门', duration: '1.5' }] }
        },
        terms: ['Adagio'],
        goal: '云端目标',
        courseTags: [
          { name: '入门', selected: false },
          { name: '提高', selected: false }
        ]
      }
    });

    await onLoadPromise;
    await pageInstance.startupSyncPromise;

    assert.deepEqual(pageInstance.data.courseTags, [{ name: '入门', selected: false }]);
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
    await pageInstance.startupSyncPromise;

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
