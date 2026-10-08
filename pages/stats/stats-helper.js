const BODY_PARTS_CONFIG = {
  '核心 Core': { name: '核心', color: '#F5E6DC' },
  '脚背 Arch': { name: '脚背', color: '#E8D5D0' },
  '外开 Turn-out': { name: '外开', color: '#E0CCB8' },
  '背部 Back': { name: '背部', color: '#D8C3A6' },
  '手臂 Arms': { name: '手臂', color: '#D0AF90' }
};
const { parseCourseDuration } = require('../index/course-duration-helper');

const COURSE_COLOR_MAP = {
  '入门': '#F5E6DC',
  '提高': '#E8D5D0',
  '初级': '#E0CCB8',
  '初提': '#D8C3A6',
  '中级': '#D0AF90',
  '软开': '#C89B78',
  'PBT': '#C0A070',
  '基训课': '#F5E6DC',
  '足尖课': '#E8D5D0',
  '剧目课': '#E0CCB8',
  '软开/拉伸': '#D8C3A6',
  '变奏课': '#D0AF90',
  '双人舞': '#C89B78',
  '性格舞': '#C0A070',
  '排练': '#B8A080'
};

function getCurrentStatsPeriod(now = new Date()) {
  return {
    currentYear: now.getFullYear(),
    currentMonth: now.getMonth() + 1
  };
}

function toMonthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function toPickerMonthValue(year, month) {
  return `${toMonthKey(year, month)}-01`;
}

function getMonthPickerBounds(allRecords = {}, now = new Date()) {
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const fallbackStartKey = toMonthKey(currentYear - 2, 1);
  const earliestRecordKey = Object.keys(allRecords)
    .map((date) => {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
      if (!match) return null;

      const year = Number(match[1]);
      const month = Number(match[2]);
      if (!year || month < 1 || month > 12) return null;
      return toMonthKey(year, month);
    })
    .filter(Boolean)
    .sort()[0];
  const startKey = earliestRecordKey && earliestRecordKey < fallbackStartKey
    ? earliestRecordKey
    : fallbackStartKey;

  return {
    monthPickerStart: `${startKey}-01`,
    monthPickerEnd: toPickerMonthValue(currentYear, currentMonth)
  };
}

function getYearPickerOptions(allRecords = {}, now = new Date(), selectedYear = now.getFullYear()) {
  const currentYear = now.getFullYear();
  const { monthPickerStart } = getMonthPickerBounds(allRecords, now);
  const earliestPickerYear = Number(String(monthPickerStart).slice(0, 4)) || currentYear - 2;
  const normalizedSelectedYear = Number.isInteger(Number(selectedYear))
    ? Math.min(Number(selectedYear), currentYear)
    : currentYear;
  const startYear = Math.min(earliestPickerYear, normalizedSelectedYear);
  const yearPickerOptions = [];

  for (let year = startYear; year <= currentYear; year++) {
    yearPickerOptions.push(`${year}年`);
  }

  return {
    yearPickerOptions,
    selectedYearIndex: Math.max(0, yearPickerOptions.indexOf(`${normalizedSelectedYear}年`))
  };
}

function getCourseColor(courseName) {
  return COURSE_COLOR_MAP[courseName] || '#D8C0A8';
}

function buildCourseDistribution(courseHours = {}) {
  const totalCourseHours = Object.values(courseHours).reduce((sum, hours) => sum + hours, 0);
  return Object.entries(courseHours)
    .sort((a, b) => b[1] - a[1])
    .map(([name, hours]) => {
      const percentage = totalCourseHours > 0 ? ((hours / totalCourseHours) * 100).toFixed(1) : 0;
      const color = getCourseColor(name);
      return {
        name,
        hours: parseFloat(hours.toFixed(1)),
        percentage: parseFloat(percentage),
        color,
        barStyle: `width:${percentage}%;background-color:${color}`
      };
    });
}

function parseRecordDateKey(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day, timestamp };
}

function getPracticeIntensity(hours) {
  if (hours > 2) return 'long';
  if (hours > 1) return 'medium';
  return 'short';
}

function buildPracticeCalendar(currentYear, currentMonth, practiceHoursByDay = {}) {
  const firstWeekday = new Date(currentYear, currentMonth - 1, 1).getDay();
  const leadingDays = (firstWeekday + 6) % 7;
  const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
  const previousMonthDays = new Date(currentYear, currentMonth - 1, 0).getDate();
  const totalCells = Math.ceil((leadingDays + daysInMonth) / 7) * 7;
  const calendarDays = [];

  for (let index = 0; index < totalCells; index++) {
    if (index < leadingDays) {
      calendarDays.push({
        key: `previous-${index}`,
        day: previousMonthDays - leadingDays + index + 1,
        isOutside: true,
        hasPractice: false,
        intensityClass: ''
      });
      continue;
    }

    const day = index - leadingDays + 1;
    if (day > daysInMonth) {
      calendarDays.push({
        key: `next-${day}`,
        day: day - daysInMonth,
        isOutside: true,
        hasPractice: false,
        intensityClass: ''
      });
      continue;
    }

    const hasPractice = Object.prototype.hasOwnProperty.call(practiceHoursByDay, day);
    const practiceHours = practiceHoursByDay[day] || 0;
    calendarDays.push({
      key: `current-${day}`,
      day,
      isOutside: false,
      hasPractice,
      practiceHours: parseFloat(practiceHours.toFixed(1)),
      intensityClass: hasPractice ? getPracticeIntensity(practiceHours) : ''
    });
  }

  const practiceDayNumbers = Object.keys(practiceHoursByDay)
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  let longestStreak = 0;
  let currentStreak = 0;
  let previousDay = null;

  practiceDayNumbers.forEach((day) => {
    currentStreak = previousDay !== null && day === previousDay + 1
      ? currentStreak + 1
      : 1;
    longestStreak = Math.max(longestStreak, currentStreak);
    previousDay = day;
  });

  return { calendarDays, longestStreak };
}

function buildStatsSnapshot(allRecords = {}, { currentYear, currentMonth }) {
  const totalPeriodKey = toMonthKey(currentYear, currentMonth);
  let totalHours = 0;
  let totalDays = 0;
  let monthlyHours = 0;
  let monthlyDays = 0;
  let monthlyLessons = 0;
  const bodyPartsCount = Object.keys(BODY_PARTS_CONFIG).reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});
  const courseHours = {};
  const monthlyStatsMap = {};
  const practiceHoursByDay = {};

  Object.keys(allRecords).forEach((date) => {
    const record = allRecords[date];
    const parsedDate = parseRecordDateKey(date);
    if (!record || !parsedDate) return;

    const { year, month, day } = parsedDate;
    const monthKey = toMonthKey(year, month);
    const isSelectedMonth = monthKey === totalPeriodKey;

    totalDays++;
    if (isSelectedMonth) {
      monthlyDays++;
      practiceHoursByDay[day] = 0;
    }

    if (!monthlyStatsMap[monthKey]) {
      monthlyStatsMap[monthKey] = {
        monthKey,
        year,
        month,
        hours: 0,
        days: 0
      };
    }
    monthlyStatsMap[monthKey].days += 1;

    if (Array.isArray(record.courses) && record.courses.length > 0) {
      record.courses.forEach((course) => {
        if (!course || typeof course.name !== 'string' || !course.name.trim()) {
          return;
        }

        const duration = parseCourseDuration(course.duration);
        if (duration === null) return;
        const courseName = course.name.trim();
        totalHours += duration;
        monthlyStatsMap[monthKey].hours += duration;

        if (isSelectedMonth) {
          monthlyHours += duration;
          monthlyLessons++;
          practiceHoursByDay[day] += duration;
          if (!courseHours[courseName]) {
            courseHours[courseName] = 0;
          }
          courseHours[courseName] += duration;
        }
      });
    }

    if (isSelectedMonth && Array.isArray(record.bodyParts)) {
      record.bodyParts.forEach((partName) => {
        if (bodyPartsCount[partName] !== undefined) {
          bodyPartsCount[partName]++;
        }
      });
    }
  });

  totalHours = parseFloat(totalHours.toFixed(1));
  monthlyHours = parseFloat(monthlyHours.toFixed(1));

  const bodyPartsStats = Object.entries(bodyPartsCount)
    .filter(([_, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([part, count]) => ({
      name: BODY_PARTS_CONFIG[part].name,
      fullName: part,
      count,
      color: BODY_PARTS_CONFIG[part].color,
      bubbleSize: 100 + count * 20,
      bubbleStyle: `background-color:${BODY_PARTS_CONFIG[part].color}`
    }));

  const courseDistribution = buildCourseDistribution(courseHours);

  const monthlySummaries = Object.values(monthlyStatsMap)
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
    .map((item) => ({
      ...item,
      hours: parseFloat(item.hours.toFixed(1))
    }));
  const { calendarDays, longestStreak } = buildPracticeCalendar(
    currentYear,
    currentMonth,
    practiceHoursByDay
  );

  return {
    currentYear,
    currentMonth,
    totalHours,
    totalDays,
    monthlyHours,
    monthlyDays,
    monthlyLessons,
    bodyPartsStats,
    courseDistribution,
    monthlySummaries,
    calendarDays,
    longestStreak
  };
}

function buildAnnualStatsSnapshot(allRecords = {}, { annualYear }) {
  let annualHours = 0;
  let annualDays = 0;
  let annualLessons = 0;
  const monthHours = Array(12).fill(0);
  const courseHours = {};
  const practiceTimestamps = [];

  Object.keys(allRecords).forEach((dateKey) => {
    const record = allRecords[dateKey];
    const parsedDate = parseRecordDateKey(dateKey);
    if (!record || !parsedDate || parsedDate.year !== annualYear) return;

    annualDays++;
    practiceTimestamps.push(parsedDate.timestamp);

    if (!Array.isArray(record.courses)) return;
    record.courses.forEach((course) => {
      if (!course || typeof course.name !== 'string' || !course.name.trim()) return;

      const duration = parseCourseDuration(course.duration);
      if (duration === null) return;
      const courseName = course.name.trim();
      annualHours += duration;
      annualLessons++;
      monthHours[parsedDate.month - 1] += duration;
      courseHours[courseName] = (courseHours[courseName] || 0) + duration;
    });
  });

  practiceTimestamps.sort((a, b) => a - b);
  let annualLongestStreak = 0;
  let currentStreak = 0;
  let previousTimestamp = null;
  practiceTimestamps.forEach((timestamp) => {
    currentStreak = previousTimestamp !== null && timestamp - previousTimestamp === 86400000
      ? currentStreak + 1
      : 1;
    annualLongestStreak = Math.max(annualLongestStreak, currentStreak);
    previousTimestamp = timestamp;
  });

  const roundedMonthHours = monthHours.map((hours) => parseFloat(hours.toFixed(1)));
  const maxMonthHours = Math.max(...roundedMonthHours);
  const bestMonthIndex = maxMonthHours > 0 ? roundedMonthHours.indexOf(maxMonthHours) : -1;
  const annualMonthlyBars = roundedMonthHours.map((hours, index) => {
    const height = maxMonthHours > 0 && hours > 0
      ? Math.max(parseFloat(((hours / maxMonthHours) * 100).toFixed(1)), 5)
      : 0;
    return {
      month: index + 1,
      hours,
      isBest: index === bestMonthIndex,
      barStyle: `height:${height}%`
    };
  });

  return {
    annualYear,
    annualHours: parseFloat(annualHours.toFixed(1)),
    annualDays,
    annualLessons,
    annualLongestStreak,
    annualMonthlyBars,
    annualCourseDistribution: buildCourseDistribution(courseHours),
    annualBestMonthLabel: bestMonthIndex >= 0 ? `${bestMonthIndex + 1}月` : '暂无',
    annualBestMonthDetail: bestMonthIndex >= 0 ? `练习最多 · ${maxMonthHours}小时` : '还没有练习记录'
  };
}

module.exports = {
  BODY_PARTS_CONFIG,
  COURSE_COLOR_MAP,
  getCurrentStatsPeriod,
  getMonthPickerBounds,
  getYearPickerOptions,
  toPickerMonthValue,
  getCourseColor,
  buildCourseDistribution,
  buildPracticeCalendar,
  buildStatsSnapshot,
  buildAnnualStatsSnapshot
};
