function parseAdminOpenIds(value) {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((openid) => openid.trim())
    .filter((openid, index, all) => openid && all.indexOf(openid) === index);
}

function isCleanupAdmin(openid, allowlistText) {
  if (typeof openid !== 'string' || !openid) return false;
  return parseAdminOpenIds(allowlistText).includes(openid);
}

module.exports = {
  parseAdminOpenIds,
  isCleanupAdmin
};
