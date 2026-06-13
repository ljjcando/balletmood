const { applySelectedPhoto, persistPhotoPath } = require('./photo-helper');
const {
  normalizeCourseTags,
  addCourseTag,
  updateCourseTag,
  deleteCourseTag
} = require('./course-tags-helper');
const {
  getDefaultSnapshot,
  readLocalSnapshot,
  hasLocalRecords,
  migrateLocalSnapshotToCloud,
  restoreFromCloudIfLocalEmpty,
  pushSnapshotToCloud,
  saveSingleRecordToCloud,
  fetchLatestCloudSnapshot
} = require('../../utils/cloud-sync-helper');

function normalizePageRecordDateKey(key) {
  if (typeof key !== 'string') {
    return '';
  }

  const trimmedKey = key.trim();
  const simpleDateMatch = trimmedKey.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);

  if (simpleDateMatch) {
    const [, year, month, day] = simpleDateMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  return trimmedKey;
}

function normalizePageRecords(records) {
  if (!records || typeof records !== 'object' || Array.isArray(records)) {
    return {};
  }

  return Object.keys(records).reduce((acc, rawKey) => {
    const normalizedKey = normalizePageRecordDateKey(rawKey);

    if (!normalizedKey) {
      return acc;
    }

    acc[normalizedKey] = records[rawKey];
    return acc;
  }, {});
}

// Ballet Mood 微信小程序版
Page({
  // ==================== 页面数据 ====================
  data: {
    // 日期相关 - 使用数字存储，避免类型混乱
    currentYear: 0,
    currentMonth: 0,
    currentMonthName: '',
    currentDay: new Date().getDate(),
    weekdays: ['日', '一', '二', '三', '四', '五', '六'],
    calendarDays: [],

    // 本月目标
    monthlyGoal: '',

    // 弹窗状态
    showEditModal: false,
    showTermsModal: false,
    showPostcard: false,
    showNewTermInput: false,
    showNewCourseInput: false,

    // 编辑相关
    modalTitle: '',
    selectedDate: '',
    isEditMode: false,
    currentPhoto: '',
    currentPhotoExpired: false,
    currentNote: '',
    currentCourses: [],

    // 术语管理
    terms: [],
    termsOptions: [],
    termsUpdatedAt: '',
    newTerm: '',
    newCourseName: '',
    editingCourseTagIndex: -1,

    // 身体部位配置
    bodyPartsConfig: {
      '核心 Core': { name: '核心', color: '#F5E6DC' },
      '脚背 Arch': { name: '脚背', color: '#E8D5D0' },
      '外开 Turn-out': { name: '外开', color: '#E0CCB8' },
      '背部 Back': { name: '背部', color: '#D8C3A6' },
      '手臂 Arms': { name: '手臂', color: '#D0AF90' }
    },

    // 部位选项（用于选择器）
    bodyPartsOptions: [
      { key: '核心 Core', name: '核心 Core', selected: false },
      { key: '脚背 Arch', name: '脚背 Arch', selected: false },
      { key: '外开 Turn-out', name: '外开 Turn-out', selected: false },
      { key: '背部 Back', name: '背部 Back', selected: false },
      { key: '手臂 Arms', name: '手臂 Arms', selected: false }
    ],

    // 课程标签库（预设课程类型）
    courseTags: [
      { name: '入门', selected: false },
      { name: '提高', selected: false },
      { name: '初级', selected: false },
      { name: '初提', selected: false },
      { name: '中级', selected: false },
      { name: '软开', selected: false },
      { name: 'PBT', selected: false }
    ],
    courseTagsUpdatedAt: '',
    showingCourseSelector: -1,  // 当前显示选择器的课程行索引，-1 表示不显示

    // 明信片数据
    postcardData: {},
    expiredPhotoDates: {},

    // 所有记录
    records: {},
    allRecords: {}
  },

  // ==================== 生命周期 ====================
  async onLoad() {
    // 初始化日期 - 使用数字，避免类型混乱
    const now = new Date();
    await this.setDataAsync({
      currentYear: now.getFullYear(),
      currentMonth: now.getMonth() + 1
    });
    await this.loadStorageData();
  },

  onShareAppMessage() {
    return {
      title: '分享我的芭蕾练功日记 🩰',
      path: '/pages/index/index'
    };
  },

  onShareTimeline() {
    return {
      title: '分享我的芭蕾练功日记 🩰',
      query: ''
    };
  },

  setDataAsync(update) {
    return new Promise((resolve) => {
      this.setData(update, resolve);
    });
  },

  isPhotoExpired(dateStr) {
    return !!(dateStr && this.data.expiredPhotoDates && this.data.expiredPhotoDates[dateStr]);
  },

  getRenderablePhoto(photoPath, dateStr) {
    if (!photoPath || this.isPhotoExpired(dateStr)) {
      return '';
    }

    return photoPath;
  },

  async markPhotoExpired(dateStr) {
    if (!dateStr || this.isPhotoExpired(dateStr)) {
      return;
    }

    await this.setDataAsync({
      expiredPhotoDates: {
        ...(this.data.expiredPhotoDates || {}),
        [dateStr]: true
      }
    });
  },

  // ==================== 数据加载 ====================
  async applySnapshotToPage(snapshot = getDefaultSnapshot()) {
    const safeSnapshot = snapshot || getDefaultSnapshot();
    const normalizedRecords = normalizePageRecords(safeSnapshot.records);
    const terms = Array.isArray(safeSnapshot.terms) && safeSnapshot.terms.length > 0
      ? safeSnapshot.terms
      : getDefaultSnapshot().terms;
    const courseTags = normalizeCourseTags(safeSnapshot.courseTags);
    const termsOptions = terms.map(term => ({
      name: term,
      selected: false
    }));

    await this.setDataAsync({
      records: normalizedRecords,
      allRecords: normalizedRecords,
      terms,
      termsOptions,
      termsUpdatedAt: safeSnapshot.termsUpdatedAt || '',
      monthlyGoal: safeSnapshot.goal || '',
      courseTags,
      courseTagsUpdatedAt: safeSnapshot.courseTagsUpdatedAt || ''
    });
  },

  async applySnapshotToPageAndRender(snapshot, source) {
    const safeSnapshot = snapshot || getDefaultSnapshot();

    await this.applySnapshotToPage(safeSnapshot);
    await this.renderCalendar();
  },

  buildCurrentSnapshot(nextRecords) {
    return {
      records: nextRecords || this.data.allRecords || {},
      terms: this.data.terms || getDefaultSnapshot().terms,
      termsUpdatedAt: this.data.termsUpdatedAt || '',
      goal: this.data.monthlyGoal || '',
      courseTags: this.data.courseTags || getDefaultSnapshot().courseTags,
      courseTagsUpdatedAt: this.data.courseTagsUpdatedAt || ''
    };
  },

  trackLocalMutation() {
    this.localMutationVersion = (this.localMutationVersion || 0) + 1;
    return this.localMutationVersion;
  },

  async waitForPendingCloudSync() {
    if (!this.pendingCloudSyncPromise) {
      return;
    }

    await this.pendingCloudSyncPromise.catch(() => {});
  },

  syncCurrentSnapshotInBackground(nextRecords, options = {}) {
    const snapshot = this.buildCurrentSnapshot(nextRecords);
    const previousSync = this.pendingCloudSyncPromise || Promise.resolve();
    const nextSync = previousSync
      .catch(() => {})
      .then(() => pushSnapshotToCloud(snapshot, wx, options));

    this.pendingCloudSyncPromise = nextSync;
    return nextSync.catch(() => {});
  },

  syncSingleRecordInBackground(dateKey, record) {
    const previousSync = this.pendingCloudSyncPromise || Promise.resolve();
    const nextSync = previousSync
      .catch(() => {})
      .then(async () => {
        const result = await saveSingleRecordToCloud(dateKey, record, wx);
        // 如果照片被上传到云端（photo 由本地路径变为 cloud:// ID），把这次变化回写到本地存储
        // 不主动 setData 页面，避免覆盖用户在同步期间的新一轮编辑；下次启动会从本地拿到 cloud:// ID
        if (result && result.record && result.record.photo && result.record.photo !== record.photo) {
          const currentLocal = wx.getStorageSync('balletMoodData') || {};
          if (currentLocal[dateKey]) {
            currentLocal[dateKey] = { ...currentLocal[dateKey], photo: result.record.photo };
            wx.setStorageSync('balletMoodData', currentLocal);
          }
        }
      })
      .catch((error) => {
        console.log('[index] syncSingleRecordInBackground failed:', error && error.message);
      });

    this.pendingCloudSyncPromise = nextSync;
    return nextSync.catch(() => {});
  },

  getSnapshotFreshness(snapshot) {
    const records = normalizePageRecords(snapshot && snapshot.records);
    const latest = Object.values(records).reduce((currentLatest, record) => {
      const timestamp = record && record.updatedAt ? new Date(record.updatedAt).getTime() : Number.NaN;
      if (Number.isNaN(timestamp)) {
        return currentLatest;
      }

      return Math.max(currentLatest, timestamp);
    }, -Infinity);

    const termsTimestamp = snapshot && snapshot.termsUpdatedAt
      ? new Date(snapshot.termsUpdatedAt).getTime()
      : Number.NaN;
    const courseTagsTimestamp = snapshot && snapshot.courseTagsUpdatedAt
      ? new Date(snapshot.courseTagsUpdatedAt).getTime()
      : Number.NaN;
    const freshness = [latest, termsTimestamp, courseTagsTimestamp].reduce((currentLatest, timestamp) => {
      if (Number.isNaN(timestamp)) {
        return currentLatest;
      }

      return Math.max(currentLatest, timestamp);
    }, -Infinity);

    return freshness === -Infinity ? Number.NaN : freshness;
  },

  createMutationTimestamp() {
    return new Date().toISOString();
  },

  shouldApplyCloudSnapshot(cloudSnapshot) {
    if (!cloudSnapshot) {
      return false;
    }

    const currentSnapshot = this.buildCurrentSnapshot();
    const currentFreshness = this.getSnapshotFreshness(currentSnapshot);
    const cloudFreshness = this.getSnapshotFreshness(cloudSnapshot);

    if (Number.isNaN(cloudFreshness)) {
      return false;
    }

    if (Number.isNaN(currentFreshness)) {
      return true;
    }

    return cloudFreshness > currentFreshness;
  },

  async applyAsyncSnapshotIfCurrent(snapshot, mutationVersion, source) {
    if ((this.localMutationVersion || 0) !== (mutationVersion || 0)) {
      console.log(`[index] skip stale snapshot from ${source} due to newer local mutation`);
      return false;
    }

    await this.applySnapshotToPageAndRender(snapshot, source);
    return true;
  },

  async loadStorageData() {
    const localSnapshot = readLocalSnapshot(wx);
    const initialMutationVersion = this.localMutationVersion || 0;

    try {
      await this.applySnapshotToPageAndRender(localSnapshot, 'local-startup');

      if (hasLocalRecords(wx)) {
        this.startupSyncPromise = migrateLocalSnapshotToCloud(wx)
          .then(async (migrationResult) => {
            await this.applyAsyncSnapshotIfCurrent(
              migrationResult.snapshot || readLocalSnapshot(wx),
              initialMutationVersion,
              'local-full-sync'
            );
          })
          .catch((error) => {
            console.log('[index] startup migration failed after local render:', error && error.message);
          });
        return;
      }

      this.startupSyncPromise = restoreFromCloudIfLocalEmpty(wx)
        .then(async (restoreResult) => {
          await this.applyAsyncSnapshotIfCurrent(
            restoreResult.snapshot || readLocalSnapshot(wx),
            initialMutationVersion,
            restoreResult.restored ? 'cloud' : 'local-fallback'
          );
        })
        .catch((error) => {
          console.log('[index] startup restore failed after local render:', error && error.message);
        });
    } catch (error) {
      console.log('[index] loadStorageData failed, fallback to local snapshot:', error && error.message);
      await this.applySnapshotToPageAndRender(localSnapshot, 'local-error-fallback');
    }
  },

  async onRefresh() {
    try {
      await this.waitForPendingCloudSync();
      const cloudSnapshot = await fetchLatestCloudSnapshot(wx);
      if (cloudSnapshot) {
        await this.applySnapshotToPageAndRender(cloudSnapshot, 'cloud-refresh');
      } else {
        await this.applySnapshotToPageAndRender(readLocalSnapshot(wx), 'refresh-local-fallback');
      }
    } catch (error) {
      console.log('[index] onRefresh failed, fallback to local snapshot:', error && error.message);
      await this.applySnapshotToPageAndRender(readLocalSnapshot(wx), 'refresh-error-fallback');
    }
  },

  async onPullDownRefresh() {
    await this.onRefresh();
    wx.stopPullDownRefresh();
  },

  onShow() {
    const mutationVersion = this.localMutationVersion || 0;

    this.backgroundRefreshPromise = (async () => {
      try {
        if (this.pendingCloudSyncPromise) {
          await this.waitForPendingCloudSync();
        }
        const cloudSnapshot = await fetchLatestCloudSnapshot(wx);

        if (!this.shouldApplyCloudSnapshot(cloudSnapshot)) {
          return;
        }

        await this.applyAsyncSnapshotIfCurrent(cloudSnapshot, mutationVersion, 'cloud-onshow');
      } catch (error) {
        console.log('[index] onShow background refresh failed:', error && error.message);
      }
    })();
  },

  // ==================== 月份导航 ====================
  prevMonth() {
    let { currentYear, currentMonth } = this.data;
    currentMonth--;
    if (currentMonth < 1) {
      currentMonth = 12;
      currentYear--;
    }
    this.setData({ currentYear, currentMonth });
    this.renderCalendar();
  },

  nextMonth() {
    let { currentYear, currentMonth } = this.data;
    currentMonth++;
    if (currentMonth > 12) {
      currentMonth = 1;
      currentYear++;
    }
    this.setData({ currentYear, currentMonth });
    this.renderCalendar();
  },

  // ==================== 日历渲染 ====================
  async renderCalendar() {
    const { currentYear, currentMonth } = this.data;
    const allRecords = this.data.records || this.data.allRecords || {};
    const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月',
                       '七月', '八月', '九月', '十月', '十一月', '十二月'];

    const firstDay = new Date(currentYear, currentMonth - 1, 1);
    const lastDay = new Date(currentYear, currentMonth, 0);
    const startingDay = firstDay.getDay();
    const totalDays = lastDay.getDate();

    const calendarDays = [];
    const today = new Date();

    // 空白日期
    for (let i = 0; i < startingDay; i++) {
      calendarDays.push({ isEmpty: true });
    }

    // 实际日期
    for (let day = 1; day <= totalDays; day++) {
      const dateStr = this.formatDate(new Date(currentYear, currentMonth - 1, day));
      const record = allRecords[dateStr];

      const isToday = today.getFullYear() === currentYear &&
                     today.getMonth() === currentMonth - 1 &&
                     today.getDate() === day;

      calendarDays.push({
        day,
        date: dateStr,
        isEmpty: false,
        isToday,
        hasRecord: !!record,
        photo: record ? this.getRenderablePhoto(record.photo, dateStr) : ''
      });
    }

    // 只更新日历数据和月份名称，currentMonth 保持为数字
    await this.setDataAsync({
      calendarDays,
      currentMonthName: monthNames[currentMonth - 1]
    });
  },

  // ==================== 日期点击 ====================
  onDayClick(e) {
    const { date } = e.currentTarget.dataset;
    const record = this.data.allRecords[date];

    // 只要有记录，就进入展示模式（明信片视图）
    // 没有记录时，才进入编辑模式（新建）
    if (record) {
      this.openPostcard(date);
    } else {
      this.openEditModal(date);
    }
  },

  // ==================== 编辑弹窗 ====================
  openEditModal(dateStr) {
    const record = this.data.allRecords[dateStr];

    // 为现有课程添加颜色
    let courses = [];
    if (record && record.courses) {
      courses = record.courses.map(course => {
        const color = this.getCourseColor(course.name || '');
        return {
          ...course,
          color,
          itemStyle: `background-color:${color}`
        };
      });
    }

    // 重置并恢复 bodyPartsOptions 的 selected 状态
    let bodyPartsOptions = this.data.bodyPartsOptions.map(item => ({
      ...item,
      selected: false
    }));

    // 如果记录中有 bodyParts，恢复选中状态
    if (record && record.bodyParts && Array.isArray(record.bodyParts)) {
      record.bodyParts.forEach(partName => {
        const index = bodyPartsOptions.findIndex(item => item.name === partName);
        if (index !== -1) {
          bodyPartsOptions[index].selected = true;
        }
      });
    }

    // 重置并恢复 termsOptions 的 selected 状态
    let termsOptions = this.data.termsOptions.map(item => ({
      ...item,
      selected: false
    }));

    // 如果记录中有术语，恢复选中状态（兼容旧数据）
    if (record) {
      let termsToLoad = [];
      // 新数据：terms 数组
      if (record.terms && Array.isArray(record.terms)) {
        termsToLoad = record.terms;
      }
      // 旧数据：term 字符串
      else if (record.term) {
        termsToLoad = [record.term];
      }

      termsToLoad.forEach(termName => {
        const index = termsOptions.findIndex(item => item.name === termName);
        if (index !== -1) {
          termsOptions[index].selected = true;
        }
      });
    }

    this.setData({
      showEditModal: true,
      selectedDate: dateStr,
      isEditMode: !!record,
      currentPhoto: record ? record.photo : '',
      currentPhotoExpired: this.isPhotoExpired(dateStr),
      currentNote: record ? record.note : '',
      termsOptions,
      bodyPartsOptions,
      currentCourses: courses,
      showNewCourseInput: false,
      newCourseName: '',
      editingCourseTagIndex: -1
    });

    const [year, month, day] = dateStr.split('-');
    this.setData({ modalTitle: `${month}月${day}日` });
  },

  closeEditModal() {
    // 重置 bodyPartsOptions 的所有 selected 为 false
    const bodyPartsOptions = this.data.bodyPartsOptions.map(item => ({
      ...item,
      selected: false
    }));

    // 重置 termsOptions 的所有 selected 为 false
    const termsOptions = this.data.termsOptions.map(item => ({
      ...item,
      selected: false
    }));

    this.setData({
      showEditModal: false,
      selectedDate: '',
      currentPhoto: '',
      currentPhotoExpired: false,
      currentNote: '',
      termsOptions,
      bodyPartsOptions,
      currentCourses: [],
      showingCourseSelector: -1,
      showNewCourseInput: false,
      newCourseName: '',
      editingCourseTagIndex: -1
    });
  },

  // ==================== 照片功能 ====================
  choosePhoto() {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempFilePath = res.tempFilePaths[0];

        applySelectedPhoto({
          wxApi: wx,
          tempFilePath,
          onSuccess: async (photoPath) => {
            const persistentPhotoPath = await persistPhotoPath({
              wxApi: wx,
              photoPath
            });

            this.setData({
              currentPhoto: persistentPhotoPath,
              currentPhotoExpired: false
            });
          }
        });
      }
    });
  },

  removePhoto() {
    wx.showModal({
      title: '删除照片',
      content: '确定要删除这张照片吗？',
      confirmText: '删除',
      confirmColor: '#D2B48C',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          this.setData({
            currentPhoto: '',
            currentPhotoExpired: false
          });
        }
      }
    });
  },

  async handleCalendarPhotoError(e) {
    const { date } = e.currentTarget.dataset;
    await this.markPhotoExpired(date);
    await this.renderCalendar();
  },

  async handleEditPhotoError() {
    const { selectedDate } = this.data;
    await this.markPhotoExpired(selectedDate);
    this.setData({ currentPhotoExpired: true });
    await this.renderCalendar();
  },

  async handlePostcardPhotoError() {
    const { selectedDate, postcardData } = this.data;
    await this.markPhotoExpired(selectedDate);
    this.setData({
      postcardData: {
        ...postcardData,
        photo: '',
        photoExpired: true
      }
    });
    await this.renderCalendar();
  },

  // ==================== 笔记输入 ====================
  onNoteInput(e) {
    this.setData({ currentNote: e.detail.value });
  },

  // ==================== 术语功能 ====================
  // 切换术语选中状态（多选）
  toggleTerm(e) {
    const { index } = e.currentTarget.dataset;
    const { termsOptions } = this.data;

    // 切换 selected 状态
    termsOptions[index].selected = !termsOptions[index].selected;

    // 更新界面
    this.setData({ termsOptions });
  },

  // 长按术语删除
  longPressTerm(e) {
    const { index } = e.currentTarget.dataset;
    const termName = this.data.termsOptions[index].name;

    wx.showModal({
      title: '确认删除',
      content: `确定要删除术语"${termName}"吗？`,
      success: (res) => {
        if (res.confirm) {
          const terms = this.data.terms.filter((_, i) => i !== index);
          const termsOptions = terms.map(term => ({
            name: term,
            selected: false
          }));
          const termsUpdatedAt = this.createMutationTimestamp();

          this.setData({ terms, termsOptions, termsUpdatedAt });
          wx.setStorageSync('balletMoodTerms', terms);
          wx.setStorageSync('balletMoodTermsUpdatedAt', termsUpdatedAt);
          this.trackLocalMutation();
          this.syncCurrentSnapshotInBackground();
          wx.showToast({ title: '删除成功', icon: 'success' });
        }
      }
    });
  },

  showAddTermInput() {
    this.setData({ showNewTermInput: true });
  },

  onNewTermInput(e) {
    this.setData({ newTerm: e.detail.value });
  },

  addNewTerm() {
    const term = this.data.newTerm.trim();
    if (!term) return;

    if (this.data.terms.includes(term)) {
      wx.showToast({ title: '该术语已存在', icon: 'none' });
      return;
    }

    const terms = [...this.data.terms, term];
    const termsOptions = [...this.data.termsOptions, { name: term, selected: false }];
    const termsUpdatedAt = this.createMutationTimestamp();

    this.setData({ terms, termsOptions, termsUpdatedAt, newTerm: '', showNewTermInput: false });
    wx.setStorageSync('balletMoodTerms', terms);
    wx.setStorageSync('balletMoodTermsUpdatedAt', termsUpdatedAt);
    this.trackLocalMutation();
    this.syncCurrentSnapshotInBackground();
    wx.showToast({ title: '添加成功', icon: 'success' });
  },

  openTermsModal() {
    this.setData({ showTermsModal: true });
  },

  closeTermsModal() {
    this.setData({ showTermsModal: false });
  },

  deleteTerm(e) {
    const { index } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认删除',
      content: `确定要删除术语"${this.data.terms[index]}"吗？`,
      success: (res) => {
        if (res.confirm) {
          const terms = this.data.terms.filter((_, i) => i !== index);
          const termsOptions = terms.map(term => ({
            name: term,
            selected: false
          }));
          const termsUpdatedAt = this.createMutationTimestamp();
          this.setData({ terms, termsOptions, termsUpdatedAt });
          wx.setStorageSync('balletMoodTerms', terms);
          wx.setStorageSync('balletMoodTermsUpdatedAt', termsUpdatedAt);
          this.trackLocalMutation();
          this.syncCurrentSnapshotInBackground();
        }
      }
    });
  },

  // ==================== 身体部位 ====================
  toggleBodyPart(e) {
    const { index } = e.currentTarget.dataset;
    const { bodyPartsOptions } = this.data;

    // 切换 selected 状态
    bodyPartsOptions[index].selected = !bodyPartsOptions[index].selected;

    // 更新界面
    this.setData({
      bodyPartsOptions
    });
  },

  // ==================== 课程管理 ====================
  addCourse() {
    const newCourse = {
      id: Date.now().toString(),
      name: '',
      courseIndex: -1,
      duration: '1.5',
      color: '#F5F0E8',
      itemStyle: 'background-color:#F5F0E8'
    };
    this.setData({
      currentCourses: [...this.data.currentCourses, newCourse]
    });
  },

  // 显示课程标签选择器
  showCourseSelector(e) {
    const { index } = e.currentTarget.dataset;
    this.setData({
      showingCourseSelector: index,
      showNewCourseInput: false,
      newCourseName: '',
      editingCourseTagIndex: -1
    });
  },

  // 选择课程类型
  selectCourseType(e) {
    const { name } = e.currentTarget.dataset;
    const { showingCourseSelector } = this.data;
    const index = showingCourseSelector;

    if (index === -1) return;

    const color = this.getCourseColor(name);
    const courses = [...this.data.currentCourses];
    courses[index].name = name;
    courses[index].courseIndex = this.data.courseTags.findIndex(tag => tag.name === name);
    courses[index].color = color;
    courses[index].itemStyle = `background-color:${color}`;

    // 关闭选择器并更新课程
    this.setData({
      currentCourses: courses,
      showingCourseSelector: -1
    });
  },

  // 关闭课程选择器
  closeCourseSelector() {
    this.setData({
      showingCourseSelector: -1,
      showNewCourseInput: false,
      newCourseName: '',
      editingCourseTagIndex: -1
    });
  },

  showAddCourseInput() {
    this.setData({
      showNewCourseInput: true,
      newCourseName: '',
      editingCourseTagIndex: -1
    });
  },

  onNewCourseInput(e) {
    this.setData({ newCourseName: e.detail.value });
  },

  cancelCourseInput() {
    this.setData({
      showNewCourseInput: false,
      newCourseName: '',
      editingCourseTagIndex: -1
    });
  },

  persistCourseTags(courseTags) {
    const courseTagsUpdatedAt = this.createMutationTimestamp();
    this.setData({ courseTags, courseTagsUpdatedAt });
    wx.setStorageSync('balletMoodCourseTags', courseTags);
    wx.setStorageSync('balletMoodCourseTagsUpdatedAt', courseTagsUpdatedAt);
    this.trackLocalMutation();
    this.syncCurrentSnapshotInBackground();
  },

  syncCurrentCoursesWithRenamedTag(oldName, newName) {
    if (!oldName || oldName === newName) {
      return;
    }

    const currentCourses = this.data.currentCourses.map((course) => {
      if (course.name !== oldName) {
        return course;
      }

      const color = this.getCourseColor(newName);
      return {
        ...course,
        name: newName,
        color,
        itemStyle: `background-color:${color}`
      };
    });

    this.setData({ currentCourses });
  },

  submitCourseTag() {
    const { courseTags, editingCourseTagIndex, newCourseName } = this.data;

    try {
      if (editingCourseTagIndex === -1) {
        const nextCourseTags = addCourseTag(courseTags, newCourseName);
        this.persistCourseTags(nextCourseTags);
        this.setData({
          showNewCourseInput: false,
          newCourseName: '',
          editingCourseTagIndex: -1
        });
        wx.showToast({ title: '添加成功', icon: 'success' });
        return;
      }

      const oldName = courseTags[editingCourseTagIndex] && courseTags[editingCourseTagIndex].name;
      const nextCourseTags = updateCourseTag(courseTags, editingCourseTagIndex, newCourseName);
      const newName = nextCourseTags[editingCourseTagIndex].name;

      this.persistCourseTags(nextCourseTags);
      this.syncCurrentCoursesWithRenamedTag(oldName, newName);
      this.setData({
        showNewCourseInput: false,
        newCourseName: '',
        editingCourseTagIndex: -1
      });
      wx.showToast({ title: '修改成功', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message || '操作失败', icon: 'none' });
    }
  },

  // 长按修改或删除课程标签
  longPressCourseTag(e) {
    const { index } = e.currentTarget.dataset;
    const targetCourse = this.data.courseTags[index];
    if (!targetCourse) return;

    wx.showActionSheet({
      itemList: ['修改课程', '删除课程'],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.setData({
            showNewCourseInput: true,
            newCourseName: targetCourse.name,
            editingCourseTagIndex: index
          });
          return;
        }

        wx.showModal({
          title: '确认删除',
          content: `确定要删除课程"${targetCourse.name}"吗？`,
          success: (modalRes) => {
            if (!modalRes.confirm) return;

            try {
              const courseTags = deleteCourseTag(this.data.courseTags, index);
              this.persistCourseTags(courseTags);
              this.setData({
                showNewCourseInput: false,
                newCourseName: '',
                editingCourseTagIndex: -1
              });
              wx.showToast({ title: '删除成功', icon: 'success' });
            } catch (error) {
              wx.showToast({ title: error.message || '删除失败', icon: 'none' });
            }
          }
        });
      }
    });
  },

  onCourseDurationChange(e) {
    const { index } = e.currentTarget.dataset;
    const duration = e.detail.value;
    const courses = [...this.data.currentCourses];
    courses[index].duration = duration;
    this.setData({ currentCourses: courses });
  },

  deleteCourse(e) {
    const { index } = e.currentTarget.dataset;
    const courses = this.data.currentCourses.filter((_, i) => i !== index);
    this.setData({ currentCourses: courses });
  },

  getCourseColor(courseName) {
    // 课程标签颜色映射
    const colorMap = {
      '入门': '#F5E6DC',
      '提高': '#E8D5D0',
      '初级': '#E0CCB8',
      '初提': '#D8C3A6',
      '中级': '#D0AF90',
      '软开': '#C89B78',
      'PBT': '#C0A070',
      // 兼容旧课程名称（用于已保存的历史记录）
      '基训课': '#F5E6DC',
      '足尖课': '#E8D5D0',
      '剧目课': '#E0CCB8',
      '软开/拉伸': '#D8C3A6',
      '变奏课': '#D0AF90',
      '双人舞': '#C89B78',
      '性格舞': '#C0A070',
      '排练': '#B8A080'
    };
    return colorMap[courseName] || '#D8C0A8';
  },

  // ==================== 保存记录 ====================
  async saveRecord() {
    try {
      const { selectedDate, currentPhoto, currentNote, termsOptions, bodyPartsOptions, currentCourses } = this.data;

      // 从 termsOptions 中筛选出选中的术语
      const termsToSave = termsOptions
        .filter(item => item.selected)
        .map(item => item.name);

      // 从 bodyPartsOptions 中筛选出选中的部位
      const bodyPartsToSave = bodyPartsOptions
        .filter(item => item.selected)
        .map(item => item.name);

      // 过滤有效课程
      const validCourses = currentCourses.filter(c => c.name && c.name.trim());

      const record = {
        photo: currentPhoto,
        note: currentNote.trim(),
        terms: termsToSave,
        bodyParts: bodyPartsToSave,
        courses: validCourses,
        updatedAt: new Date().toISOString()
      };

      const allRecords = { ...this.data.allRecords };
      allRecords[selectedDate] = record;
      this.trackLocalMutation();

      await this.setDataAsync({
        records: normalizePageRecords(allRecords),
        allRecords: normalizePageRecords(allRecords)
      });
      wx.setStorageSync('balletMoodData', allRecords);

      this.closeEditModal();
      await this.renderCalendar();

      wx.showToast({
        title: '已保存',
        icon: 'success'
      });

      // 云端同步走精准单条更新（轻量路径）：只 update 这一条 dateKey 的云端文档，
      // 不再拉全量、不再重写其他记录；耗时约 1-2 秒，跨设备几乎能立即看到新记录
      this.syncSingleRecordInBackground(selectedDate, record);
    } catch (error) {
      wx.showModal({
        title: '保存失败',
        content: `错误信息: ${error.message || JSON.stringify(error)}`,
        showCancel: false
      });
    }
  },

  deleteRecord() {
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这条记录吗？',
      success: (res) => {
        if (res.confirm) {
          const allRecords = { ...this.data.allRecords };
          delete allRecords[this.data.selectedDate];
          this.trackLocalMutation();

          this.setData({
            records: normalizePageRecords(allRecords),
            allRecords: normalizePageRecords(allRecords)
          });
          wx.setStorageSync('balletMoodData', allRecords);
          this.syncCurrentSnapshotInBackground(allRecords, {
            replaceRecords: true,
            deletedRecordDates: [this.data.selectedDate]
          });

          this.closeEditModal();
          this.renderCalendar();
          wx.showToast({ title: '删除成功', icon: 'success' });
        }
      }
    });
  },

  // ==================== 本月目标 ====================
  saveGoal(e) {
    const goal = e.detail.value.trim();
    this.setData({ monthlyGoal: goal });
    wx.setStorageSync('balletMoodGoal', goal);
    this.trackLocalMutation();
    this.syncCurrentSnapshotInBackground();
  },

  // ==================== 明信片视图 ====================
  openPostcard(dateStr) {
    const record = this.data.allRecords[dateStr];
    if (!record) return;

    const [year, month, day] = dateStr.split('-');
    const date = new Date(year, month - 1, day);
    const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

    const bodyPartsList = (record.bodyParts || []).map(part => ({
      name: this.data.bodyPartsConfig[part]?.name || part
    }));

    // 兼容新旧术语数据
    let termsList = [];
    if (record.terms && Array.isArray(record.terms)) {
      // 新数据：terms 数组
      termsList = record.terms;
    } else if (record.term) {
      // 旧数据：term 字符串
      termsList = [record.term];
    }

    // 提取所有课程名称
    const courses = (record.courses || []).map(course => course.name).filter(name => name);

    this.setData({
      selectedDate: dateStr,
      showPostcard: true,
      postcardData: {
        day,
        month,
        year,
        weekday: weekdays[date.getDay()],
        photo: this.getRenderablePhoto(record.photo, dateStr),
        photoExpired: this.isPhotoExpired(dateStr),
        terms: termsList,
        note: record.note,
        bodyParts: bodyPartsList,
        courses: courses
      }
    });
  },

  closePostcard() {
    this.setData({ showPostcard: false });
  },

  editFromPostcard() {
    const date = this.data.selectedDate;
    this.closePostcard();
    setTimeout(() => {
      this.openEditModal(date);
    }, 100);
  },

  deleteFromPostcard() {
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这条记录吗？',
      success: (res) => {
        if (res.confirm) {
          const allRecords = { ...this.data.allRecords };
          delete allRecords[this.data.selectedDate];
          this.trackLocalMutation();

          this.setData({
            records: normalizePageRecords(allRecords),
            allRecords: normalizePageRecords(allRecords)
          });
          wx.setStorageSync('balletMoodData', allRecords);
          this.syncCurrentSnapshotInBackground(allRecords, {
            replaceRecords: true,
            deletedRecordDates: [this.data.selectedDate]
          });

          this.closePostcard();
          this.renderCalendar();
          wx.showToast({ title: '删除成功', icon: 'success' });
        }
      }
    });
  },

  // ==================== 工具函数 ====================
  formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  stopPropagation() {
    // 阻止事件冒泡
  }
});
