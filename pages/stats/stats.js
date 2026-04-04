const {
  getCurrentStatsPeriod,
  buildStatsSnapshot
} = require('./stats-helper');

// 舞者成就统计页
Page({
  data: {
    // 基础统计
    totalHours: 0,          // 累计总课时（小时）
    totalDays: 0,            // 总上课天数
    monthlyHours: 0,         // 本月课时（小时）

    // 能量场数据（部位频次统计）
    bodyPartsStats: [],      // [{ name: '核心', count: 15, color: '#F5E6DC', ... }]

    // 课程分布统计
    courseDistribution: [],  // [{ name: '基训课', hours: 30, percentage: 45, color: '#F5E6DC', ... }]

    // 当前年月（用于本月统计）
    currentYear: new Date().getFullYear(),
    currentMonth: new Date().getMonth() + 1,

    // 为后续历史曲线预留的月度汇总
    monthlySummaries: [],

    // 预留：气泡 UI 映射数据
    energyBubbleData: []     // 预留字段，用于后续气泡可视化
  },

  onLoad() {
    this.refreshStats();
  },

  onShow() {
    this.refreshStats();
  },

  refreshStats(now = new Date()) {
    const period = getCurrentStatsPeriod(now);
    this.setData(period);
    this.calculateStats(period);
  },

  // ==================== 统计计算核心逻辑 ====================
  calculateStats(period = this.data) {
    const allRecords = wx.getStorageSync('balletMoodData') || {};
    const statsSnapshot = buildStatsSnapshot(allRecords, period);
    this.setData(statsSnapshot);
  },

  // ==================== 预留：数据刷新接口 ====================
  // 后续可添加下拉刷新功能
  onPullDownRefresh() {
    this.refreshStats();
    wx.stopPullDownRefresh();
  }
});
