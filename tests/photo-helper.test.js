const test = require('node:test');
const assert = require('node:assert/strict');

const { applySelectedPhoto, persistPhotoPath } = require('../pages/index/photo-helper');

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

test('persists a temp photo path locally when saveFile is available', async () => {
  const persistedPath = await persistPhotoPath({
    wxApi: {
      getFileSystemManager() {
        return {
          saveFile({ tempFilePath, success }) {
            success({ savedFilePath: `/persisted${tempFilePath}` });
          }
        };
      }
    },
    photoPath: '/tmp/original.jpg'
  });

  assert.equal(persistedPath, '/persisted/tmp/original.jpg');
});

test('falls back to wx.saveFile when file system saveFile is unavailable', async () => {
  const persistedPath = await persistPhotoPath({
    wxApi: {
      saveFile({ tempFilePath, success }) {
        success({ savedFilePath: `/legacy${tempFilePath}` });
      }
    },
    photoPath: '/tmp/original.jpg'
  });

  assert.equal(persistedPath, '/legacy/tmp/original.jpg');
});

test('keeps the original path when saveFile is unavailable', async () => {
  const persistedPath = await persistPhotoPath({
    wxApi: {},
    photoPath: '/tmp/original.jpg'
  });

  assert.equal(persistedPath, '/tmp/original.jpg');
});

test('keeps cloud file ids unchanged when persisting photo paths', async () => {
  const persistedPath = await persistPhotoPath({
    wxApi: {
      getFileSystemManager() {
        return {
          saveFile() {
            throw new Error('should not be called');
          }
        };
      },
      saveFile() {
        throw new Error('should not be called');
      }
    },
    photoPath: 'cloud://env-id/ballet-mood/2026-04-08.jpg'
  });

  assert.equal(persistedPath, 'cloud://env-id/ballet-mood/2026-04-08.jpg');
});
