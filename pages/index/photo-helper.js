function applySelectedPhoto({ wxApi, tempFilePath, onSuccess }) {
  if (!tempFilePath || typeof onSuccess !== 'function') {
    return;
  }

  if (!wxApi || typeof wxApi.editImage !== 'function') {
    onSuccess(tempFilePath);
    return;
  }

  try {
    wxApi.editImage({
      src: tempFilePath,
      cropRatio: { width: 3, height: 4 },
      success: (editRes) => {
        onSuccess(editRes && editRes.tempFilePath ? editRes.tempFilePath : tempFilePath);
      },
      fail: () => {
        // 用户在编辑/裁剪界面点了"取消" → 不选择照片，保持原状
      }
    });
  } catch (error) {
    onSuccess(tempFilePath);
  }
}

function isCloudFileId(path) {
  return typeof path === 'string' && path.startsWith('cloud://');
}

function persistPhotoPath({ wxApi, photoPath }) {
  if (!photoPath || isCloudFileId(photoPath)) {
    return Promise.resolve(photoPath || '');
  }

  const fileSystemManager = wxApi && typeof wxApi.getFileSystemManager === 'function'
    ? wxApi.getFileSystemManager()
    : null;

  const saveFile = fileSystemManager && typeof fileSystemManager.saveFile === 'function'
    ? fileSystemManager.saveFile.bind(fileSystemManager)
    : wxApi && typeof wxApi.saveFile === 'function'
      ? wxApi.saveFile.bind(wxApi)
      : null;

  if (!saveFile) {
    return Promise.resolve(photoPath);
  }

  return new Promise((resolve) => {
    saveFile({
      tempFilePath: photoPath,
      success(res) {
        resolve(res && res.savedFilePath ? res.savedFilePath : photoPath);
      },
      fail() {
        resolve(photoPath);
      }
    });
  });
}

module.exports = {
  applySelectedPhoto,
  persistPhotoPath
};
