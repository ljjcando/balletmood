const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const wxmlPath = path.join(__dirname, '..', 'pages', 'index', 'index.wxml');

test('course selector uses confirm wording and exposes a close button in the header', () => {
  const template = fs.readFileSync(wxmlPath, 'utf8');

  assert.match(template, /class="course-selector-confirm"[\s\S]*?>确认<\/view>/);
  assert.match(template, /class="course-selector-close" bindtap="closeCourseSelector">×<\/text>/);
  assert.doesNotMatch(template, /class="course-selector-cancel"[\s\S]*?>取消<\/view>/);
});
