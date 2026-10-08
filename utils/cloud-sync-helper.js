const { normalizeCourseTags } = require('../pages/index/course-tags-helper');
const {
  normalizeMonthlyGoals,
  mergeMonthlyGoals
} = require('../pages/index/monthly-goals-helper');

const COLLECTION_NAME = 'ballet_mood_users';
const PROFILE_COLLECTION_NAME = 'ballet_mood_profiles';
const RECORDS_COLLECTION_NAME = 'ballet_mood_records';

const STORAGE_KEYS = {
  records: 'balletMoodData',
  terms: 'balletMoodTerms',
  termsUpdatedAt: 'balletMoodTermsUpdatedAt',
  goal: 'balletMoodGoal',
  goalUpdatedAt: 'balletMoodGoalUpdatedAt',
  monthlyGoals: 'balletMoodMonthlyGoals',
  courseTags: 'balletMoodCourseTags',
  courseTagsUpdatedAt: 'balletMoodCourseTagsUpdatedAt',
  deviceInitialized: 'balletMoodDeviceInitialized',
  pendingRecordDeletions: 'balletMoodPendingRecordDeletions',
  pendingPhotoDeletions: 'balletMoodPendingPhotoDeletions'
};

const DEFAULT_TERMS = ['Rond de jambe', 'Adagio', 'jete', 'fondu', 'passe'];
const DEFAULT_COURSE_TAGS = normalizeCourseTags();

function normalizeRecordDateKey(key) {
  if (typeof key !== 'string') {
    return '';
  }

  const trimmedKey = key.trim();
  if (!trimmedKey) {
    return '';
  }

  const simpleDateMatch = trimmedKey.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (simpleDateMatch) {
    const [, year, month, day] = simpleDateMatch;
    const normalizedYear = Number(year);
    const normalizedMonth = Number(month);
    const normalizedDay = Number(day);
    const parsedTimestamp = Date.UTC(normalizedYear, normalizedMonth - 1, normalizedDay);
    const parsedDate = new Date(parsedTimestamp);
    if (
      parsedDate.getUTCFullYear() !== normalizedYear ||
      parsedDate.getUTCMonth() + 1 !== normalizedMonth ||
      parsedDate.getUTCDate() !== normalizedDay
    ) {
      return '';
    }
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const parsedDate = new Date(trimmedKey);
  if (Number.isNaN(parsedDate.getTime())) {
    return trimmedKey;
  }

  const year = parsedDate.getFullYear();
  const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
  const day = String(parsedDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeRecords(records) {
  if (!records || typeof records !== 'object' || Array.isArray(records)) {
    return {};
  }

  return Object.keys(records).reduce((acc, rawKey) => {
    const normalizedKey = normalizeRecordDateKey(rawKey);
    if (!normalizedKey) {
      return acc;
    }

    acc[normalizedKey] = records[rawKey];
    return acc;
  }, {});
}

function toTimestamp(value) {
  if (typeof value !== 'string' || !value) {
    if (value instanceof Date) {
      const dateTimestamp = value.getTime();
      return Number.isNaN(dateTimestamp) ? Number.NaN : dateTimestamp;
    }

    return Number.NaN;
  }

  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? Number.NaN : timestamp;
}

function pickNewerRecord(localRecord, cloudRecord) {
  if (!localRecord) return cloudRecord;
  if (!cloudRecord) return localRecord;

  const localTimestamp = toTimestamp(localRecord.updatedAt);
  const cloudTimestamp = toTimestamp(cloudRecord.updatedAt);

  let preferredRecord;
  let fallbackRecord;

  if (Number.isNaN(localTimestamp) && Number.isNaN(cloudTimestamp)) {
    preferredRecord = { ...cloudRecord, ...localRecord };
    fallbackRecord = { ...localRecord, ...cloudRecord };
  } else if (Number.isNaN(localTimestamp)) {
    preferredRecord = cloudRecord;
    fallbackRecord = localRecord;
  } else if (Number.isNaN(cloudTimestamp)) {
    preferredRecord = localRecord;
    fallbackRecord = cloudRecord;
  } else {
    preferredRecord = localTimestamp >= cloudTimestamp ? localRecord : cloudRecord;
    fallbackRecord = preferredRecord === localRecord ? cloudRecord : localRecord;
  }

  if (preferredRecord && preferredRecord.isDeleted) {
    return preferredRecord;
  }

  return preferredRecord;
}

function mergeRecords(localRecords, cloudRecords) {
  const normalizedLocalRecords = normalizeRecords(localRecords);
  const normalizedCloudRecords = normalizeRecords(cloudRecords);
  const mergedKeys = new Set([
    ...Object.keys(normalizedCloudRecords),
    ...Object.keys(normalizedLocalRecords)
  ]);

  return Array.from(mergedKeys).reduce((acc, key) => {
    acc[key] = pickNewerRecord(normalizedLocalRecords[key], normalizedCloudRecords[key]);
    return acc;
  }, {});
}

function mergeStringArrays(localValues, cloudValues) {
  const merged = [
    ...(Array.isArray(cloudValues) ? cloudValues : []),
    ...(Array.isArray(localValues) ? localValues : [])
  ];

  return merged.filter((value, index) => (
    typeof value === 'string' &&
    value &&
    merged.indexOf(value) === index
  ));
}

function mergeCourseTags(localTags, cloudTags) {
  return normalizeCourseTags([
    ...(Array.isArray(cloudTags) ? cloudTags : []),
    ...(Array.isArray(localTags) ? localTags : [])
  ]);
}

function normalizeMetadataTimestamp(value) {
  if (typeof value === 'string' && value) {
    return value;
  }

  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isNaN(timestamp) ? '' : value.toISOString();
  }

  return '';
}

function pickMergedProfileValue({
  localValue,
  cloudValue,
  localUpdatedAt,
  cloudUpdatedAt,
  fallbackMerge
}) {
  const normalizedLocalUpdatedAt = normalizeMetadataTimestamp(localUpdatedAt);
  const normalizedCloudUpdatedAt = normalizeMetadataTimestamp(cloudUpdatedAt);
  const localTimestamp = toTimestamp(normalizedLocalUpdatedAt);
  const cloudTimestamp = toTimestamp(normalizedCloudUpdatedAt);

  if (Number.isNaN(localTimestamp) && Number.isNaN(cloudTimestamp)) {
    return {
      value: fallbackMerge(localValue, cloudValue),
      updatedAt: ''
    };
  }

  if (Number.isNaN(cloudTimestamp)) {
    return {
      value: localValue,
      updatedAt: normalizedLocalUpdatedAt
    };
  }

  if (Number.isNaN(localTimestamp)) {
    return {
      value: cloudValue,
      updatedAt: normalizedCloudUpdatedAt
    };
  }

  if (localTimestamp >= cloudTimestamp) {
    return {
      value: localValue,
      updatedAt: normalizedLocalUpdatedAt
    };
  }

  return {
    value: cloudValue,
    updatedAt: normalizedCloudUpdatedAt
  };
}

function isCloudFileId(path) {
  return typeof path === 'string' && path.startsWith('cloud://');
}

function buildPhotoCloudPath(dateKey, photoPath) {
  const safeDateKey = normalizeRecordDateKey(dateKey) || 'unknown-date';
  const extensionMatch = typeof photoPath === 'string' ? photoPath.match(/\.[a-zA-Z0-9]+$/) : null;
  const extension = extensionMatch ? extensionMatch[0] : '.jpg';
  return `ballet-mood/${safeDateKey}-${Date.now()}${extension}`;
}

async function uploadPhotoIfNeeded(dateKey, photoPath, wxApi = wx) {
  if (typeof photoPath !== 'string' || !photoPath) {
    return '';
  }

  if (isCloudFileId(photoPath)) {
    return photoPath;
  }

  if (!wxApi || !wxApi.cloud || typeof wxApi.cloud.uploadFile !== 'function') {
    return photoPath;
  }

  const uploadResult = await wxApi.cloud.uploadFile({
    cloudPath: buildPhotoCloudPath(dateKey, photoPath),
    filePath: photoPath
  });

  return uploadResult && uploadResult.fileID ? uploadResult.fileID : photoPath;
}

async function hydrateSnapshotPhotos(snapshot, wxApi = wx) {
  const normalizedSnapshot = normalizeSnapshot(snapshot);
  const records = normalizedSnapshot.records || {};
  const hydratedEntries = await Promise.all(
    Object.keys(records).map(async (dateKey) => {
      const record = records[dateKey] || {};
      if (!record.photo) {
        return [dateKey, record];
      }

      const nextPhoto = await uploadPhotoIfNeeded(dateKey, record.photo, wxApi);
      return [
        dateKey,
        {
          ...record,
          photo: nextPhoto
        }
      ];
    })
  );

  return {
    ...normalizedSnapshot,
    records: Object.fromEntries(hydratedEntries)
  };
}

function getDb(wxApi = wx) {
  if (!wxApi || !wxApi.cloud || typeof wxApi.cloud.database !== 'function') {
    throw new Error('云开发未初始化');
  }

  return wxApi.cloud.database();
}

function getCollection(name, wxApi = wx) {
  return getDb(wxApi).collection(name);
}

function getLegacyCollection(wxApi = wx) {
  return getCollection(COLLECTION_NAME, wxApi);
}

function getProfileCollection(wxApi = wx) {
  return getCollection(PROFILE_COLLECTION_NAME, wxApi);
}

function getRecordCollection(wxApi = wx) {
  return getCollection(RECORDS_COLLECTION_NAME, wxApi);
}

function getDefaultSnapshot() {
  return {
    records: {},
    terms: [...DEFAULT_TERMS],
    termsUpdatedAt: '',
    goal: '',
    goalUpdatedAt: '',
    monthlyGoals: {},
    courseTags: normalizeCourseTags(DEFAULT_COURSE_TAGS),
    courseTagsUpdatedAt: ''
  };
}

function normalizeSnapshot(snapshot = {}) {
  const defaults = getDefaultSnapshot();
  const normalizedRecords = normalizeRecords(snapshot.records);

  return {
    records: Object.keys(normalizedRecords).length > 0 ? normalizedRecords : defaults.records,
    terms: Array.isArray(snapshot.terms)
      ? snapshot.terms.filter((term) => typeof term === 'string' && term.trim())
      : defaults.terms,
    termsUpdatedAt: normalizeMetadataTimestamp(snapshot.termsUpdatedAt),
    goal: typeof snapshot.goal === 'string' ? snapshot.goal : defaults.goal,
    goalUpdatedAt: normalizeMetadataTimestamp(snapshot.goalUpdatedAt),
    monthlyGoals: normalizeMonthlyGoals(snapshot.monthlyGoals),
    courseTags: normalizeCourseTags(snapshot.courseTags),
    courseTagsUpdatedAt: normalizeMetadataTimestamp(snapshot.courseTagsUpdatedAt)
  };
}

function mergeSnapshots(localSnapshot = {}, cloudSnapshot = {}) {
  const normalizedLocalSnapshot = normalizeSnapshot(localSnapshot);
  const normalizedCloudSnapshot = normalizeSnapshot(cloudSnapshot);
  const mergedTerms = pickMergedProfileValue({
    localValue: normalizedLocalSnapshot.terms,
    cloudValue: normalizedCloudSnapshot.terms,
    localUpdatedAt: normalizedLocalSnapshot.termsUpdatedAt,
    cloudUpdatedAt: normalizedCloudSnapshot.termsUpdatedAt,
    fallbackMerge: mergeStringArrays
  });
  const mergedCourseTags = pickMergedProfileValue({
    localValue: normalizedLocalSnapshot.courseTags,
    cloudValue: normalizedCloudSnapshot.courseTags,
    localUpdatedAt: normalizedLocalSnapshot.courseTagsUpdatedAt,
    cloudUpdatedAt: normalizedCloudSnapshot.courseTagsUpdatedAt,
    fallbackMerge: mergeCourseTags
  });
  const mergedGoal = pickMergedProfileValue({
    localValue: normalizedLocalSnapshot.goal,
    cloudValue: normalizedCloudSnapshot.goal,
    localUpdatedAt: normalizedLocalSnapshot.goalUpdatedAt,
    cloudUpdatedAt: normalizedCloudSnapshot.goalUpdatedAt,
    fallbackMerge: (localValue, cloudValue) => localValue || cloudValue || ''
  });

  return {
    records: mergeRecords(normalizedLocalSnapshot.records, normalizedCloudSnapshot.records),
    terms: mergedTerms.value,
    termsUpdatedAt: mergedTerms.updatedAt,
    goal: mergedGoal.value,
    goalUpdatedAt: mergedGoal.updatedAt,
    monthlyGoals: mergeMonthlyGoals(
      normalizedLocalSnapshot.monthlyGoals,
      normalizedCloudSnapshot.monthlyGoals
    ),
    courseTags: mergedCourseTags.value,
    courseTagsUpdatedAt: mergedCourseTags.updatedAt
  };
}

function readLocalSnapshot(wxApi = wx) {
  return normalizeSnapshot({
    records: wxApi.getStorageSync(STORAGE_KEYS.records),
    terms: wxApi.getStorageSync(STORAGE_KEYS.terms),
    termsUpdatedAt: wxApi.getStorageSync(STORAGE_KEYS.termsUpdatedAt),
    goal: wxApi.getStorageSync(STORAGE_KEYS.goal),
    goalUpdatedAt: wxApi.getStorageSync(STORAGE_KEYS.goalUpdatedAt),
    monthlyGoals: wxApi.getStorageSync(STORAGE_KEYS.monthlyGoals),
    courseTags: wxApi.getStorageSync(STORAGE_KEYS.courseTags),
    courseTagsUpdatedAt: wxApi.getStorageSync(STORAGE_KEYS.courseTagsUpdatedAt)
  });
}

function writeLocalSnapshot(snapshot, wxApi = wx) {
  const normalized = normalizeSnapshot(snapshot);
  wxApi.setStorageSync(STORAGE_KEYS.records, normalized.records);
  wxApi.setStorageSync(STORAGE_KEYS.terms, normalized.terms);
  wxApi.setStorageSync(STORAGE_KEYS.termsUpdatedAt, normalized.termsUpdatedAt);
  wxApi.setStorageSync(STORAGE_KEYS.goal, normalized.goal);
  wxApi.setStorageSync(STORAGE_KEYS.goalUpdatedAt, normalized.goalUpdatedAt);
  wxApi.setStorageSync(STORAGE_KEYS.monthlyGoals, normalized.monthlyGoals);
  wxApi.setStorageSync(STORAGE_KEYS.courseTags, normalized.courseTags);
  wxApi.setStorageSync(STORAGE_KEYS.courseTagsUpdatedAt, normalized.courseTagsUpdatedAt);
  return normalized;
}

function hasLocalRecords(wxApi = wx) {
  const snapshot = readLocalSnapshot(wxApi);
  return Object.keys(snapshot.records).length > 0;
}

function isDeviceInitialized(wxApi = wx) {
  if (wxApi.getStorageSync(STORAGE_KEYS.deviceInitialized) === true) {
    return true;
  }

  // v1.0.8 之前没有 deviceInitialized 标记。旧设备即使已经删光记录，
  // 仍会保留一个空的 balletMoodData 存储键；用它区分旧设备与真正的新设备，
  // 避免升级后把云端尚未删净的旧记录重新恢复回来。
  if (typeof wxApi.getStorageInfoSync === 'function') {
    const storageInfo = wxApi.getStorageInfoSync();
    return !!(
      storageInfo &&
      Array.isArray(storageInfo.keys) &&
      storageInfo.keys.includes(STORAGE_KEYS.records)
    );
  }

  return false;
}

function markDeviceInitialized(wxApi = wx) {
  wxApi.setStorageSync(STORAGE_KEYS.deviceInitialized, true);
}

function getPendingRecordDeletions(wxApi = wx) {
  const stored = wxApi.getStorageSync(STORAGE_KEYS.pendingRecordDeletions);
  if (!Array.isArray(stored)) {
    return [];
  }

  return stored
    .map(normalizeRecordDateKey)
    .filter((dateKey, index, all) => dateKey && all.indexOf(dateKey) === index);
}

function queueRecordDeletion(dateKey, wxApi = wx) {
  const normalizedDateKey = normalizeRecordDateKey(dateKey);
  if (!normalizedDateKey) {
    return getPendingRecordDeletions(wxApi);
  }

  const pending = getPendingRecordDeletions(wxApi);
  if (!pending.includes(normalizedDateKey)) {
    pending.push(normalizedDateKey);
    wxApi.setStorageSync(STORAGE_KEYS.pendingRecordDeletions, pending);
  }

  return pending;
}

function clearPendingRecordDeletion(dateKey, wxApi = wx) {
  const normalizedDateKey = normalizeRecordDateKey(dateKey);
  const pending = getPendingRecordDeletions(wxApi)
    .filter((item) => item !== normalizedDateKey);
  wxApi.setStorageSync(STORAGE_KEYS.pendingRecordDeletions, pending);
  return pending;
}

function getPendingPhotoDeletions(wxApi = wx) {
  const stored = wxApi.getStorageSync(STORAGE_KEYS.pendingPhotoDeletions);
  if (!Array.isArray(stored)) {
    return [];
  }

  return stored
    .filter(isCloudFileId)
    .filter((fileId, index, all) => all.indexOf(fileId) === index);
}

function queuePhotoDeletions(fileIds, wxApi = wx) {
  const pending = getPendingPhotoDeletions(wxApi);
  const nextPending = [
    ...pending,
    ...(Array.isArray(fileIds) ? fileIds : [fileIds]).filter(isCloudFileId)
  ].filter((fileId, index, all) => all.indexOf(fileId) === index);

  wxApi.setStorageSync(STORAGE_KEYS.pendingPhotoDeletions, nextPending);
  return nextPending;
}

async function flushPendingPhotoDeletions(wxApi = wx) {
  const pending = getPendingPhotoDeletions(wxApi);
  if (pending.length === 0) {
    return { completed: [], remaining: [] };
  }

  if (!wxApi || !wxApi.cloud || typeof wxApi.cloud.deleteFile !== 'function') {
    throw new Error('云存储删除接口不可用');
  }

  const completed = [];
  let remaining = [...pending];

  while (remaining.length > 0) {
    const batch = remaining.slice(0, 50);
    const result = await wxApi.cloud.deleteFile({ fileList: batch });
    const resultItems = Array.isArray(result && result.fileList) ? result.fileList : [];
    const successful = new Set(
      resultItems
        .filter((item) => item && item.status === 0)
        .map((item) => item.fileID)
        .filter(isCloudFileId)
    );
    const failedBatch = batch.filter((fileId) => !successful.has(fileId));

    completed.push(...batch.filter((fileId) => successful.has(fileId)));
    remaining = [...failedBatch, ...remaining.slice(batch.length)];
    wxApi.setStorageSync(STORAGE_KEYS.pendingPhotoDeletions, remaining);

    if (failedBatch.length > 0) {
      const error = new Error('部分云端照片删除失败');
      error.failedFileIds = failedBatch;
      throw error;
    }
  }

  return { completed, remaining };
}

function hasNonEmptyRecords(doc) {
  return !!(doc && doc.records && Object.keys(normalizeRecords(doc.records)).length > 0);
}

function pickBestCloudDoc(docs = []) {
  if (!Array.isArray(docs) || docs.length === 0) {
    return null;
  }

  const normalizedDocs = docs.filter(Boolean);
  const nonEmptyDocs = normalizedDocs.filter(hasNonEmptyRecords);
  const candidates = nonEmptyDocs.length > 0 ? nonEmptyDocs : normalizedDocs;

  return candidates.reduce((bestDoc, currentDoc) => {
    if (!bestDoc) {
      return currentDoc;
    }

    const bestUpdatedAt = toTimestamp(bestDoc.updatedAt);
    const currentUpdatedAt = toTimestamp(currentDoc.updatedAt);

    if (Number.isNaN(bestUpdatedAt) && Number.isNaN(currentUpdatedAt)) {
      return currentDoc;
    }

    if (Number.isNaN(bestUpdatedAt)) {
      return currentDoc;
    }

    if (Number.isNaN(currentUpdatedAt)) {
      return bestDoc;
    }

    return currentUpdatedAt >= bestUpdatedAt ? currentDoc : bestDoc;
  }, null);
}

async function getCurrentUserDoc(wxApi = wx) {
  const collection = getLegacyCollection(wxApi);
  const result = await collection.where({
    _openid: '{openid}'
  }).get();

  const sameUserDoc = pickBestCloudDoc(result.data);
  if (sameUserDoc) {
    return sameUserDoc;
  }
  return null;
}

function buildProfilePayload(snapshot) {
  const normalized = normalizeSnapshot(snapshot);
  return {
    terms: normalized.terms,
    termsUpdatedAt: normalized.termsUpdatedAt ? new Date(normalized.termsUpdatedAt) : null,
    goal: normalized.goal,
    goalUpdatedAt: normalized.goalUpdatedAt ? new Date(normalized.goalUpdatedAt) : null,
    monthlyGoals: normalized.monthlyGoals,
    courseTags: normalized.courseTags,
    courseTagsUpdatedAt: normalized.courseTagsUpdatedAt ? new Date(normalized.courseTagsUpdatedAt) : null,
    updatedAt: new Date(),
    schemaVersion: 3
  };
}

function buildRecordPayload(dateKey, record) {
  return {
    dateKey,
    note: record.note || '',
    photo: record.photo || '',
    terms: Array.isArray(record.terms) ? record.terms : [],
    bodyParts: Array.isArray(record.bodyParts) ? record.bodyParts : [],
    courses: Array.isArray(record.courses) ? record.courses : [],
    isDeleted: !!record.isDeleted,
    deletedAt: record.isDeleted
      ? (record.deletedAt ? new Date(record.deletedAt) : new Date())
      : null,
    updatedAt: record.updatedAt ? new Date(record.updatedAt) : new Date(),
    schemaVersion: 2
  };
}

async function getCurrentUserProfileDoc(wxApi = wx) {
  const collection = getProfileCollection(wxApi);
  const result = await collection.where({
    _openid: '{openid}'
  }).get();

  return pickBestCloudDoc((result.data || []).map((doc) => ({
    ...doc,
    records: { meta: true }
  })));
}

async function listCurrentUserRecordDocs(wxApi = wx) {
  const collection = getRecordCollection(wxApi);
  const pageSize = 20;
  const allDocs = [];
  let offset = 0;

  while (true) {
    const result = await collection
      .where({ _openid: '{openid}' })
      .skip(offset)
      .limit(pageSize)
      .get();

    const docs = Array.isArray(result.data) ? result.data : [];
    allDocs.push(...docs);

    if (docs.length < pageSize) break;
    offset += pageSize;
  }

  return allDocs;
}

function toRecordShape(doc = {}) {
  const record = {
    note: doc.note || '',
    photo: doc.photo || '',
    terms: Array.isArray(doc.terms) ? doc.terms : [],
    bodyParts: Array.isArray(doc.bodyParts) ? doc.bodyParts : [],
    courses: Array.isArray(doc.courses) ? doc.courses : [],
    updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : doc.updatedAt
  };

  if (doc.isDeleted) {
    record.isDeleted = true;
    record.deletedAt = doc.deletedAt instanceof Date ? doc.deletedAt.toISOString() : doc.deletedAt;
  }

  return record;
}

function isDeletedRecord(record) {
  return !!(record && record.isDeleted);
}

function stripDeletedRecords(records) {
  const normalizedRecords = normalizeRecords(records);

  return Object.keys(normalizedRecords).reduce((acc, dateKey) => {
    if (!isDeletedRecord(normalizedRecords[dateKey])) {
      acc[dateKey] = normalizedRecords[dateKey];
    }

    return acc;
  }, {});
}

function stripDeletedSnapshot(snapshot = {}) {
  const normalizedSnapshot = normalizeSnapshot(snapshot);

  return {
    ...normalizedSnapshot,
    records: stripDeletedRecords(normalizedSnapshot.records)
  };
}

function pickPreferredRecordDoc(currentDoc, nextDoc) {
  if (!currentDoc) {
    return nextDoc;
  }

  const preferredRecord = pickNewerRecord(toRecordShape(currentDoc), toRecordShape(nextDoc));
  const currentRecord = toRecordShape(currentDoc);

  if (
    preferredRecord &&
    preferredRecord.updatedAt === currentRecord.updatedAt &&
    preferredRecord.note === currentRecord.note &&
    preferredRecord.photo === currentRecord.photo
  ) {
    return currentDoc;
  }

  return nextDoc;
}

async function fetchStructuredCloudSnapshot(wxApi = wx) {
  const [profileDoc, recordDocs] = await Promise.all([
    getCurrentUserProfileDoc(wxApi),
    listCurrentUserRecordDocs(wxApi)
  ]);

  if ((!profileDoc || !profileDoc._id) && recordDocs.length === 0) {
    return null;
  }

  const records = recordDocs.reduce((acc, doc) => {
    const dateKey = normalizeRecordDateKey(doc.dateKey);
    if (!dateKey) {
      return acc;
    }

    acc[dateKey] = acc[dateKey]
      ? pickNewerRecord(acc[dateKey], toRecordShape(doc))
      : toRecordShape(doc);
    return acc;
  }, {});

  return normalizeSnapshot({
    records,
    terms: profileDoc && profileDoc.terms,
    termsUpdatedAt: profileDoc && profileDoc.termsUpdatedAt,
    goal: profileDoc && profileDoc.goal,
    goalUpdatedAt: profileDoc && profileDoc.goalUpdatedAt,
    monthlyGoals: profileDoc && profileDoc.monthlyGoals,
    courseTags: profileDoc && profileDoc.courseTags,
    courseTagsUpdatedAt: profileDoc && profileDoc.courseTagsUpdatedAt
  });
}

async function saveProfileSnapshot(snapshot, wxApi = wx) {
  const collection = getProfileCollection(wxApi);
  const existingDoc = await getCurrentUserProfileDoc(wxApi);
  const payload = buildProfilePayload(snapshot);

  if (existingDoc && existingDoc._id) {
    await collection.doc(existingDoc._id).update({
      data: payload
    });
    return { type: 'update', docId: existingDoc._id };
  }

  const addResult = await collection.add({
    data: payload
  });
  return { type: 'add', docId: addResult._id };
}

async function saveRecordSnapshot(snapshot, wxApi = wx, options = {}) {
  const collection = getRecordCollection(wxApi);
  const existingDocs = await listCurrentUserRecordDocs(wxApi);
  const existingByDate = existingDocs.reduce((acc, doc) => {
    const dateKey = normalizeRecordDateKey(doc.dateKey);
    if (dateKey) {
      acc[dateKey] = pickPreferredRecordDoc(acc[dateKey], doc);
    }
    return acc;
  }, {});

  const normalizedSnapshot = normalizeSnapshot(snapshot);
  const entries = Object.entries(normalizedSnapshot.records);
  const nextDateKeys = new Set(entries.map(([dateKey]) => dateKey));
  const deletedRecordDates = new Set(
    Array.isArray(options.deletedRecordDates)
      ? options.deletedRecordDates.map((dateKey) => normalizeRecordDateKey(dateKey)).filter(Boolean)
      : []
  );

  for (const [dateKey, record] of entries) {
    const payload = buildRecordPayload(dateKey, record);
    const existingDoc = existingByDate[dateKey];

    if (existingDoc && existingDoc._id) {
      try {
        await collection.doc(existingDoc._id).update({
          data: payload
        });
      } catch (error) {
        if (!(error && error.errCode === -401002)) {
          throw error;
        }

        await collection.add({
          data: payload
        });
      }
    } else {
      await collection.add({
        data: payload
      });
    }
  }

  for (const dateKey of deletedRecordDates) {
    const existingDoc = existingByDate[dateKey];

    if (existingDoc && existingDoc._id) {
      await collection.doc(existingDoc._id).remove();
    }
  }

  if (options.replaceRecords === true) {
    const staleDocs = existingDocs.filter((doc) => {
      const dateKey = normalizeRecordDateKey(doc.dateKey);
      return dateKey && !nextDateKeys.has(dateKey) && !deletedRecordDates.has(dateKey);
    });

    for (const doc of staleDocs) {
      if (!doc || !doc._id) {
        continue;
      }

      await collection.doc(doc._id).remove();
    }
  }
}

async function saveSingleRecordToCloud(dateKey, record, wxApi = wx) {
  const normalizedDateKey = normalizeRecordDateKey(dateKey);
  if (!normalizedDateKey || !record) {
    return null;
  }

  let finalRecord = record;
  if (record.photo && !isCloudFileId(record.photo)) {
    const uploadedPhoto = await uploadPhotoIfNeeded(normalizedDateKey, record.photo, wxApi);
    finalRecord = { ...record, photo: uploadedPhoto };
  }

  const collection = getRecordCollection(wxApi);
  const existingResult = await collection
    .where({
      _openid: '{openid}',
      dateKey: normalizedDateKey
    })
    .get();

  const existingDocs = Array.isArray(existingResult.data) ? existingResult.data : [];
  const payload = buildRecordPayload(normalizedDateKey, finalRecord);
  const obsoletePhotoIds = existingDocs
    .map((doc) => doc && doc.photo)
    .filter((fileId) => isCloudFileId(fileId) && fileId !== finalRecord.photo)
    .filter((fileId, index, all) => all.indexOf(fileId) === index);

  const cleanupObsoletePhotos = async () => {
    if (obsoletePhotoIds.length === 0) {
      return false;
    }
    queuePhotoDeletions(obsoletePhotoIds, wxApi);
    try {
      await flushPendingPhotoDeletions(wxApi);
      return false;
    } catch (error) {
      return true;
    }
  };

  if (existingDocs.length > 0) {
    const keepDoc = existingDocs[0];
    try {
      await collection.doc(keepDoc._id).update({ data: payload });
    } catch (error) {
      if (!(error && error.errCode === -401002)) {
        throw error;
      }
      const addResult = await collection.add({ data: payload });
      for (const existingDoc of existingDocs) {
        if (existingDoc && existingDoc._id) {
          await collection.doc(existingDoc._id).remove();
        }
      }
      const photoCleanupPending = await cleanupObsoletePhotos();
      return { type: 'add', docId: addResult._id, record: finalRecord, photoCleanupPending };
    }

    for (let i = 1; i < existingDocs.length; i++) {
      if (existingDocs[i] && existingDocs[i]._id) {
        await collection.doc(existingDocs[i]._id).remove();
      }
    }

    const photoCleanupPending = await cleanupObsoletePhotos();
    return {
      type: 'update',
      docId: keepDoc._id,
      record: finalRecord,
      duplicatesRemoved: existingDocs.length - 1,
      photoCleanupPending
    };
  }

  const addResult = await collection.add({ data: payload });
  return { type: 'add', docId: addResult._id, record: finalRecord };
}

async function deleteSingleRecordInCloud(dateKey, wxApi = wx, options = {}) {
  const normalizedDateKey = normalizeRecordDateKey(dateKey);
  if (!normalizedDateKey) {
    return null;
  }

  queuePhotoDeletions(options.photoFileIds || [], wxApi);

  const collection = getRecordCollection(wxApi);
  const pageSize = 20;
  const allDocs = [];
  let offset = 0;

  while (true) {
    const result = await collection
      .where({
        _openid: '{openid}',
        dateKey: normalizedDateKey
      })
      .skip(offset)
      .limit(pageSize)
      .get();

    const docs = Array.isArray(result.data) ? result.data : [];
    allDocs.push(...docs);

    if (docs.length < pageSize) break;
    offset += pageSize;
  }

  queuePhotoDeletions(allDocs.map((doc) => doc && doc.photo), wxApi);

  let removed = 0;
  for (const doc of allDocs) {
    if (!doc || !doc._id) continue;
    await collection.doc(doc._id).remove();
    removed++;
  }

  await flushPendingPhotoDeletions(wxApi);

  if (allDocs.length === 0) {
    return { type: 'none', count: 0 };
  }

  return { type: 'remove', count: removed };
}

async function flushPendingRecordDeletions(wxApi = wx) {
  const pending = getPendingRecordDeletions(wxApi);
  const completed = [];

  for (const dateKey of pending) {
    await deleteSingleRecordInCloud(dateKey, wxApi);
    clearPendingRecordDeletion(dateKey, wxApi);
    completed.push(dateKey);
  }

  await flushPendingPhotoDeletions(wxApi);

  return { completed, remaining: getPendingRecordDeletions(wxApi) };
}

async function migrateLegacySnapshotToStructuredCloud(wxApi = wx) {
  const legacyDoc = await getCurrentUserDoc(wxApi);
  if (!legacyDoc) {
    return null;
  }

  const snapshot = normalizeSnapshot({
    records: legacyDoc.records,
    terms: legacyDoc.terms,
    goal: legacyDoc.goal,
    goalUpdatedAt: legacyDoc.goalUpdatedAt,
    monthlyGoals: legacyDoc.monthlyGoals,
    courseTags: legacyDoc.courseTags
  });
  const hydratedSnapshot = await hydrateSnapshotPhotos(snapshot, wxApi);
  await saveProfileSnapshot(hydratedSnapshot, wxApi);
  await saveRecordSnapshot(hydratedSnapshot, wxApi);
  return hydratedSnapshot;
}

async function pushSnapshotToCloud(snapshot, wxApi = wx, options = {}) {
  const localSnapshot = readLocalSnapshot(wxApi);
  const structuredCloudSnapshot = await fetchStructuredCloudSnapshot(wxApi);
  const legacyDoc = structuredCloudSnapshot ? null : await getCurrentUserDoc(wxApi);
  const legacySnapshot = legacyDoc ? normalizeSnapshot({
    records: legacyDoc.records,
    terms: legacyDoc.terms,
    goal: legacyDoc.goal,
    goalUpdatedAt: legacyDoc.goalUpdatedAt,
    monthlyGoals: legacyDoc.monthlyGoals,
    courseTags: legacyDoc.courseTags
  }) : {};
  const baseSnapshot = mergeSnapshots(localSnapshot, snapshot);

  const mergedSnapshot = mergeSnapshots(baseSnapshot, structuredCloudSnapshot || legacySnapshot);
  const nextSnapshot = options.replaceRecords === true
    ? {
        ...mergedSnapshot,
        records: normalizeRecords(baseSnapshot.records)
      }
    : mergedSnapshot;
  const hydratedSnapshot = await hydrateSnapshotPhotos(nextSnapshot, wxApi);

  await saveProfileSnapshot(hydratedSnapshot, wxApi);
  await saveRecordSnapshot(hydratedSnapshot, wxApi, options);
  const visibleSnapshot = stripDeletedSnapshot(hydratedSnapshot);
  writeLocalSnapshot(visibleSnapshot, wxApi);

  return {
    type: 'structured-sync',
    snapshot: visibleSnapshot
  };
}

async function backupSnapshotToCloud(snapshot, wxApi = wx, options = {}) {
  const localSnapshot = normalizeSnapshot(snapshot);
  const hydratedSnapshot = await hydrateSnapshotPhotos(localSnapshot, wxApi);
  const replaceRecords = options.replaceRecords !== false;

  await saveProfileSnapshot(hydratedSnapshot, wxApi);
  await saveRecordSnapshot(hydratedSnapshot, wxApi, { replaceRecords });

  // 云端上传可能把本地照片路径换成 cloud:// fileID，但备份期间用户仍可能
  // 新建、编辑或删除记录。只回写“从备份开始后完全未变化”的照片字段，绝不
  // 用启动时旧快照覆盖当前本地记录或资料。
  const currentSnapshot = readLocalSnapshot(wxApi);
  const nextRecords = { ...currentSnapshot.records };
  Object.keys(localSnapshot.records).forEach((dateKey) => {
    const sourceRecord = localSnapshot.records[dateKey];
    const hydratedRecord = hydratedSnapshot.records[dateKey];
    const currentRecord = currentSnapshot.records[dateKey];
    if (!sourceRecord || !hydratedRecord || !currentRecord) return;

    const recordIsUnchanged = currentRecord.updatedAt === sourceRecord.updatedAt &&
      currentRecord.photo === sourceRecord.photo;
    if (recordIsUnchanged && hydratedRecord.photo !== sourceRecord.photo) {
      nextRecords[dateKey] = { ...currentRecord, photo: hydratedRecord.photo };
    }
  });
  wxApi.setStorageSync(STORAGE_KEYS.records, nextRecords);
  const safeLocalSnapshot = { ...currentSnapshot, records: nextRecords };

  return {
    type: 'local-authoritative-backup',
    snapshot: safeLocalSnapshot
  };
}

async function backupLocalToCloudIfNeeded(wxApi = wx) {
  if (!hasLocalRecords(wxApi)) {
    return {
      skipped: true,
      reason: 'local-empty'
    };
  }

  const structuredCloudSnapshot = await fetchStructuredCloudSnapshot(wxApi);
  if (structuredCloudSnapshot) {
    return {
      skipped: true,
      reason: 'cloud-exists',
      snapshot: structuredCloudSnapshot
    };
  }

  const legacyDoc = await getCurrentUserDoc(wxApi);
  if (legacyDoc) {
    return {
      skipped: true,
      reason: 'cloud-exists',
      doc: legacyDoc
    };
  }

  const currentSnapshot = readLocalSnapshot(wxApi);
  const result = await pushSnapshotToCloud(currentSnapshot, wxApi);

  return {
    skipped: false,
    snapshot: result.snapshot,
    ...result
  };
}

async function migrateLocalSnapshotToCloud(wxApi = wx, options = {}) {
  const localSnapshot = readLocalSnapshot(wxApi);
  const result = await backupSnapshotToCloud(localSnapshot, wxApi, options);

  return {
    migrated: true,
    reason: 'local-backup-complete',
    snapshot: result.snapshot,
    ...result
  };
}

async function restoreFromCloudIfLocalEmpty(wxApi = wx) {
  if (hasLocalRecords(wxApi)) {
    return {
      restored: false,
      reason: 'local-exists',
      snapshot: readLocalSnapshot(wxApi)
    };
  }

  let snapshot = await fetchStructuredCloudSnapshot(wxApi);
  if (!snapshot) {
    snapshot = await migrateLegacySnapshotToStructuredCloud(wxApi);
  }

  const visibleSnapshot = snapshot ? stripDeletedSnapshot(snapshot) : null;

  if (!visibleSnapshot) {
    return {
      restored: false,
      reason: 'cloud-empty',
      snapshot: readLocalSnapshot(wxApi)
    };
  }

  writeLocalSnapshot(visibleSnapshot, wxApi);

  return {
    restored: true,
    reason: Object.keys(visibleSnapshot.records || {}).length > 0
      ? 'cloud-restored'
      : 'cloud-profile-restored',
    snapshot: visibleSnapshot
  };
}

async function fetchLatestCloudSnapshot(wxApi = wx) {
  let snapshot = await fetchStructuredCloudSnapshot(wxApi);
  if (!snapshot) {
    snapshot = await migrateLegacySnapshotToStructuredCloud(wxApi);
  }

  // 返回带 isDeleted 的完整 snapshot，让调用方在 freshness 比较时
  // 能看到删除事件的时间戳；调用方负责在展示前调用 stripDeletedSnapshot
  return snapshot ? normalizeSnapshot(snapshot) : null;
}

module.exports = {
  COLLECTION_NAME,
  PROFILE_COLLECTION_NAME,
  RECORDS_COLLECTION_NAME,
  STORAGE_KEYS,
  getDefaultSnapshot,
  normalizeSnapshot,
  normalizeRecordDateKey,
  normalizeRecords,
  mergeRecords,
  mergeSnapshots,
  isCloudFileId,
  uploadPhotoIfNeeded,
  hydrateSnapshotPhotos,
  readLocalSnapshot,
  writeLocalSnapshot,
  hasLocalRecords,
  isDeviceInitialized,
  markDeviceInitialized,
  getPendingRecordDeletions,
  queueRecordDeletion,
  clearPendingRecordDeletion,
  getPendingPhotoDeletions,
  queuePhotoDeletions,
  flushPendingPhotoDeletions,
  flushPendingRecordDeletions,
  getCurrentUserDoc,
  pushSnapshotToCloud,
  backupSnapshotToCloud,
  saveSingleRecordToCloud,
  deleteSingleRecordInCloud,
  backupLocalToCloudIfNeeded,
  migrateLocalSnapshotToCloud,
  restoreFromCloudIfLocalEmpty,
  fetchLatestCloudSnapshot,
  fetchStructuredCloudSnapshot,
  migrateLegacySnapshotToStructuredCloud,
  stripDeletedSnapshot
};
