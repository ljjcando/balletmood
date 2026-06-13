const { normalizeCourseTags } = require('../pages/index/course-tags-helper');

const COLLECTION_NAME = 'ballet_mood_users';
const PROFILE_COLLECTION_NAME = 'ballet_mood_profiles';
const RECORDS_COLLECTION_NAME = 'ballet_mood_records';

const STORAGE_KEYS = {
  records: 'balletMoodData',
  terms: 'balletMoodTerms',
  termsUpdatedAt: 'balletMoodTermsUpdatedAt',
  goal: 'balletMoodGoal',
  courseTags: 'balletMoodCourseTags',
  courseTagsUpdatedAt: 'balletMoodCourseTagsUpdatedAt'
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
    courseTags: normalizeCourseTags(DEFAULT_COURSE_TAGS),
    courseTagsUpdatedAt: ''
  };
}

function normalizeSnapshot(snapshot = {}) {
  const defaults = getDefaultSnapshot();
  const normalizedRecords = normalizeRecords(snapshot.records);

  return {
    records: Object.keys(normalizedRecords).length > 0 ? normalizedRecords : defaults.records,
    terms: Array.isArray(snapshot.terms) && snapshot.terms.length > 0 ? snapshot.terms : defaults.terms,
    termsUpdatedAt: normalizeMetadataTimestamp(snapshot.termsUpdatedAt),
    goal: typeof snapshot.goal === 'string' ? snapshot.goal : defaults.goal,
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

  return {
    records: mergeRecords(normalizedLocalSnapshot.records, normalizedCloudSnapshot.records),
    terms: mergedTerms.value,
    termsUpdatedAt: mergedTerms.updatedAt,
    goal: normalizedLocalSnapshot.goal || normalizedCloudSnapshot.goal || '',
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
  wxApi.setStorageSync(STORAGE_KEYS.courseTags, normalized.courseTags);
  wxApi.setStorageSync(STORAGE_KEYS.courseTagsUpdatedAt, normalized.courseTagsUpdatedAt);
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
  const collection = getLegacyCollection(wxApi);
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

function buildProfilePayload(snapshot) {
  const normalized = normalizeSnapshot(snapshot);
  return {
    terms: normalized.terms,
    termsUpdatedAt: normalized.termsUpdatedAt ? new Date(normalized.termsUpdatedAt) : null,
    goal: normalized.goal,
    courseTags: normalized.courseTags,
    courseTagsUpdatedAt: normalized.courseTagsUpdatedAt ? new Date(normalized.courseTagsUpdatedAt) : null,
    updatedAt: new Date(),
    schemaVersion: 2
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
    const deletedTimestamp = new Date().toISOString();
    const payload = buildRecordPayload(dateKey, {
      note: '',
      photo: '',
      terms: [],
      bodyParts: [],
      courses: [],
      isDeleted: true,
      deletedAt: deletedTimestamp,
      updatedAt: deletedTimestamp
    });
    const existingDoc = existingByDate[dateKey];

    if (existingDoc && existingDoc._id) {
      await collection.doc(existingDoc._id).update({
        data: payload
      });
    } else {
      await collection.add({
        data: payload
      });
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

async function migrateLegacySnapshotToStructuredCloud(wxApi = wx) {
  const legacyDoc = await getCurrentUserDoc(wxApi);
  if (!legacyDoc || !legacyDoc.records || Object.keys(legacyDoc.records).length === 0) {
    return null;
  }

  const snapshot = normalizeSnapshot({
    records: legacyDoc.records,
    terms: legacyDoc.terms,
    goal: legacyDoc.goal,
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

  if (!visibleSnapshot || !visibleSnapshot.records || Object.keys(visibleSnapshot.records).length === 0) {
    return {
      restored: false,
      reason: 'cloud-empty',
      snapshot: readLocalSnapshot(wxApi)
    };
  }

  writeLocalSnapshot(visibleSnapshot, wxApi);

  return {
    restored: true,
    reason: 'cloud-restored',
    snapshot: visibleSnapshot
  };
}

async function fetchLatestCloudSnapshot(wxApi = wx) {
  let snapshot = await fetchStructuredCloudSnapshot(wxApi);
  if (!snapshot) {
    snapshot = await migrateLegacySnapshotToStructuredCloud(wxApi);
  }

  const visibleSnapshot = snapshot ? stripDeletedSnapshot(snapshot) : null;

  return visibleSnapshot && visibleSnapshot.records && Object.keys(visibleSnapshot.records).length > 0
    ? normalizeSnapshot(visibleSnapshot)
    : null;
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
  getCurrentUserDoc,
  pushSnapshotToCloud,
  backupLocalToCloudIfNeeded,
  migrateLocalSnapshotToCloud,
  restoreFromCloudIfLocalEmpty,
  fetchLatestCloudSnapshot,
  fetchStructuredCloudSnapshot,
  migrateLegacySnapshotToStructuredCloud
};
