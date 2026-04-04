App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 及以上基础库以支持云开发');
      return;
    }

    wx.cloud.init({
      env: 'cloud1-8g4b1dose4f26042',
      traceUser: true
    });
  }
});
