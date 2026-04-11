const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_COURSE_TAGS,
  normalizeCourseTags,
  addCourseTag,
  updateCourseTag,
  deleteCourseTag
} = require('../pages/index/course-tags-helper');

test('normalizeCourseTags falls back to the default preset course tags', () => {
  assert.deepEqual(
    normalizeCourseTags(),
    DEFAULT_COURSE_TAGS.map(name => ({ name, selected: false }))
  );
});

test('normalizeCourseTags keeps an empty stored course tag list empty', () => {
  assert.deepEqual(normalizeCourseTags([]), []);
});

test('normalizeCourseTags removes duplicate course names', () => {
  assert.deepEqual(
    normalizeCourseTags(['入门', '提高', '入门', { name: '提高' }, { name: '初级' }]),
    [
      { name: '入门', selected: false },
      { name: '提高', selected: false },
      { name: '初级', selected: false }
    ]
  );
});

test('addCourseTag appends a trimmed custom course tag', () => {
  const courseTags = addCourseTag(normalizeCourseTags(), '  变奏提高  ');

  assert.equal(courseTags.at(-1).name, '变奏提高');
  assert.equal(courseTags.at(-1).selected, false);
});

test('addCourseTag rejects duplicate course names', () => {
  assert.throws(
    () => addCourseTag(normalizeCourseTags(), '入门'),
    /已存在/
  );
});

test('updateCourseTag renames an existing course tag', () => {
  const courseTags = updateCourseTag(normalizeCourseTags(), 0, '芭蕾入门');

  assert.equal(courseTags[0].name, '芭蕾入门');
});

test('updateCourseTag rejects renaming to another existing course tag', () => {
  assert.throws(
    () => updateCourseTag(normalizeCourseTags(), 0, '提高'),
    /已存在/
  );
});

test('deleteCourseTag removes a course tag by index', () => {
  const courseTags = deleteCourseTag(normalizeCourseTags(), 1);

  assert.equal(courseTags.length, DEFAULT_COURSE_TAGS.length - 1);
  assert.equal(courseTags.some(tag => tag.name === '提高'), false);
});
