const BODY_PARTS_CONFIG = {
  '核心 Core': { name: '核心', color: '#F5E6DC' },
  '脚背 Arch': { name: '脚背', color: '#E8D5D0' },
  '外开 Turn-out': { name: '外开', color: '#E0CCB8' },
  '背部 Back': { name: '背部', color: '#D8C3A6' },
  '手臂 Arms': { name: '手臂', color: '#D0AF90' }
};

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

function getCourseColor(courseName) {
  return COURSE_COLOR_MAP[courseName] || '#D8C0A8';
}

function buildStatsSnapshot(allRecords = {}, { currentYear, currentMonth }) {
  const totalPeriodKey = toMonthKey(currentYear, currentMonth);
  let totalHours = 0;
  let totalDays = 0;
  let monthlyHours = 0;
  const bodyPartsCount = Object.keys(BODY_PARTS_CONFIG).reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});
  const courseHours = {};
  const monthlyStatsMap = {};

  Object.keys(allRecords).forEach((date) => {
    const record = allRecords[date];
    if (!record) return;

    const [year, month] = date.split('-').map(Number);
    const monthKey = toMonthKey(year, month);

    totalDays++;

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
        if (!course || !course.name || !course.name.trim()) {
          return;
        }

        const duration = parseFloat(course.duration) || 0;
        totalHours += duration;
        monthlyStatsMap[monthKey].hours += duration;

        if (monthKey === totalPeriodKey) {
          monthlyHours += duration;
        }

        if (!courseHours[course.name]) {
          courseHours[course.name] = 0;
        }
        courseHours[course.name] += duration;
      });
    }

    if (Array.isArray(record.bodyParts)) {
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

  const totalCourseHours = Object.values(courseHours).reduce((sum, hours) => sum + hours, 0);
  const courseDistribution = Object.entries(courseHours)
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

  const monthlySummaries = Object.values(monthlyStatsMap)
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
    .map((item) => ({
      ...item,
      hours: parseFloat(item.hours.toFixed(1))
    }));

  return {
    currentYear,
    currentMonth,
    totalHours,
    totalDays,
    monthlyHours,
    bodyPartsStats,
    courseDistribution,
    monthlySummaries
  };
}

module.exports = {
  BODY_PARTS_CONFIG,
  COURSE_COLOR_MAP,
  getCurrentStatsPeriod,
  getCourseColor,
  buildStatsSnapshot
};
