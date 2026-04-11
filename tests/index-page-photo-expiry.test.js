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

test('expired photo fallback hides broken thumbnails and surfaces re-upload hints', async () => {
  const originalPage = global.Page;
  const originalWx = global.wx;
  const originalHelper = require.cache[helperPath];

  let pageConfig;

  const localSnapshot = {
    records: {
      '2026-04-02': {
        note: 'old temp image',
        photo: '/tmp/expired-photo.jpg',
        courses: [{ name: '初级', duration: '2' }]
      }
    },
    terms: ['Adagio'],
    goal: '',
    courseTags: [{ name: '入门', selected: false }]
  };

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
        return localSnapshot;
      },
      hasLocalRecords() {
        return true;
      },
      migrateLocalSnapshotToCloud() {
        return Promise.resolve({
          migrated: false,
          reason: 'local-only',
          snapshot: localSnapshot
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

    pageConfig.openEditModal.call(pageInstance, '2026-04-02');
    assert.equal(pageInstance.data.currentPhoto, '/tmp/expired-photo.jpg');
    assert.equal(pageInstance.data.currentPhotoExpired, false);

    await pageConfig.handleEditPhotoError.call(pageInstance);
    assert.equal(pageInstance.data.currentPhotoExpired, true);
    assert.equal(pageInstance.data.expiredPhotoDates['2026-04-02'], true);
    assert.equal(
      pageInstance.data.calendarDays.some((item) => item.date === '2026-04-02' && item.photo === ''),
      true
    );

    pageConfig.openPostcard.call(pageInstance, '2026-04-02');
    assert.equal(pageInstance.data.postcardData.photoExpired, true);
    assert.equal(pageInstance.data.postcardData.photo, '');

    pageConfig.openEditModal.call(pageInstance, '2026-04-02');
    assert.equal(pageInstance.data.currentPhotoExpired, true);
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
