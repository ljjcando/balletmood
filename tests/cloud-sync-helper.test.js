const test = require('node:test');
const assert = require('node:assert/strict');

const helperPath = require.resolve('../utils/cloud-sync-helper');

const LEGACY_COLLECTION = 'ballet_mood_users';
const PROFILE_COLLECTION = 'ballet_mood_profiles';
const RECORDS_COLLECTION = 'ballet_mood_records';

function createWxStub({
  local = {},
  queryResult = [],
  fallbackResult = [],
  profileQueryResult = [],
  recordsQueryResult = [],
  failRemoveWith = null,
  failUpdateWith = null,
  failUpdateCollection = null
} = {}) {
  const storage = { ...local };
  let whereCalls = 0;
  let fallbackCalls = 0;
  let updatedPayload = null;
  let addedPayload = null;
  const updatedPayloads = {};
  const addedPayloads = {};
  const removedDocIds = {};
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
    get updatedPayloads() {
      return updatedPayloads;
    },
    get addedPayloads() {
      return addedPayloads;
    },
    get removedDocIds() {
      return removedDocIds;
    },
    get uploadCalls() {
      return uploadCalls;
    },
    wx: {
      getStorageSync(key) {
        return storage[key];
      },
      getStorageInfoSync() {
        return { keys: Object.keys(storage) };
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
            collection(name) {
              const currentQueryResult = name === PROFILE_COLLECTION
                ? profileQueryResult
                : name === RECORDS_COLLECTION
                  ? recordsQueryResult
                  : queryResult;
              const currentFallbackResult = name === LEGACY_COLLECTION ? fallbackResult : [];

              return {
                where() {
                  whereCalls += 1;
                  let currentSkip = 0;
                  const queryApi = {
                    async get() {
                      return { data: currentSkip === 0 ? currentQueryResult : [] };
                    },
                    skip(n) {
                      currentSkip = n || 0;
                      return queryApi;
                    },
                    limit() {
                      return {
                        async get() {
                          return { data: currentSkip === 0 ? currentQueryResult : [] };
                        }
                      };
                    }
                  };

                  return queryApi;
                },
                doc() {
                  return {
                    async remove() {
                      if (failRemoveWith && (!failUpdateCollection || failUpdateCollection === name)) {
                        throw failRemoveWith;
                      }
                      if (!removedDocIds[name]) {
                        removedDocIds[name] = [];
                      }
                      removedDocIds[name].push('removed');
                      return { stats: { removed: 1 } };
                    },
                    async update({ data }) {
                      if (failUpdateWith && (!failUpdateCollection || failUpdateCollection === name)) {
                        throw failUpdateWith;
                      }
                      updatedPayload = data;
                      if (!updatedPayloads[name]) {
                        updatedPayloads[name] = [];
                      }
                      updatedPayloads[name].push(data);
                      return { stats: { updated: 1 } };
                    }
                  };
                },
                async add({ data }) {
                  addedPayload = data;
                  if (!addedPayloads[name]) {
                    addedPayloads[name] = [];
                  }
                  addedPayloads[name].push(data);
                  return { _id: 'new-doc-id' };
                },
                orderBy() {
                  fallbackCalls += 1;
                  return {
                    limit() {
                      return {
                        async get() {
                          return { data: currentFallbackResult };
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

test('isDeviceInitialized recognizes legacy devices with an empty records storage key', () => {
  const originalHelper = require.cache[helperPath];

  try {
    delete require.cache[helperPath];
    const { isDeviceInitialized } = require('../utils/cloud-sync-helper');

    const legacyDevice = createWxStub({
      local: { balletMoodData: {} }
    });
    const newDevice = createWxStub({ local: {} });
    const markedDevice = createWxStub({
      local: { balletMoodDeviceInitialized: true }
    });

    assert.equal(isDeviceInitialized(legacyDevice.wx), true);
    assert.equal(isDeviceInitialized(newDevice.wx), false);
    assert.equal(isDeviceInitialized(markedDevice.wx), true);
  } finally {
    if (originalHelper) {
      require.cache[helperPath] = originalHelper;
    } else {
      delete require.cache[helperPath];
    }
  }
});

test('pushSnapshotToCloud keeps a cloud tombstone so stale local records cannot revive deleted entries', async () => {
  const originalHelper = require.cache[helperPath];

  try {
    delete require.cache[helperPath];
    const {
      pushSnapshotToCloud
    } = require('../utils/cloud-sync-helper');

    const stub = createWxStub({
      local: {
        balletMoodData: {
          '2026-04-08': {
            note: '电脑端旧缓存',
            updatedAt: '2026-04-08T08:00:00.000Z'
          }
        },
        balletMoodTerms: ['Adagio'],
        balletMoodGoal: '',
        balletMoodCourseTags: [{ name: '入门', selected: false }]
      },
      profileQueryResult: [{
        _id: 'profile-doc',
        terms: ['Adagio'],
        goal: '',
        courseTags: [{ name: '入门', selected: false }],
        updatedAt: new Date('2026-04-12T09:00:00.000Z')
      }],
      recordsQueryResult: [{
        _id: 'record-deleted',
        dateKey: '2026-04-08',
        note: '',
        isDeleted: true,
        deletedAt: new Date('2026-04-12T10:00:00.000Z'),
        updatedAt: new Date('2026-04-12T10:00:00.000Z')
      }]
    });

    const result = await pushSnapshotToCloud({
      records: {
        '2026-04-08': {
          note: '电脑端旧缓存',
          updatedAt: '2026-04-08T08:00:00.000Z'
        }
      },
      terms: ['Adagio'],
      goal: '',
      courseTags: [{ name: '入门', selected: false }]
    }, stub.wx);

    assert.deepEqual(result.snapshot.records, {});
    assert.equal(
      stub.updatedPayloads[RECORDS_COLLECTION].some((payload) => payload.dateKey === '2026-04-08' && payload.isDeleted === true),
      true
    );
    assert.deepEqual(stub.storage.balletMoodData, {});
  } finally {
    if (originalHelper) {
      require.cache[helperPath] = originalHelper;
    } else {
      delete require.cache[helperPath];
    }
  }
});

test('fetchLatestCloudSnapshot keeps legacy tombstones so freshness checks can see them', async () => {
  const originalHelper = require.cache[helperPath];

  try {
    delete require.cache[helperPath];
    const {
      fetchLatestCloudSnapshot
    } = require('../utils/cloud-sync-helper');

    const stub = createWxStub({
      profileQueryResult: [{
        _id: 'profile-doc',
        terms: ['Adagio'],
        goal: '目标',
        courseTags: [{ name: '入门', selected: false }],
        updatedAt: new Date('2026-04-12T09:00:00.000Z')
      }],
      recordsQueryResult: [{
        _id: 'record-keep',
        dateKey: '2026-04-07',
        note: '保留',
        updatedAt: new Date('2026-04-07T09:00:00.000Z')
      }, {
        _id: 'record-deleted',
        dateKey: '2026-04-08',
        isDeleted: true,
        deletedAt: new Date('2026-04-12T10:00:00.000Z'),
        updatedAt: new Date('2026-04-12T10:00:00.000Z')
      }]
    });

    const snapshot = await fetchLatestCloudSnapshot(stub.wx);

    assert.equal(snapshot.records['2026-04-07'].note, '保留');
    assert.equal(snapshot.records['2026-04-08'].isDeleted, true);
    assert.equal(snapshot.records['2026-04-08'].deletedAt, '2026-04-12T10:00:00.000Z');
  } finally {
    if (originalHelper) {
      require.cache[helperPath] = originalHelper;
    } else {
      delete require.cache[helperPath];
    }
  }
});

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
    assert.equal(stub.whereCalls >= 3, true);
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

test('restoreFromCloudIfLocalEmpty uses updatedAt when duplicate documents disagree', async () => {
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
      profileQueryResult: [{
        _id: 'profile-doc',
        terms: ['Fondu'],
        goal: '恢复',
        courseTags: [{ name: '提高', selected: false }],
        updatedAt: new Date('2026-04-11T16:00:00+08:00')
      }],
      recordsQueryResult: [{
        _id: 'bad-record',
        dateKey: '2026-04-08',
        note: '旧坏数据',
        photo: '',
        updatedAt: new Date('2100-01-01T07:59:59+08:00')
      }, {
        _id: 'good-record',
        dateKey: '2026-04-08',
        note: '新记录',
        photo: 'cloud://env-id/ballet-mood/2026-04-08.jpg',
        updatedAt: new Date('2026-04-11T16:05:00+08:00')
      }]
    });

    const result = await restoreFromCloudIfLocalEmpty(stub.wx);

    assert.equal(result.restored, true);
    assert.equal(result.snapshot.records['2026-04-08'].note, '旧坏数据');
    assert.equal(result.snapshot.records['2026-04-08'].photo, '');
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

    assert.equal(result.type, 'structured-sync');
    assert.deepEqual(Object.keys(result.snapshot.records).sort(), [
      '2026-03-15',
      '2026-03-31',
      '2026-04-01'
    ]);
    assert.equal(result.snapshot.records['2026-03-15'].note, 'cloud newer');
    assert.equal(result.snapshot.records['2026-03-31'].note, 'local month end');
    assert.equal(result.snapshot.records['2026-04-01'].note, 'cloud april');
    assert.deepEqual(stub.storage.balletMoodData, result.snapshot.records);
  } finally {
    if (originalHelper) {
      require.cache[helperPath] = originalHelper;
    } else {
      delete require.cache[helperPath];
    }
  }
});

test('pushSnapshotToCloud respects a newer cloud-side photo deletion', async () => {
  const originalHelper = require.cache[helperPath];

  try {
    delete require.cache[helperPath];
    const {
      pushSnapshotToCloud
    } = require('../utils/cloud-sync-helper');

    const stub = createWxStub({
      local: {
        balletMoodData: {
          '2026-04-08': {
            note: '本地重新上传后',
            photo: '/tmp/reuploaded-photo.jpg',
            updatedAt: '2026-04-11T07:30:00.000Z'
          }
        },
        balletMoodTerms: ['Adagio'],
        balletMoodGoal: '',
        balletMoodCourseTags: [{ name: '入门', selected: false }]
      },
      queryResult: [{
        _id: 'cloud-doc-id',
        records: {
          '2026-04-08': {
            note: '云端旧内容',
            photo: '',
            updatedAt: '2099-12-31T23:59:59.000Z'
          }
        }
      }]
    });

    const result = await pushSnapshotToCloud({
      records: {
        '2026-04-08': {
          note: '本地重新上传后',
          photo: '/tmp/reuploaded-photo.jpg',
          updatedAt: '2026-04-11T07:30:00.000Z'
        }
      },
      terms: ['Adagio'],
      goal: '',
      courseTags: [{ name: '入门', selected: false }]
    }, stub.wx);

    assert.equal(result.snapshot.records['2026-04-08'].photo, '');
    assert.equal(stub.uploadCalls.length, 0);
    assert.equal(
      stub.addedPayloads[RECORDS_COLLECTION].some((payload) => payload.dateKey === '2026-04-08' && payload.photo === ''),
      true
    );
  } finally {
    if (originalHelper) {
      require.cache[helperPath] = originalHelper;
    } else {
      delete require.cache[helperPath];
    }
  }
});

test('pushSnapshotToCloud falls back to add when update payload exceeds expression size limit', async () => {
  const originalHelper = require.cache[helperPath];

  try {
    delete require.cache[helperPath];
    const {
      pushSnapshotToCloud
    } = require('../utils/cloud-sync-helper');

    const stub = createWxStub({
      local: {
        balletMoodData: {
          '2026-04-08': {
            note: '本地记录',
            photo: '/tmp/reuploaded-photo.jpg',
            updatedAt: '2026-04-11T07:30:00.000Z'
          }
        },
        balletMoodTerms: ['Adagio'],
        balletMoodGoal: '',
        balletMoodCourseTags: [{ name: '入门', selected: false }]
      },
      queryResult: [{
        _id: 'cloud-doc-id',
        records: {
          '2026-04-08': {
            note: '云端旧内容',
            photo: '',
            updatedAt: '2099-12-31T23:59:59.000Z'
          }
        }
      }],
      recordsQueryResult: [{
        _id: 'record-doc-id',
        dateKey: '2026-04-08',
        note: '云端旧内容',
        photo: '',
        updatedAt: '2099-12-31T23:59:59.000Z'
      }],
      failUpdateWith: {
        errCode: -401002,
        errMsg: 'api parameter error | errMsg: update expression size must be less than 512 KB'
      },
      failUpdateCollection: RECORDS_COLLECTION
    });

    const result = await pushSnapshotToCloud({
      records: {
        '2026-04-08': {
          note: '本地记录',
          photo: '/tmp/reuploaded-photo.jpg',
          updatedAt: '2026-04-11T07:30:00.000Z'
        }
      },
      terms: ['Adagio'],
      goal: '',
      courseTags: [{ name: '入门', selected: false }]
    }, stub.wx);

    assert.equal(result.type, 'structured-sync');
    assert.equal(result.snapshot.records['2026-04-08'].photo, '');
    assert.equal(
      stub.addedPayloads[RECORDS_COLLECTION].some((payload) => payload.dateKey === '2026-04-08' && payload.photo === ''),
      true
    );
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
    assert.equal(
      stub.addedPayloads[RECORDS_COLLECTION].some((payload) => payload.dateKey === '2026-03-31' && payload.photo.startsWith('cloud://')),
      true
    );
    assert.equal(stub.uploadCalls.length, 1);
  } finally {
    if (originalHelper) {
      require.cache[helperPath] = originalHelper;
    } else {
      delete require.cache[helperPath];
    }
  }
});

test('pushSnapshotToCloud removes structured cloud records that are missing from the incoming snapshot when replaceRecords is enabled', async () => {
  const originalHelper = require.cache[helperPath];

  try {
    delete require.cache[helperPath];
    const {
      pushSnapshotToCloud,
      RECORDS_COLLECTION_NAME
    } = require('../utils/cloud-sync-helper');

    const stub = createWxStub({
      local: {
        balletMoodData: {},
        balletMoodTerms: ['Adagio'],
        balletMoodGoal: '',
        balletMoodCourseTags: [{ name: '入门', selected: false }]
      },
      profileQueryResult: [{
        _id: 'profile-doc',
        terms: ['Adagio'],
        goal: '',
        courseTags: [{ name: '入门', selected: false }],
        updatedAt: new Date('2026-04-11T16:00:00+08:00')
      }],
      recordsQueryResult: [{
        _id: 'record-keep',
        dateKey: '2026-04-01',
        note: '保留',
        updatedAt: new Date('2026-04-01T10:00:00+08:00')
      }, {
        _id: 'record-delete',
        dateKey: '2026-04-02',
        note: '应删除',
        updatedAt: new Date('2026-04-02T10:00:00+08:00')
      }]
    });

    const result = await pushSnapshotToCloud({
      records: {
        '2026-04-01': {
          note: '保留',
          updatedAt: '2026-04-01T02:00:00.000Z'
        }
      },
      terms: ['Adagio'],
      goal: '',
      courseTags: [{ name: '入门', selected: false }]
    }, stub.wx, { replaceRecords: true });

    assert.deepEqual(Object.keys(result.snapshot.records), ['2026-04-01']);
    assert.equal(Array.isArray(stub.removedDocIds[RECORDS_COLLECTION_NAME]), true);
    assert.equal(stub.removedDocIds[RECORDS_COLLECTION_NAME].length, 1);
  } finally {
    if (originalHelper) {
      require.cache[helperPath] = originalHelper;
    } else {
      delete require.cache[helperPath];
    }
  }
});

test('pushSnapshotToCloud permanently removes explicitly deleted dates', async () => {
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
      profileQueryResult: [{
        _id: 'profile-doc',
        terms: ['Adagio'],
        goal: '',
        courseTags: [{ name: '入门', selected: false }],
        updatedAt: new Date('2026-04-11T16:00:00+08:00')
      }],
      recordsQueryResult: [{
        _id: 'record-delete',
        dateKey: '2026-04-02',
        note: '应删除',
        photo: 'cloud://env/old.jpg',
        updatedAt: new Date('2026-04-02T10:00:00+08:00')
      }]
    });

    const result = await pushSnapshotToCloud({
      records: {},
      terms: ['Adagio'],
      goal: '',
      courseTags: [{ name: '入门', selected: false }]
    }, stub.wx, {
      replaceRecords: true,
      deletedRecordDates: ['2026-04-02']
    });

    assert.deepEqual(result.snapshot.records, {});
    assert.equal(stub.removedDocIds[RECORDS_COLLECTION].length, 1);
    assert.equal(stub.updatedPayloads[RECORDS_COLLECTION], undefined);
  } finally {
    if (originalHelper) {
      require.cache[helperPath] = originalHelper;
    } else {
      delete require.cache[helperPath];
    }
  }
});

test('saveSingleRecordToCloud updates one document and removes same-day duplicates', async () => {
  const originalHelper = require.cache[helperPath];

  try {
    delete require.cache[helperPath];
    const {
      saveSingleRecordToCloud
    } = require('../utils/cloud-sync-helper');

    const stub = createWxStub({
      recordsQueryResult: [{
        _id: 'record-keep',
        dateKey: '2026-04-08',
        note: '旧内容'
      }, {
        _id: 'record-duplicate-1',
        dateKey: '2026-04-08',
        note: '重复内容一'
      }, {
        _id: 'record-duplicate-2',
        dateKey: '2026-04-08',
        note: '重复内容二'
      }]
    });

    const result = await saveSingleRecordToCloud('2026-04-08', {
      note: '最新内容',
      photo: '',
      terms: ['Adagio'],
      bodyParts: [],
      courses: [],
      updatedAt: '2026-04-08T10:00:00.000Z'
    }, stub.wx);

    assert.equal(result.type, 'update');
    assert.equal(result.duplicatesRemoved, 2);
    assert.equal(stub.updatedPayloads[RECORDS_COLLECTION][0].note, '最新内容');
    assert.equal(stub.removedDocIds[RECORDS_COLLECTION].length, 2);
  } finally {
    if (originalHelper) {
      require.cache[helperPath] = originalHelper;
    } else {
      delete require.cache[helperPath];
    }
  }
});

test('deleteSingleRecordInCloud permanently removes every same-day document', async () => {
  const originalHelper = require.cache[helperPath];

  try {
    delete require.cache[helperPath];
    const {
      deleteSingleRecordInCloud
    } = require('../utils/cloud-sync-helper');

    const stub = createWxStub({
      recordsQueryResult: [{
        _id: 'record-1',
        dateKey: '2026-04-08'
      }, {
        _id: 'record-2',
        dateKey: '2026-04-08'
      }]
    });

    const result = await deleteSingleRecordInCloud('2026-04-08', stub.wx);

    assert.deepEqual(result, { type: 'remove', count: 2 });
    assert.equal(stub.removedDocIds[RECORDS_COLLECTION].length, 2);
    assert.equal(stub.updatedPayloads[RECORDS_COLLECTION], undefined);
  } finally {
    if (originalHelper) {
      require.cache[helperPath] = originalHelper;
    } else {
      delete require.cache[helperPath];
    }
  }
});

test('pending cloud deletions survive failure and clear only after a successful retry', async () => {
  const originalHelper = require.cache[helperPath];

  try {
    delete require.cache[helperPath];
    const {
      queueRecordDeletion,
      flushPendingRecordDeletions
    } = require('../utils/cloud-sync-helper');

    const failedStub = createWxStub({
      local: {},
      recordsQueryResult: [{ _id: 'record-1', dateKey: '2026-04-08' }],
      failRemoveWith: new Error('offline')
    });
    queueRecordDeletion('2026/04/08', failedStub.wx);

    await assert.rejects(
      flushPendingRecordDeletions(failedStub.wx),
      /offline/
    );
    assert.deepEqual(
      failedStub.storage.balletMoodPendingRecordDeletions,
      ['2026-04-08']
    );

    const successStub = createWxStub({
      local: {
        balletMoodPendingRecordDeletions: ['2026-04-08']
      },
      recordsQueryResult: [{ _id: 'record-1', dateKey: '2026-04-08' }]
    });
    const result = await flushPendingRecordDeletions(successStub.wx);

    assert.deepEqual(result, { completed: ['2026-04-08'], remaining: [] });
    assert.deepEqual(successStub.storage.balletMoodPendingRecordDeletions, []);
  } finally {
    if (originalHelper) {
      require.cache[helperPath] = originalHelper;
    } else {
      delete require.cache[helperPath];
    }
  }
});

test('backupSnapshotToCloud mirrors the local snapshot without importing cloud-only records', async () => {
  const originalHelper = require.cache[helperPath];

  try {
    delete require.cache[helperPath];
    const { backupSnapshotToCloud } = require('../utils/cloud-sync-helper');
    const localRecord = {
      note: '本地记录',
      photo: '',
      terms: [],
      bodyParts: [],
      courses: [],
      updatedAt: '2026-04-08T10:00:00.000Z'
    };
    const stub = createWxStub({
      local: {},
      profileQueryResult: [{ _id: 'profile-doc' }],
      recordsQueryResult: [{
        _id: 'record-local',
        dateKey: '2026-04-08',
        ...localRecord
      }, {
        _id: 'record-cloud-only',
        dateKey: '2026-04-09',
        note: '不应导入本地'
      }]
    });

    const result = await backupSnapshotToCloud({
      records: { '2026-04-08': localRecord },
      terms: ['Adagio'],
      goal: '',
      courseTags: [{ name: '入门', selected: false }]
    }, stub.wx);

    assert.deepEqual(Object.keys(result.snapshot.records), ['2026-04-08']);
    assert.deepEqual(Object.keys(stub.storage.balletMoodData), ['2026-04-08']);
    assert.equal(stub.removedDocIds[RECORDS_COLLECTION].length, 1);
  } finally {
    if (originalHelper) {
      require.cache[helperPath] = originalHelper;
    } else {
      delete require.cache[helperPath];
    }
  }
});

test('pushSnapshotToCloud prefers a newer local terms list and course tag list over stale cloud values', async () => {
  const originalHelper = require.cache[helperPath];

  try {
    delete require.cache[helperPath];
    const {
      pushSnapshotToCloud
    } = require('../utils/cloud-sync-helper');

    const stub = createWxStub({
      local: {
        balletMoodData: {
          '2026-04-08': {
            note: '已有记录',
            updatedAt: '2026-04-08T08:00:00.000Z'
          }
        },
        balletMoodTerms: ['Adagio'],
        balletMoodTermsUpdatedAt: '2026-04-12T10:00:00.000Z',
        balletMoodGoal: '',
        balletMoodCourseTags: [{ name: '提高', selected: false }],
        balletMoodCourseTagsUpdatedAt: '2026-04-12T10:05:00.000Z'
      },
      profileQueryResult: [{
        _id: 'profile-doc',
        terms: ['Adagio', 'Fondu'],
        termsUpdatedAt: new Date('2026-04-11T09:00:00.000Z'),
        goal: '',
        courseTags: [
          { name: '入门', selected: false },
          { name: '提高', selected: false }
        ],
        courseTagsUpdatedAt: new Date('2026-04-11T09:05:00.000Z'),
        updatedAt: new Date('2026-04-11T09:05:00.000Z')
      }],
      recordsQueryResult: [{
        _id: 'record-keep',
        dateKey: '2026-04-08',
        note: '已有记录',
        updatedAt: new Date('2026-04-08T08:00:00.000Z')
      }]
    });

    const result = await pushSnapshotToCloud({
      records: {
        '2026-04-08': {
          note: '已有记录',
          updatedAt: '2026-04-08T08:00:00.000Z'
        }
      },
      terms: ['Adagio'],
      termsUpdatedAt: '2026-04-12T10:00:00.000Z',
      goal: '',
      courseTags: [{ name: '提高', selected: false }],
      courseTagsUpdatedAt: '2026-04-12T10:05:00.000Z'
    }, stub.wx);

    assert.deepEqual(result.snapshot.terms, ['Adagio']);
    assert.equal(result.snapshot.terms.includes('Fondu'), false);
    assert.deepEqual(result.snapshot.courseTags, [{ name: '提高', selected: false }]);
    assert.deepEqual(stub.storage.balletMoodTerms, ['Adagio']);
    assert.deepEqual(stub.storage.balletMoodCourseTags, [{ name: '提高', selected: false }]);
    assert.equal(stub.storage.balletMoodTermsUpdatedAt, '2026-04-12T10:00:00.000Z');
    assert.equal(stub.storage.balletMoodCourseTagsUpdatedAt, '2026-04-12T10:05:00.000Z');
  } finally {
    if (originalHelper) {
      require.cache[helperPath] = originalHelper;
    } else {
      delete require.cache[helperPath];
    }
  }
});
