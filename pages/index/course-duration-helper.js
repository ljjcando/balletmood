const MAX_COURSE_DURATION_HOURS = 24;

function parseCourseDuration(value) {
  const normalized = typeof value === 'number' ? String(value) : String(value || '').trim();
  if (!/^(?:\d+|\d*\.\d+)$/.test(normalized)) {
    return null;
  }

  const duration = Number(normalized);
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_COURSE_DURATION_HOURS) {
    return null;
  }

  return duration;
}

function normalizeCourseDuration(value) {
  const duration = parseCourseDuration(value);
  if (duration === null) {
    const error = new Error(`课程时长需大于0且不超过${MAX_COURSE_DURATION_HOURS}小时`);
    error.code = 'INVALID_COURSE_DURATION';
    throw error;
  }

  return String(duration);
}

module.exports = {
  MAX_COURSE_DURATION_HOURS,
  parseCourseDuration,
  normalizeCourseDuration
};
