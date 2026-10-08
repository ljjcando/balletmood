function toGoalMonthKey(year, month) {
  const normalizedYear = Number(year);
  const normalizedMonth = Number(month);
  if (!normalizedYear || normalizedMonth < 1 || normalizedMonth > 12) {
    return '';
  }

  return `${normalizedYear}-${String(normalizedMonth).padStart(2, '0')}`;
}

function normalizeGoalTimestamp(value) {
  if (typeof value === 'string' && value) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  return '';
}

function normalizeMonthlyGoals(monthlyGoals) {
  if (!monthlyGoals || typeof monthlyGoals !== 'object' || Array.isArray(monthlyGoals)) {
    return {};
  }

  return Object.keys(monthlyGoals).reduce((acc, monthKey) => {
    const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
    if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) return acc;

    const value = monthlyGoals[monthKey];
    const text = typeof value === 'string'
      ? value
      : (value && typeof value.text === 'string' ? value.text : '');
    const updatedAt = value && typeof value === 'object'
      ? normalizeGoalTimestamp(value.updatedAt)
      : '';

    if (text || updatedAt) {
      acc[monthKey] = { text, updatedAt };
    }
    return acc;
  }, {});
}

function migrateLegacyGoal(monthlyGoals, legacyGoal, legacyUpdatedAt, year, month) {
  const normalizedGoals = normalizeMonthlyGoals(monthlyGoals);
  const monthKey = toGoalMonthKey(year, month);
  const goalText = typeof legacyGoal === 'string' ? legacyGoal : '';

  if (!monthKey || !goalText || Object.keys(normalizedGoals).length > 0) {
    return normalizedGoals;
  }

  return {
    ...normalizedGoals,
    [monthKey]: {
      text: goalText,
      updatedAt: normalizeGoalTimestamp(legacyUpdatedAt)
    }
  };
}

function getMonthlyGoalEntry(monthlyGoals, year, month) {
  const monthKey = toGoalMonthKey(year, month);
  const normalizedGoals = normalizeMonthlyGoals(monthlyGoals);
  return normalizedGoals[monthKey] || { text: '', updatedAt: '' };
}

function setMonthlyGoalEntry(monthlyGoals, year, month, text, updatedAt) {
  const monthKey = toGoalMonthKey(year, month);
  if (!monthKey) return normalizeMonthlyGoals(monthlyGoals);

  return {
    ...normalizeMonthlyGoals(monthlyGoals),
    [monthKey]: {
      text: typeof text === 'string' ? text : '',
      updatedAt: normalizeGoalTimestamp(updatedAt)
    }
  };
}

function mergeMonthlyGoals(localGoals, cloudGoals) {
  const local = normalizeMonthlyGoals(localGoals);
  const cloud = normalizeMonthlyGoals(cloudGoals);
  const keys = new Set([...Object.keys(cloud), ...Object.keys(local)]);

  return Array.from(keys).reduce((acc, monthKey) => {
    const localEntry = local[monthKey];
    const cloudEntry = cloud[monthKey];
    if (!localEntry) {
      acc[monthKey] = cloudEntry;
      return acc;
    }
    if (!cloudEntry) {
      acc[monthKey] = localEntry;
      return acc;
    }

    const localTimestamp = Date.parse(localEntry.updatedAt);
    const cloudTimestamp = Date.parse(cloudEntry.updatedAt);
    if (Number.isNaN(localTimestamp) && Number.isNaN(cloudTimestamp)) {
      acc[monthKey] = localEntry.text ? localEntry : cloudEntry;
    } else if (Number.isNaN(cloudTimestamp) || (!Number.isNaN(localTimestamp) && localTimestamp >= cloudTimestamp)) {
      acc[monthKey] = localEntry;
    } else {
      acc[monthKey] = cloudEntry;
    }
    return acc;
  }, {});
}

module.exports = {
  toGoalMonthKey,
  normalizeMonthlyGoals,
  migrateLegacyGoal,
  getMonthlyGoalEntry,
  setMonthlyGoalEntry,
  mergeMonthlyGoals
};
