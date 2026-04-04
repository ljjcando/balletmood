const { normalizeCourseTags } = require('../pages/index/course-tags-helper');

const COLLECTION_NAME = 'ballet_mood_users';

const STORAGE_KEYS = {
  records: 'balletMoodData',
  terms: 'balletMoodTerms',
  goal: 'balletMoodGoal',
  courseTags: 'balletMoodCourseTags'
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

  if (Number.isNaN(localTimestamp) && Number.isNaN(cloudTimestamp)) {
    return { ...cloudRecord, ...localRecord };
  }

  if (Number.isNaN(localTimestamp)) {
    return cloudRecord;
  }

  if (Number.isNaN(cloudTimestamp)) {
    return localRecord;
  }

  return localTimestamp >= cloudTimestamp ? localRecord : cloudRecord;
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

function getCollection(wxApi = wx) {
  return getDb(wxApi).collection(COLLECTION_NAME);
}

function getDefaultSnapshot() {
  return {
    records: {},
    terms: [...DEFAULT_TERMS],
    goal: '',
    courseTags: normalizeCourseTags(DEFAULT_COURSE_TAGS)
  };
}

function normalizeSnapshot(snapshot = {}) {
  const defaults = getDefaultSnapshot();
  const normalizedRecords = normalizeRecords(snapshot.records);

  return {
    records: Object.keys(normalizedRecords).length > 0 ? normalizedRecords : defaults.records,
    terms: Array.isArray(snapshot.terms) && snapshot.terms.length > 0 ? snapshot.terms : defaults.terms,
    goal: typeof snapshot.goal === 'string' ? snapshot.goal : defaults.goal,
    courseTags: normalizeCourseTags(snapshot.courseTags)
  };
}

function mergeSnapshots(localSnapshot = {}, cloudSnapshot = {}) {
  const normalizedLocalSnapshot = normalizeSnapshot(localSnapshot);
  const normalizedCloudSnapshot = normalizeSnapshot(cloudSnapshot);

  return {
    records: mergeRecords(normalizedLocalSnapshot.records, normalizedCloudSnapshot.records),
    terms: mergeStringArrays(normalizedLocalSnapshot.terms, normalizedCloudSnapshot.terms),
    goal: normalizedLocalSnapshot.goal || normalizedCloudSnapshot.goal || '',
    courseTags: mergeCourseTags(normalizedLocalSnapshot.courseTags, normalizedCloudSnapshot.courseTags)
  };
}

function readLocalSnapshot(wxApi = wx) {
  return normalizeSnapshot({
    records: wxApi.getStorageSync(STORAGE_KEYS.records),
    terms: wxApi.getStorageSync(STORAGE_KEYS.terms),
    goal: wxApi.getStorageSync(STORAGE_KEYS.goal),
    courseTags: wxApi.getStorageSync(STORAGE_KEYS.courseTags)
  });
}

function writeLocalSnapshot(snapshot, wxApi = wx) {
  const normalized = normalizeSnapshot(snapshot);
  wxApi.setStorageSync(STORAGE_KEYS.records, normalized.records);
  wxApi.setStorageSync(STORAGE_KEYS.terms, normalized.terms);
  wxApi.setStorageSync(STORAGE_KEYS.goal, normalized.goal);
  wxApi.setStorageSync(STORAGE_KEYS.courseTags, normalized.courseTags);
  return normalized;
}

function hasLocalRecords(wxApi = wx) {
  const snapshot = readLocalSnapshot(wxApi);
  return Object.keys(snapshot.records).length > 0;
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
  const collection = getCollection(wxApi);
  const result = await collection.where({
    _openid: '{openid}'
  }).get();

  const sameUserDoc = pickBestCloudDoc(result.data);
  if (sameUserDoc) {
    return sameUserDoc;
  }

  const fallbackResult = await collection
    .orderBy('updatedAt', 'desc')
    .limit(1)
    .get();

  return pickBestCloudDoc(fallbackResult.data);
}

function toCloudPayload(snapshot) {
  const normalized = normalizeSnapshot(snapshot);

  return {
    records: normalized.records,
    terms: normalized.terms,
    goal: normalized.goal,
    courseTags: normalized.courseTags,
    updatedAt: new Date()
  };
}

async function pushSnapshotToCloud(snapshot, wxApi = wx) {
  const collection = getCollection(wxApi);
  const localSnapshot = readLocalSnapshot(wxApi);
  const existingDoc = await getCurrentUserDoc(wxApi);
  const mergedSnapshot = mergeSnapshots(
    mergeSnapshots(localSnapshot, snapshot),
    existingDoc ? {
      records: existingDoc.records,
      terms: existingDoc.terms,
      goal: existingDoc.goal,
      courseTags: existingDoc.courseTags
    } : {}
  );
  const hydratedSnapshot = await hydrateSnapshotPhotos(mergedSnapshot, wxApi);
  const payload = toCloudPayload(hydratedSnapshot);
  writeLocalSnapshot(hydratedSnapshot, wxApi);

  if (existingDoc && existingDoc._id) {
    await collection.doc(existingDoc._id).update({
      data: payload
    });

    return {
      type: 'update',
      docId: existingDoc._id,
      snapshot: hydratedSnapshot
    };
  }

  const addResult = await collection.add({
    data: payload
  });

  return {
    type: 'add',
    docId: addResult._id,
    snapshot: hydratedSnapshot
  };
}

async function backupLocalToCloudIfNeeded(wxApi = wx) {
  if (!hasLocalRecords(wxApi)) {
    return {
      skipped: true,
      reason: 'local-empty'
    };
  }

  const existingDoc = await getCurrentUserDoc(wxApi);
  if (existingDoc) {
    return {
      skipped: true,
      reason: 'cloud-exists',
      doc: existingDoc
    };
  }

  const snapshot = readLocalSnapshot(wxApi);
  const result = await pushSnapshotToCloud(snapshot, wxApi);

  return {
    skipped: false,
    snapshot,
    ...result
  };
}

async function migrateLocalSnapshotToCloud(wxApi = wx) {
  const localSnapshot = readLocalSnapshot(wxApi);

  if (Object.keys(localSnapshot.records).length === 0) {
    return {
      migrated: false,
      reason: 'local-empty',
      snapshot: localSnapshot
    };
  }

  const result = await pushSnapshotToCloud(localSnapshot, wxApi);

  return {
    migrated: true,
    reason: 'full-sync-complete',
    snapshot: result.snapshot,
    ...result
  };
}

async function restoreFromCloudIfLocalEmpty(wxApi = wx) {
  if (hasLocalRecords(wxApi)) {
    console.log('[cloud-sync] Skip restore: local records already exist');
    return {
      restored: false,
      reason: 'local-exists',
      snapshot: readLocalSnapshot(wxApi)
    };
  }

  const cloudDoc = await getCurrentUserDoc(wxApi);
  if (!cloudDoc || !cloudDoc.records || Object.keys(cloudDoc.records).length === 0) {
    console.log('[cloud-sync] No cloud records found for restore');
    return {
      restored: false,
      reason: 'cloud-empty',
      snapshot: readLocalSnapshot(wxApi)
    };
  }

  const snapshot = normalizeSnapshot({
    records: cloudDoc.records,
    terms: cloudDoc.terms,
    goal: cloudDoc.goal,
    courseTags: cloudDoc.courseTags
  });

  writeLocalSnapshot(snapshot, wxApi);
  console.log('[cloud-sync] Restored records from cloud:', Object.keys(snapshot.records));

  return {
    restored: true,
    reason: 'cloud-restored',
    snapshot
  };
}

async function fetchLatestCloudSnapshot(wxApi = wx) {
  const cloudDoc = await getCurrentUserDoc(wxApi);

  if (!cloudDoc || !cloudDoc.records || Object.keys(cloudDoc.records).length === 0) {
    return null;
  }

  return normalizeSnapshot({
    records: cloudDoc.records,
    terms: cloudDoc.terms,
    goal: cloudDoc.goal,
    courseTags: cloudDoc.courseTags
  });
}

module.exports = {
  COLLECTION_NAME,
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
  getCurrentUserDoc,
  pushSnapshotToCloud,
  backupLocalToCloudIfNeeded,
  migrateLocalSnapshotToCloud,
  restoreFromCloudIfLocalEmpty,
  fetchLatestCloudSnapshot
};
