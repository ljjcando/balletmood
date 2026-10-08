const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseCourseDuration,
  normalizeCourseDuration
} = require('../pages/index/course-duration-helper');

test('parseCourseDuration accepts finite positive decimal hours', () => {
  assert.equal(parseCourseDuration('1.5'), 1.5);
  assert.equal(parseCourseDuration(' 2 '), 2);
  assert.equal(parseCourseDuration('.5'), 0.5);
});

test('parseCourseDuration rejects empty, malformed, non-positive, and excessive values', () => {
  ['', '0', '-1', '1.5abc', '1..5', 'Infinity', '24.1'].forEach((value) => {
    assert.equal(parseCourseDuration(value), null);
  });
});

test('normalizeCourseDuration returns a stable string and throws a user-safe validation error', () => {
  assert.equal(normalizeCourseDuration('1.50'), '1.5');
  assert.throws(
    () => normalizeCourseDuration('-2'),
    (error) => error && error.code === 'INVALID_COURSE_DURATION' && error.message === '课程时长需大于0且不超过24小时'
  );
});
