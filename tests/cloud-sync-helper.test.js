const test = require('node:test');
const assert = require('node:assert/strict');

const helperPath = require.resolve('../utils/cloud-sync-helper');

function createWxStub({ local = {}, queryResult = [], fallbackResult = [] } = {}) {
  const storage = { ...local };
  let whereCalls = 0;
  let fallbackCalls = 0;
  let updatedPayload = null;
  let addedPayload = null;
  const uploadCalls = [];

  return {
    storage,
    get whereCalls() {
      return whereCalls;
    },
    get fallbackCalls() {
      return fallbackCalls;
    },
    get updatedPayload() {
      return updatedPayload;
    },
    get addedPayload() {
      return addedPayload;
    },
    get uploadCalls() {
      return uploadCalls;
    },
    wx: {
      getStorageSync(key) {
        return storage[key];
      },
      setStorageSync(key, value) {
        storage[key] = value;
      },
      cloud: {
        async uploadFile(options) {
          uploadCalls.push(options);
          return {
            fileID: `cloud://env-id/${options.cloudPath}`
          };
        },
        database() {
          return {
            collection() {
              return {
                where() {
                  whereCalls += 1;
                  const queryApi = {
                    async get() {
                      return { data: queryResult };
                    },
                    limit() {
                      return {
                        async get() {
                          return { data: queryResult };
                        }
                      };
                    }
                  };

                  return {
                    ...queryApi
                  };
                },
                doc() {
                  return {
                    async update({ data }) {
                      updatedPayload = data;
                      return { stats: { updated: 1 } };
                    }
                  };
                },
                async add({ data }) {
                  addedPayload = data;
                  return { _id: 'new-doc-id' };
                },
                orderBy() {
                  fallbackCalls += 1;
                  return {
                    limit() {
                      return {
                        async get() {
                          return { data: fallbackResult };
                        }
                      };
                    }
                  };
                }
              };
            }
          };
        }
      }
    }
  };
}

test('restoreFromCloudIfLocalEmpty falls back to the latest cloud doc when _openid lookup returns empty', async () => {
  const originalHelper = require.cache[helperPath];

  try {
    delete require.cache[helperPath];
    const {
      restoreFromCloudIfLocalEmpty
    } = require('../utils/cloud-sync-helper');

    const stub = createWxStub({
      local: {
        balletMoodData: {},
        balletMoodTerms: '',
        balletMoodGoal: '',
        balletMoodCourseTags: ''
      },
      queryResult: [],
      fallbackResult: [{
        records: {
          '2026-04-02': { note: 'cloud backup', courses: [] }
        },
        terms: ['Fondu'],
        goal: '恢复',
        courseTags: [{ name: '提高', selected: false }]
      }]
    });

    const result = await restoreFromCloudIfLocalEmpty(stub.wx);

    assert.equal(result.restored, true);
    assert.deepEqual(result.snapshot.records, {
      '2026-04-02': { note: 'cloud backup', courses: [] }
    });
    assert.equal(stub.whereCalls, 1);
    assert.equal(stub.fallbackCalls, 1);
    assert.deepEqual(stub.storage.balletMoodData, {
      '2026-04-02': { note: 'cloud backup', courses: [] }
    });
  } finally {
    if (originalHelper) {
      require.cache[helperPath] = originalHelper;
    } else {
      delete require.cache[helperPath];
    }
  }
});

test('restoreFromCloudIfLocalEmpty skips same-user empty docs and restores the latest non-empty snapshot', async () => {
  const originalHelper = require.cache[helperPath];

  try {
    delete require.cache[helperPath];
    const {
      restoreFromCloudIfLocalEmpty
    } = require('../utils/cloud-sync-helper');

    const stub = createWxStub({
      local: {
        balletMoodData: {},
        balletMoodTerms: '',
        balletMoodGoal: '',
        balletMoodCourseTags: ''
      },
      queryResult: [{
        _id: 'empty-doc',
        records: {},
        updatedAt: new Date('2026-04-01T00:15:29+08:00')
      }, {
        _id: 'filled-doc',
        records: {
          '2026-04-02': { note: 'cloud backup', courses: [] }
        },
        terms: ['Fondu'],
        goal: '恢复',
        courseTags: [{ name: '提高', selected: false }],
        updatedAt: new Date('2026-04-02T10:00:00+08:00')
      }]
    });

    const result = await restoreFromCloudIfLocalEmpty(stub.wx);

    assert.equal(result.restored, true);
    assert.deepEqual(result.snapshot.records, {
      '2026-04-02': { note: 'cloud backup', courses: [] }
    });
    assert.deepEqual(stub.storage.balletMoodData, {
      '2026-04-02': { note: 'cloud backup', courses: [] }
    });
    assert.equal(stub.fallbackCalls, 0);
  } finally {
    if (originalHelper) {
      require.cache[helperPath] = originalHelper;
    } else {
      delete require.cache[helperPath];
    }
  }
});

test('pushSnapshotToCloud deep merges full history and keeps the newer updatedAt for same-day conflicts', async () => {
  const originalHelper = require.cache[helperPath];

  try {
    delete require.cache[helperPath];
    const {
      pushSnapshotToCloud
    } = require('../utils/cloud-sync-helper');

    const stub = createWxStub({
      local: {
        balletMoodData: {
          '2026-03-15': { note: 'local march', updatedAt: '2026-03-15T08:00:00.000Z' }
        },
        balletMoodTerms: ['Adagio'],
        balletMoodGoal: '四月目标',
        balletMoodCourseTags: [{ name: '入门', selected: false }]
      },
      queryResult: [{
        _id: 'cloud-doc-id',
        records: {
          '2026-03-15': { note: 'cloud newer', updatedAt: '2026-03-15T10:00:00.000Z' },
          '2026-04-01': { note: 'cloud april', updatedAt: '2026-04-01T09:00:00.000Z' }
        },
        terms: ['Fondu'],
        goal: '云端目标',
        courseTags: [{ name: '提高', selected: false }]
      }]
    });

    const result = await pushSnapshotToCloud({
      records: {
        '2026/03/15': { note: 'local older', updatedAt: '2026-03-15T08:00:00.000Z' },
        '2026-03-31': { note: 'local month end', updatedAt: '2026-03-31T12:00:00.000Z' }
      },
      terms: ['Adagio'],
      goal: '本地目标',
      courseTags: [{ name: '入门', selected: false }]
    }, stub.wx);

    assert.equal(result.type, 'update');
    assert.deepEqual(Object.keys(stub.updatedPayload.records).sort(), [
      '2026-03-15',
      '2026-03-31',
      '2026-04-01'
    ]);
    assert.equal(stub.updatedPayload.records['2026-03-15'].note, 'cloud newer');
    assert.equal(stub.updatedPayload.records['2026-03-31'].note, 'local month end');
    assert.equal(stub.updatedPayload.records['2026-04-01'].note, 'cloud april');
    assert.deepEqual(stub.storage.balletMoodData, stub.updatedPayload.records);
  } finally {
    if (originalHelper) {
      require.cache[helperPath] = originalHelper;
    } else {
      delete require.cache[helperPath];
    }
  }
});

test('pushSnapshotToCloud uploads local temp photos to cloud before writing merged records', async () => {
  const originalHelper = require.cache[helperPath];

  try {
    delete require.cache[helperPath];
    const {
      pushSnapshotToCloud
    } = require('../utils/cloud-sync-helper');

    const stub = createWxStub({
      local: {
        balletMoodData: {},
        balletMoodTerms: ['Adagio'],
        balletMoodGoal: '',
        balletMoodCourseTags: [{ name: '入门', selected: false }]
      },
      queryResult: [{
        _id: 'cloud-doc-id',
        records: {}
      }]
    });

    const result = await pushSnapshotToCloud({
      records: {
        '2026-03-31': {
          note: '带图记录',
          photo: '/tmp/local-photo.jpg',
          updatedAt: '2026-03-31T10:00:00.000Z'
        }
      },
      terms: ['Adagio'],
      goal: '',
      courseTags: [{ name: '入门', selected: false }]
    }, stub.wx);

    assert.equal(result.snapshot.records['2026-03-31'].photo.startsWith('cloud://'), true);
    assert.equal(stub.updatedPayload.records['2026-03-31'].photo.startsWith('cloud://'), true);
    assert.equal(stub.uploadCalls.length, 1);
  } finally {
    if (originalHelper) {
      require.cache[helperPath] = originalHelper;
    } else {
      delete require.cache[helperPath];
    }
  }
});
