const test = require('node:test');
const assert = require('node:assert/strict');

const indexPath = require.resolve('../pages/index/index');
const helperPath = require.resolve('../utils/cloud-sync-helper');

function getDefaultSnapshot() {
  return {
    records: {},
    terms: ['Adagio'],
    termsUpdatedAt: '',
    goal: '',
    goalUpdatedAt: '',
    courseTags: [{ name: '入门', selected: false }],
    courseTagsUpdatedAt: ''
  };
}

const cloudSyncHelperDefaults = {
  getDefaultSnapshot,
  readLocalSnapshot: getDefaultSnapshot,
  hasLocalRecords() {
    return false;
  },
  isDeviceInitialized() {
    return false;
  },
  markDeviceInitialized() {},
  migrateLocalSnapshotToCloud() {
    return Promise.resolve({ migrated: false, snapshot: getDefaultSnapshot() });
  },
  restoreFromCloudIfLocalEmpty() {
    return Promise.resolve({ restored: false, snapshot: getDefaultSnapshot() });
  },
  pushSnapshotToCloud(snapshot) {
    return Promise.resolve({ snapshot });
  },
  backupSnapshotToCloud(snapshot) {
    return Promise.resolve({ snapshot });
  },
  saveSingleRecordToCloud(dateKey, record) {
    return Promise.resolve({ type: 'update', dateKey, record });
  },
  deleteSingleRecordInCloud() {
    return Promise.resolve({ type: 'remove', count: 1 });
  },
  queueRecordDeletion() {},
  clearPendingRecordDeletion() {},
  flushPendingRecordDeletions() {
    return Promise.resolve({ completed: [], remaining: [] });
  },
  fetchLatestCloudSnapshot() {
    return Promise.resolve(null);
  },
  stripDeletedSnapshot(snapshot = getDefaultSnapshot()) {
    const records = Object.fromEntries(
      Object.entries(snapshot.records || {}).filter(([, record]) => !record.isDeleted)
    );
    return { ...snapshot, records };
  },
  writeLocalSnapshot() {}
};

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

test('onLoad keeps local records visible while the background cloud backup completes', async () => {
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
      ...cloudSyncHelperDefaults,
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
      '2026-04-01': { note: 'local first', courses: [] }
    });
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

test('onLoad keeps a newer local snapshot when the cloud backup is older', async () => {
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
      ...cloudSyncHelperDefaults,
      readLocalSnapshot() {
        return {
          records: {
            '2026-04-01': {
              note: 'local record',
              courses: [],
              updatedAt: '2026-04-01T08:00:00.000Z'
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
      },
      fetchLatestCloudSnapshot() {
        return Promise.resolve({
          records: {
            '2026-04-01': {
              note: 'cloud old record',
              courses: [],
              updatedAt: '2026-03-31T08:00:00.000Z'
            }
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
      '2026-04-01': {
        note: 'local record',
        courses: [],
        updatedAt: '2026-04-01T08:00:00.000Z'
      }
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

test('onLoad keeps local records authoritative and does not apply a newer cloud tombstone', async () => {
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
      ...cloudSyncHelperDefaults,
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
        return Promise.resolve({
          records: {
            '2026-04-08': {
              note: '',
              courses: [],
              isDeleted: true,
              deletedAt: '2026-04-09T08:00:00.000Z',
              updatedAt: '2026-04-09T08:00:00.000Z'
            }
          },
          terms: ['Adagio'],
          goal: '云端目标',
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
    const onLoadPromise = pageConfig.onLoad.call(pageInstance);
    await flushMicrotasks();

    assert.deepEqual(Object.keys(pageInstance.data.allRecords), ['2026-04-08']);

    await onLoadPromise;
    await pageInstance.startupSyncPromise;

    assert.deepEqual(pageInstance.data.allRecords, {
      '2026-04-08': { note: '电脑端旧缓存', updatedAt: '2026-04-08T08:00:00.000Z', courses: [] }
    });
    assert.equal(pageInstance.data.monthlyGoal, '旧目标');
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

test('onLoad does not replace the visible local photo during background backup', async () => {
  const originalPage = global.Page;
  const originalWx = global.wx;
  const originalHelper = require.cache[helperPath];

  let pageConfig;

  require.cache[helperPath] = {
    id: helperPath,
    filename: helperPath,
    loaded: true,
    exports: {
      ...cloudSyncHelperDefaults,
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
        return Promise.resolve({
          records: {
            '2026-04-01': {
              note: 'local record',
              photo: 'cloud://env-id/ballet-mood/2026-04-01-1.jpg',
              courses: [],
              updatedAt: '2026-04-02T08:00:00.000Z'
            }
          },
          terms: ['Adagio'],
          goal: '四月练满十次',
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

    assert.equal(
      pageInstance.data.allRecords['2026-04-01'].photo,
      '/tmp/local-photo.jpg'
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
      ...cloudSyncHelperDefaults,
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

test('onLoad preserves cloud records when an initialized device has unexpectedly empty local data', async () => {
  const originalPage = global.Page;
  const originalWx = global.wx;
  const originalHelper = require.cache[helperPath];

  let pageConfig;
  let restoreCalls = 0;
  let backupCalls = 0;
  let backupOptions;

  require.cache[helperPath] = {
    id: helperPath,
    filename: helperPath,
    loaded: true,
    exports: {
      ...cloudSyncHelperDefaults,
      readLocalSnapshot() {
        return {
          records: {},
          terms: ['Adagio'],
          goal: '',
          courseTags: []
        };
      },
      hasLocalRecords() {
        return false;
      },
      isDeviceInitialized() {
        return true;
      },
      restoreFromCloudIfLocalEmpty() {
        restoreCalls += 1;
        return Promise.resolve({
          restored: true,
          snapshot: {
            records: {
              '2026-04-02': { note: '不应复活的云端旧记录', courses: [] }
            }
          }
        });
      },
      migrateLocalSnapshotToCloud(wxApi, options) {
        backupCalls += 1;
        backupOptions = options;
        return Promise.resolve({ migrated: true });
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

    assert.deepEqual(pageInstance.data.allRecords, {});
    assert.equal(restoreCalls, 0);
    assert.equal(backupCalls, 1);
    assert.deepEqual(backupOptions, { replaceRecords: false });
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

test('saveRecord persists locally first and sends the saved day to precise cloud backup', async () => {
  const originalPage = global.Page;
  const originalWx = global.wx;
  const originalHelper = require.cache[helperPath];

  let pageConfig;
  const savedRecords = [];
  const storageWrites = [];
  const clearedDeletionDates = [];

  require.cache[helperPath] = {
    id: helperPath,
    filename: helperPath,
    loaded: true,
    exports: {
      ...cloudSyncHelperDefaults,
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
      saveSingleRecordToCloud(dateKey, record) {
        savedRecords.push({ dateKey, record });
        return Promise.resolve({ type: 'update', dateKey, record });
      },
      clearPendingRecordDeletion(dateKey) {
        clearedDeletionDates.push(dateKey);
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
    await pageInstance.waitForPendingCloudSync();

    assert.equal(storageWrites.some(({ key }) => key === 'balletMoodData'), true);
    assert.equal(savedRecords.length, 1);
    assert.equal(savedRecords[0].dateKey, '2026-04-03');
    assert.deepEqual(clearedDeletionDates, ['2026-04-03']);
    assert.deepEqual(savedRecords[0].record.terms, ['Adagio']);
    assert.deepEqual(pageInstance.data.records, {
      '2026-04-03': pageInstance.data.allRecords['2026-04-03']
    });
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

test('deleteFromPostcard removes the local record and sends a precise cloud delete', async () => {
  const originalPage = global.Page;
  const originalWx = global.wx;
  const originalHelper = require.cache[helperPath];

  let pageConfig;
  const deletedDateKeys = [];
  const deletedPhotoFileIds = [];
  const queuedDeletionDates = [];
  const storageWrites = [];

  require.cache[helperPath] = {
    id: helperPath,
    filename: helperPath,
    loaded: true,
    exports: {
      ...cloudSyncHelperDefaults,
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
      deleteSingleRecordInCloud(dateKey, wxApi, options = {}) {
        deletedDateKeys.push(dateKey);
        deletedPhotoFileIds.push(...(options.photoFileIds || []));
        return Promise.resolve({ type: 'remove', count: 1 });
      },
      queueRecordDeletion(dateKey) {
        queuedDeletionDates.push(dateKey);
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
    assert.deepEqual(queuedDeletionDates, ['2026-04-02']);
    assert.deepEqual(deletedDateKeys, ['2026-04-02']);
    assert.deepEqual(deletedPhotoFileIds, ['cloud://env/expired.jpg']);
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

test('pull-to-refresh cloud import is removed while a precise delete is pending', async () => {
  const originalPage = global.Page;
  const originalWx = global.wx;
  const originalHelper = require.cache[helperPath];

  let pageConfig;
  let resolveDelete;
  let deleteResolved = false;
  let fetchCalls = 0;

  require.cache[helperPath] = {
    id: helperPath,
    filename: helperPath,
    loaded: true,
    exports: {
      ...cloudSyncHelperDefaults,
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
      deleteSingleRecordInCloud() {
        return new Promise((resolve) => {
          resolveDelete = () => {
            deleteResolved = true;
            resolve({ type: 'remove', count: 1 });
          };
        });
      },
      fetchLatestCloudSnapshot() {
        fetchCalls += 1;
        return Promise.resolve(deleteResolved ? {
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
    fetchCalls = 0;

    pageInstance.data.selectedDate = '2026-04-02';
    pageInstance.data.showPostcard = true;
    pageConfig.deleteFromPostcard.call(pageInstance);

    await flushMicrotasks();

    assert.equal(fetchCalls, 0);
    assert.equal(pageConfig.onRefresh, undefined);
    assert.equal(pageConfig.onPullDownRefresh, undefined);

    resolveDelete();
    await pageInstance.waitForPendingCloudSync();

    assert.deepEqual(Object.keys(pageInstance.data.allRecords), ['2026-04-01']);
    assert.equal(fetchCalls, 0);
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

test('onShow cloud import is removed so cloud changes cannot overwrite local records', async () => {
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
      ...cloudSyncHelperDefaults,
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
        return fetchCalls === 1 ? Promise.resolve(null) : cloudPromise;
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

    assert.equal(pageConfig.onShow, undefined);
    assert.equal(fetchCalls, 0);
    assert.equal(pageInstance.data.allRecords['2026-04-08'].note, '本地旧记录');
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

test('onShow is absent and never fetches an older cloud snapshot', async () => {
  const originalPage = global.Page;
  const originalWx = global.wx;
  const originalHelper = require.cache[helperPath];

  let pageConfig;
  let fetchCalls = 0;

  require.cache[helperPath] = {
    id: helperPath,
    filename: helperPath,
    loaded: true,
    exports: {
      ...cloudSyncHelperDefaults,
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
        fetchCalls += 1;
        return fetchCalls === 1 ? Promise.resolve(null) : Promise.resolve({
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

    assert.equal(pageConfig.onShow, undefined);
    assert.equal(fetchCalls, 0);

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
      ...cloudSyncHelperDefaults,
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
      ...cloudSyncHelperDefaults,
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
      ...cloudSyncHelperDefaults,
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
      ...cloudSyncHelperDefaults,
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

    assert.deepEqual(pageInstance.data.allRecords, {
      '2026-04-03': { note: 'cloud restored', courses: [] }
    });
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

test('precise record sync waits for the startup backup before writing', async () => {
  const originalPage = global.Page;
  const originalWx = global.wx;
  const originalHelper = require.cache[helperPath];
  let pageConfig;
  let releaseStartup;
  const events = [];

  require.cache[helperPath] = {
    id: helperPath,
    filename: helperPath,
    loaded: true,
    exports: {
      ...cloudSyncHelperDefaults,
      async saveSingleRecordToCloud() {
        events.push('record-sync');
        return { record: { note: '最新记录', photo: '' } };
      }
    }
  };

  try {
    global.Page = (config) => { pageConfig = config; };
    global.wx = {
      getStorageSync() { return {}; },
      setStorageSync() {}
    };
    delete require.cache[indexPath];
    require('../pages/index/index');

    const pageInstance = buildPageInstance(pageConfig);
    pageInstance.startupSyncPromise = new Promise((resolve) => {
      releaseStartup = () => {
        events.push('startup-complete');
        resolve();
      };
    });

    const pending = pageConfig.syncSingleRecordInBackground.call(
      pageInstance,
      '2026-10-02',
      { note: '最新记录', photo: '' }
    );
    await flushMicrotasks();
    assert.deepEqual(events, []);

    releaseStartup();
    await pending;
    assert.deepEqual(events, ['startup-complete', 'record-sync']);
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

test('an older photo upload never overwrites a newer local edit for the same day', async () => {
  const originalPage = global.Page;
  const originalWx = global.wx;
  const originalHelper = require.cache[helperPath];
  let pageConfig;
  let finishUpload;
  const dateKey = '2026-10-08';
  const firstRecord = {
    note: '照片 A',
    photo: '/local/photo-a.jpg',
    updatedAt: '2026-10-08T08:00:00.000Z'
  };
  const newerRecord = {
    note: '照片 B',
    photo: '/local/photo-b.jpg',
    updatedAt: '2026-10-08T08:01:00.000Z'
  };
  const storage = {
    balletMoodData: { [dateKey]: { ...firstRecord } }
  };

  require.cache[helperPath] = {
    id: helperPath,
    filename: helperPath,
    loaded: true,
    exports: {
      ...cloudSyncHelperDefaults,
      saveSingleRecordToCloud() {
        return new Promise((resolve) => {
          finishUpload = () => resolve({
            record: {
              ...firstRecord,
              photo: 'cloud://env/photo-a.jpg'
            }
          });
        });
      }
    }
  };

  try {
    global.Page = (config) => { pageConfig = config; };
    global.wx = {
      getStorageSync(key) { return storage[key]; },
      setStorageSync(key, value) { storage[key] = value; }
    };
    delete require.cache[indexPath];
    require('../pages/index/index');

    const pageInstance = buildPageInstance(pageConfig);
    const pending = pageConfig.syncSingleRecordInBackground.call(
      pageInstance,
      dateKey,
      firstRecord
    );
    await flushMicrotasks();

    storage.balletMoodData = { [dateKey]: { ...newerRecord } };
    finishUpload();
    await pending;

    assert.deepEqual(storage.balletMoodData[dateKey], newerRecord);
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
