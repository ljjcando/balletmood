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
        onSuccess(tempFilePath);
      }
    });
  } catch (error) {
    onSuccess(tempFilePath);
  }
}

module.exports = {
  applySelectedPhoto
};
