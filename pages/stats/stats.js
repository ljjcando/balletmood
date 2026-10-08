const {
  getCurrentStatsPeriod,
  getMonthPickerBounds,
  getYearPickerOptions,
  toPickerMonthValue,
  buildStatsSnapshot,
  buildAnnualStatsSnapshot
} = require('./stats-helper');

// 舞者成就统计页
Page({
  data: {
    // 基础统计
    totalHours: 0,          // 累计总课时（小时）
    totalDays: 0,            // 总上课天数
    monthlyHours: 0,         // 所选月份课时（小时）
    monthlyDays: 0,          // 所选月份练习天数
    monthlyLessons: 0,       // 所选月份课程节数
    statsPeriodMode: 'month',

    // 年度统计
    annualYear: new Date().getFullYear(),
    annualHours: 0,
    annualDays: 0,
    annualLessons: 0,
    annualLongestStreak: 0,
    annualMonthlyBars: [],
    annualCourseDistribution: [],
    annualBestMonthLabel: '暂无',
    annualBestMonthDetail: '还没有练习记录',
    isNextYearDisabled: true,
    yearPickerOptions: [],
    selectedYearIndex: 0,

    // 能量场数据（部位频次统计）
    bodyPartsStats: [],      // [{ name: '核心', count: 15, color: '#F5E6DC', ... }]

    // 课程分布统计
    courseDistribution: [],  // [{ name: '基训课', hours: 30, percentage: 45, color: '#F5E6DC', ... }]

    // 当前年月（用于本月统计）
    currentYear: new Date().getFullYear(),
    currentMonth: new Date().getMonth() + 1,
    isNextMonthDisabled: true,
    isCurrentMonth: true,
    selectedMonthValue: '',
    monthPickerStart: '',
    monthPickerEnd: '',
    calendarDays: [],
    longestStreak: 0,

    // 自定义导航栏尺寸，运行时按状态栏与微信胶囊位置计算
    statusBarHeight: 20,
    navBarHeight: 44,
    customNavHeight: 64,

    // 为后续历史曲线预留的月度汇总
    monthlySummaries: [],

    // 预留：气泡 UI 映射数据
    energyBubbleData: []     // 预留字段，用于后续气泡可视化
  },

  onLoad() {
    this.initNavigationLayout();
    this.refreshStats();
  },

  onShow() {
    this.refreshStats();
  },

  initNavigationLayout() {
    let statusBarHeight = 20;
    let navBarHeight = 44;

    try {
      const windowInfo = typeof wx.getWindowInfo === 'function'
        ? wx.getWindowInfo()
        : (typeof wx.getSystemInfoSync === 'function' ? wx.getSystemInfoSync() : {});
      const menuButton = typeof wx.getMenuButtonBoundingClientRect === 'function'
        ? wx.getMenuButtonBoundingClientRect()
        : null;

      statusBarHeight = Number(windowInfo.statusBarHeight) || statusBarHeight;

      if (menuButton && Number(menuButton.height) > 0) {
        const verticalGap = Math.max(Number(menuButton.top) - statusBarHeight, 0);
        navBarHeight = Number(menuButton.height) + verticalGap * 2;
      }
    } catch (error) {
      // 极旧基础库读取系统信息失败时，使用上方安全默认值。
    }

    this.setData({
      statusBarHeight,
      navBarHeight,
      customNavHeight: statusBarHeight + navBarHeight
    });
  },

  refreshStats(now = new Date()) {
    const period = getCurrentStatsPeriod(now);
    this.setData({ ...period, annualYear: period.currentYear });
    this.calculateStats(period);
    this.calculateAnnualStats(period.currentYear);
  },

  // ==================== 统计计算核心逻辑 ====================
  calculateStats(period = this.data) {
    const allRecords = wx.getStorageSync('balletMoodData') || {};
    const statsSnapshot = buildStatsSnapshot(allRecords, period);
    const now = new Date();
    const nowPeriod = getCurrentStatsPeriod(now);
    const monthPickerBounds = getMonthPickerBounds(allRecords, now);
    const isCurrentMonth = period.currentYear === nowPeriod.currentYear &&
      period.currentMonth === nowPeriod.currentMonth;
    const isNextMonthDisabled = period.currentYear > nowPeriod.currentYear || (
      period.currentYear === nowPeriod.currentYear && period.currentMonth >= nowPeriod.currentMonth
    );
    this.setData({
      ...statsSnapshot,
      ...monthPickerBounds,
      selectedMonthValue: toPickerMonthValue(period.currentYear, period.currentMonth),
      isNextMonthDisabled,
      isCurrentMonth
    });
  },

  calculateAnnualStats(annualYear = this.data.annualYear) {
    const allRecords = wx.getStorageSync('balletMoodData') || {};
    const annualSnapshot = buildAnnualStatsSnapshot(allRecords, { annualYear });
    const now = new Date();
    const currentYear = now.getFullYear();
    const yearPickerState = getYearPickerOptions(allRecords, now, annualYear);
    this.setData({
      ...annualSnapshot,
      ...yearPickerState,
      isNextYearDisabled: annualYear >= currentYear
    });
  },

  switchStatsPeriod(event) {
    const mode = event && event.currentTarget ? event.currentTarget.dataset.period : '';
    if (mode !== 'month' && mode !== 'year') return;
    this.setData({ statsPeriodMode: mode });
  },

  prevMonth() {
    let { currentYear, currentMonth } = this.data;
    currentMonth--;
    if (currentMonth < 1) {
      currentMonth = 12;
      currentYear--;
    }
    const period = { currentYear, currentMonth };
    this.setData(period);
    this.calculateStats(period);
  },

  returnToCurrentMonth() {
    this.refreshStats(new Date());
  },

  onMonthPickerChange(event) {
    const value = event && event.detail ? event.detail.value : '';
    const [currentYear, currentMonth] = String(value).split('-').map(Number);
    if (!currentYear || currentMonth < 1 || currentMonth > 12) return;

    const nowPeriod = getCurrentStatsPeriod(new Date());
    const isFutureMonth = currentYear > nowPeriod.currentYear || (
      currentYear === nowPeriod.currentYear && currentMonth > nowPeriod.currentMonth
    );
    if (isFutureMonth) return;

    const period = { currentYear, currentMonth };
    this.setData(period);
    this.calculateStats(period);
  },

  nextMonth() {
    if (this.data.isNextMonthDisabled) return;

    let { currentYear, currentMonth } = this.data;
    currentMonth++;
    if (currentMonth > 12) {
      currentMonth = 1;
      currentYear++;
    }
    const period = { currentYear, currentMonth };
    this.setData(period);
    this.calculateStats(period);
  },

  prevYear() {
    const annualYear = this.data.annualYear - 1;
    this.setData({ annualYear });
    this.calculateAnnualStats(annualYear);
  },

  nextYear() {
    if (this.data.isNextYearDisabled) return;

    const annualYear = this.data.annualYear + 1;
    this.setData({ annualYear });
    this.calculateAnnualStats(annualYear);
  },

  onYearPickerChange(event) {
    const selectedYearIndex = Number(event && event.detail ? event.detail.value : -1);
    const selectedLabel = this.data.yearPickerOptions[selectedYearIndex];
    const annualYear = Number.parseInt(selectedLabel, 10);
    const currentYear = new Date().getFullYear();
    if (!annualYear || annualYear > currentYear) return;

    this.setData({ annualYear, selectedYearIndex });
    this.calculateAnnualStats(annualYear);
  },

  // ==================== 预留：数据刷新接口 ====================
  // 后续可添加下拉刷新功能
  onPullDownRefresh() {
    this.refreshStats();
    wx.stopPullDownRefresh();
  }
});
