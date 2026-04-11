const DEFAULT_COURSE_TAGS = ['入门', '提高', '初级', '初提', '中级', '软开', 'PBT'];

function sanitizeCourseName(name) {
  return typeof name === 'string' ? name.trim() : '';
}

function toCourseTag(name) {
  return {
    name,
    selected: false
  };
}

function normalizeCourseTags(courseTags) {
  if (!Array.isArray(courseTags)) {
    return DEFAULT_COURSE_TAGS.map(toCourseTag);
  }

  const normalized = courseTags
    .map((tag) => {
      if (typeof tag === 'string') {
        return sanitizeCourseName(tag);
      }

      return sanitizeCourseName(tag && tag.name);
    })
    .filter(Boolean)
    .filter((name, index, list) => list.indexOf(name) === index);

  if (normalized.length === 0 && courseTags.length > 0) {
    return DEFAULT_COURSE_TAGS.map(toCourseTag);
  }

  return normalized.map(toCourseTag);
}

function ensureUniqueCourseName(courseTags, name, currentIndex = -1) {
  const normalizedName = sanitizeCourseName(name);

  if (!normalizedName) {
    throw new Error('课程名称不能为空');
  }

  const duplicateIndex = courseTags.findIndex((tag) => tag.name === normalizedName);
  if (duplicateIndex !== -1 && duplicateIndex !== currentIndex) {
    throw new Error('该课程已存在');
  }

  return normalizedName;
}

function addCourseTag(courseTags, name) {
  const normalizedTags = normalizeCourseTags(courseTags);
  const normalizedName = ensureUniqueCourseName(normalizedTags, name);
  return [...normalizedTags, toCourseTag(normalizedName)];
}

function updateCourseTag(courseTags, index, name) {
  const normalizedTags = normalizeCourseTags(courseTags);
  if (index < 0 || index >= normalizedTags.length) {
    throw new Error('课程不存在');
  }

  const normalizedName = ensureUniqueCourseName(normalizedTags, name, index);
  return normalizedTags.map((tag, tagIndex) => (
    tagIndex === index ? toCourseTag(normalizedName) : tag
  ));
}

function deleteCourseTag(courseTags, index) {
  const normalizedTags = normalizeCourseTags(courseTags);
  if (index < 0 || index >= normalizedTags.length) {
    throw new Error('课程不存在');
  }

  return normalizedTags.filter((_, tagIndex) => tagIndex !== index);
}

module.exports = {
  DEFAULT_COURSE_TAGS,
  normalizeCourseTags,
  addCourseTag,
  updateCourseTag,
  deleteCourseTag
};
