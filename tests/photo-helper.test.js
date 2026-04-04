const test = require('node:test');
const assert = require('node:assert/strict');

const { applySelectedPhoto } = require('../pages/index/photo-helper');

test('falls back to the original image when editImage is unavailable', async () => {
  let selectedPath = '';

  applySelectedPhoto({
    wxApi: {},
    tempFilePath: '/tmp/original.jpg',
    onSuccess: (path) => {
      selectedPath = path;
    }
  });

  assert.equal(selectedPath, '/tmp/original.jpg');
});

test('falls back to the original image when editImage fails', async () => {
  let selectedPath = '';

  applySelectedPhoto({
    wxApi: {
      editImage({ fail }) {
        fail(new Error('unsupported'));
      }
    },
    tempFilePath: '/tmp/original.jpg',
    onSuccess: (path) => {
      selectedPath = path;
    }
  });

  assert.equal(selectedPath, '/tmp/original.jpg');
});

test('uses the edited image when editImage succeeds', async () => {
  let selectedPath = '';

  applySelectedPhoto({
    wxApi: {
      editImage({ success }) {
        success({ tempFilePath: '/tmp/edited.jpg' });
      }
    },
    tempFilePath: '/tmp/original.jpg',
    onSuccess: (path) => {
      selectedPath = path;
    }
  });

  assert.equal(selectedPath, '/tmp/edited.jpg');
});
