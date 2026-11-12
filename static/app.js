(function () {
  var STORAGE_KEY = "today-demo-v1";
  var WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
  var AREAS = ["工作", "副业", "健康", "孩子", "家庭", "父母", "学习", "生活"];
  var HOME_AREAS = ["工作", "健康", "副业", "孩子", "父母", "生活", "其他"];

  function iso(date) {
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
  }

  function pad(number) {
    return String(number).padStart(2, "0");
  }

  function parseISO(value) {
    var parts = value.split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function addDays(date, count) {
    var next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    next.setDate(next.getDate() + count);
    return next;
  }

  function mondayOf(date) {
    var day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var delta = day.getDay() === 0 ? -6 : 1 - day.getDay();
    day.setDate(day.getDate() + delta);
    return day;
  }

  function toMin(value) {
    var parts = value.split(":").map(Number);
    return parts[0] * 60 + parts[1];
  }

  function fromMin(mins) {
    return pad(Math.floor(mins / 60)) + ":" + pad(mins % 60);
  }

  function weekdayName(value) {
    return "周" + WEEKDAYS[parseISO(value).getDay()];
  }

  function monthDay(value) {
    var date = parseISO(value);
    return (date.getMonth() + 1) + "月" + date.getDate() + "日";
  }

  function formatHours(mins) {
    var hours = Math.floor(mins / 60);
    var rest = mins % 60;
    if (hours && rest) return hours + " 小时 " + rest + " 分";
    if (hours) return hours + " 小时";
    return rest + " 分钟";
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function uid(prefix) {
    return prefix + Math.random().toString(36).slice(2, 8);
  }

  function defaultSettings() {
    return {
      wake: "07:00",
      sleep: "23:00",
      workStart: "09:30",
      workEnd: "18:30",
      personalWeekday: 90,
      personalWeekend: 180,
      remindAt: "08:00",
      eveningCheck: "21:30",
      weeklyReview: { weekday: 0, time: "20:30" },
      workdays: [1, 2, 3, 4, 5],
      areas: { "工作": 3, "副业": 3, "健康": 2, "孩子": 3, "家庭": 2, "父母": 2, "学习": 2, "生活": 1 },
      fixed: [
        { id: "work", title: "工作时间", weekdays: [1, 2, 3, 4, 5], start: "09:30", end: "18:30", kind: "block" }
      ]
    };
  }

  function capacityFor(day, settings) {
    var weekend = day.getDay() === 0 || day.getDay() === 6;
    var cap = weekend ? Number(settings.personalWeekend) : Number(settings.personalWeekday);
    settings.fixed.forEach(function (item) {
      if (item.kind === "block" || item.bindTask) return;
      if (item.weekdays.indexOf(day.getDay()) === -1) return;
      cap -= toMin(item.end) - toMin(item.start);
    });
    return Math.max(0, cap);
  }

  function findGap(base, duration, occupied, latest) {
    var start = base;
    var blocks = occupied.slice().sort(function (a, b) { return a.start - b.start; });
    for (var guard = 0; guard < 8; guard += 1) {
      var hit = null;
      for (var i = 0; i < blocks.length; i += 1) {
        if (start < blocks[i].end && start + duration > blocks[i].start) hit = blocks[i];
      }
      if (!hit) return start + duration <= latest ? start : null;
      start = hit.end;
    }
    return null;
  }

  function reasonFor(task, mode) {
    if (mode === "fixed") return "这天本来就有这个固定安排";
    if (mode === "due" && task.area === "工作") return "放在截止当天的工作时间里";
    if (mode === "due") return "截止日期是这一天，优先排在当天";
    if (mode === "earlier" && task.area === "工作") return "截止当天的工作时间已满，提前到前一个工作日";
    if (mode === "earlier") return "截止当天已经满了，提前到还来得及的一天";
    if (task.area && mode === "open") return "没有硬截止日期，按你的关注程度放进空档";
    return "按空闲时间安排";
  }

  function compareTasks(a, b) {
    var rank = { "高": 0, "中": 1, "低": 2 };
    var ar = rank[a.priority] == null ? 1 : rank[a.priority];
    var br = rank[b.priority] == null ? 1 : rank[b.priority];
    if (ar !== br) return ar - br;
    if (a.due && b.due && a.due !== b.due) return a.due < b.due ? -1 : 1;
    if (a.due && !b.due) return -1;
    if (!a.due && b.due) return 1;
    return b.minutes - a.minutes;
  }

  function makePlanItem(task, day, start, mode) {
    return {
      id: "p-" + task.id + "-" + iso(day),
      taskId: task.id,
      title: task.title,
      area: task.area,
      priority: task.priority,
      minutes: task.minutes,
      date: iso(day),
      start: start,
      end: start + task.minutes,
      focus: false,
      checkable: true,
      state: "pending",
      reason: reasonFor(task, mode)
    };
  }

  function generateWeek(weekStart, tasks, settings) {
    var days = [];
    for (var i = 0; i < 7; i += 1) days.push(addDays(weekStart, i));
    var usedPersonal = {};
    var personalCount = {};
    var workCount = {};
    var occupied = {};
    days.forEach(function (day) {
      var key = iso(day);
      occupied[key] = [];
      settings.fixed.forEach(function (item) {
        if (item.kind === "block" || item.weekdays.indexOf(day.getDay()) === -1) return;
        occupied[key].push({ start: toMin(item.start), end: toMin(item.end) });
      });
    });

    var items = [];
    var unscheduled = [];
    tasks.slice().sort(compareTasks).forEach(function (task) {
      var placed = placeTask(task, days, settings, usedPersonal, personalCount, workCount, occupied);
      if (placed) items.push(placed);
      else unscheduled.push(task.id);
    });
    markFocus(items);
    return { start: iso(weekStart), status: "draft", items: items, unscheduled: unscheduled };
  }

  function placeTask(task, days, settings, usedPersonal, personalCount, workCount, occupied) {
    if (task.bind) {
      var bound = null;
      settings.fixed.forEach(function (item) {
        if (item.bindTask === task.bind) bound = item;
      });
      if (bound) {
        var boundDay = null;
        days.forEach(function (day) {
          if (bound.weekdays.indexOf(day.getDay()) === -1) return;
          if (task.due && iso(day) > task.due) return;
          boundDay = day;
        });
        if (boundDay) {
          var boundKey = iso(boundDay);
          var boundStart = toMin(bound.start);
          usedPersonal[boundKey] = (usedPersonal[boundKey] || 0) + task.minutes;
          personalCount[boundKey] = (personalCount[boundKey] || 0) + 1;
          occupied[boundKey].push({ start: boundStart, end: boundStart + task.minutes });
          return makePlanItem(task, boundDay, boundStart, "fixed");
        }
      }
    }

    var candidates = days.filter(function (day) {
      if (task.due && iso(day) > task.due) return false;
      if (task.area === "工作" && settings.workdays.indexOf(day.getDay()) === -1) return false;
      return true;
    });
    if (!task.due) {
      candidates.sort(function (a, b) {
        var weightA = settings.areas[task.area] || 2;
        var weightB = settings.areas[task.area] || 2;
        if (weightA < 2 || weightB < 2) return iso(b).localeCompare(iso(a));
        return iso(a).localeCompare(iso(b));
      });
    } else {
      candidates.sort(function (a, b) { return iso(b).localeCompare(iso(a)); });
    }

    for (var i = 0; i < candidates.length; i += 1) {
      var day = candidates[i];
      var key = iso(day);
      var work = task.area === "工作";
      if (work && (workCount[key] || 0) >= 2) continue;
      var personalLimit = day.getDay() === 0 || day.getDay() === 6 ? 3 : 2;
      if (!work && (personalCount[key] || 0) >= personalLimit) continue;
      if (!work && (usedPersonal[key] || 0) + task.minutes > capacityFor(day, settings)) continue;
      var start = work
        ? findGap(10 * 60, task.minutes, occupied[key], 18 * 60)
        : findGap((day.getDay() === 0 || day.getDay() === 6 ? 10 : 19) * 60, task.minutes, occupied[key], 22 * 60);
      if (start == null) continue;
      if (work) workCount[key] = (workCount[key] || 0) + 1;
      else {
        personalCount[key] = (personalCount[key] || 0) + 1;
        usedPersonal[key] = (usedPersonal[key] || 0) + task.minutes;
      }
      occupied[key].push({ start: start, end: start + task.minutes });
      var mode = !task.due ? "open" : key === task.due ? "due" : "earlier";
      return makePlanItem(task, day, start, mode);
    }
    return null;
  }

  function markFocus(items) {
    var ranked = items.filter(function (item) { return item.priority === "高"; })
      .sort(function (a, b) { return b.minutes - a.minutes; })
      .slice(0, 3)
      .map(function (item) { return item.id; });
    items.forEach(function (item) { item.focus = ranked.indexOf(item.id) !== -1; });
  }

  function currentItem(task, date, start, done, focus, reason) {
    return {
      id: "c-" + task.id,
      taskId: task.id,
      title: task.title,
      area: task.area,
      priority: task.priority,
      minutes: task.minutes,
      date: date,
      start: start,
      end: start + task.minutes,
      focus: focus,
      checkable: true,
      state: done ? "done" : "pending",
      reason: reason
    };
  }

  function buildCurrent(today) {
    var start = mondayOf(today);
    var todayIso = iso(today);
    var index = (today.getDay() + 6) % 7;
    var tasks = [];
    var items = [];

    function addPast(offset, task, startMin) {
      if (offset >= index) return;
      task.bucket = "current";
      task.status = "done";
      tasks.push(task);
      items.push(currentItem(task, iso(addDays(start, offset)), startMin, true, false, "这天已经做完"));
    }

    addPast(0, { id: "c-mon-work", title: "处理一件拖着的工作", area: "工作", priority: "高", minutes: 60, goalId: "g-work" }, 10 * 60);
    addPast(0, { id: "c-mon-walk", title: "散步", area: "健康", priority: "中", minutes: 20, goalId: "g-move" }, 19 * 60);
    addPast(1, { id: "c-tue-topic", title: "收集素材", area: "副业", priority: "高", minutes: 45, goalId: "g-post" }, 19 * 60);
    addPast(2, { id: "c-wed-sport", title: "运动", area: "健康", priority: "高", minutes: 40, goalId: "g-move" }, 19 * 60);

    var weekend = today.getDay() === 0 || today.getDay() === 6;
    var todayTasks = weekend ? [
      { id: "c-today-family", title: "把家里今天要办的事做完", area: "家庭", priority: "高", minutes: 60, goalId: "g-family", start: 10 * 60, focus: true, reason: "周末的个人时间更完整，把家里的事放在上午" },
      { id: "c-today-side", title: "推进副业最关键的一步", area: "副业", priority: "高", minutes: 45, goalId: "g-post", start: 14 * 60, focus: true, reason: "这是今天最需要推进的一件" },
      { id: "c-today-parent", title: "给父母打电话，问体检档期", area: "父母", priority: "高", minutes: 15, goalId: "g-parent", start: 16 * 60, focus: true, reason: "事情短，放在下午，避免拖过这周" }
    ] : [
      { id: "c-today-work", title: "把最重要的工作收个尾", area: "工作", priority: "高", minutes: 60, goalId: "g-work", start: 10 * 60, focus: true, reason: "放在工作时间的上午，晚上留给自己的事" },
      { id: "c-today-walk", title: "晚饭后散步", area: "健康", priority: "中", minutes: 20, goalId: "g-move", start: 18 * 60 + 45, focus: false, reason: "工作日的个人时间从傍晚开始" },
      { id: "c-today-side", title: "推进副业最关键的一步", area: "副业", priority: "高", minutes: 40, goalId: "g-post", start: 20 * 60, focus: true, reason: "今天的重点放在这一小段，不把整晚排满" },
      { id: "c-today-parent", title: "给父母打电话，问体检档期", area: "父母", priority: "高", minutes: 15, goalId: "g-parent", start: 21 * 60 + 10, focus: true, reason: "十五分钟能做完，单独留出一个提醒" }
    ];
    todayTasks.forEach(function (task) {
      tasks.push({ id: task.id, title: task.title, area: task.area, priority: task.priority, minutes: task.minutes, goalId: task.goalId, bucket: "current", status: "planned", type: "一次性" });
      items.push(currentItem(task, todayIso, task.start, false, task.focus, task.reason));
    });

    function addFuture(offset, task, startMin, reason) {
      if (offset <= index) return;
      task.bucket = "current";
      task.status = "planned";
      tasks.push(task);
      items.push(currentItem(task, iso(addDays(start, offset)), startMin, false, false, reason));
    }
    addFuture(4, { id: "c-fri-work", title: "整理这周的工作", area: "工作", priority: "中", minutes: 40, goalId: "g-work" }, 10 * 60, "留在周五的工作时间里收口");
    addFuture(5, { id: "c-sat-side", title: "把副业的一篇东西写完", area: "副业", priority: "高", minutes: 70, goalId: "g-post" }, 11 * 60 + 30, "周六上午先陪孩子，写东西放在后面");
    addFuture(6, { id: "c-sun-family", title: "处理家里的事", area: "家庭", priority: "中", minutes: 60, goalId: "g-family" }, 10 * 60, "周日上午时间完整");
    addFuture(6, { id: "c-sun-review", title: "每周复盘", area: "生活", priority: "中", minutes: 20, goalId: null }, 11 * 60 + 10, "一周的最后看一遍完成情况");

    return {
      tasks: tasks,
      week: { start: iso(start), status: "confirmed", items: items, unscheduled: [] }
    };
  }

  function nextWeekTasks(nextStart) {
    function due(offset) {
      return offset == null ? null : iso(addDays(nextStart, offset));
    }
    return [
      { id: "n-work", title: "处理工作待办", area: "工作", priority: "高", minutes: 60, due: due(0), type: "一次性", bucket: "next", status: "inbox", goalId: "g-work" },
      { id: "n-topic", title: "公众号选题与素材收集", area: "副业", priority: "高", minutes: 45, due: due(1), type: "一次性", bucket: "next", status: "inbox", goalId: "g-post" },
      { id: "n-sport", title: "运动", area: "健康", priority: "高", minutes: 40, due: due(2), type: "每周", bucket: "next", status: "inbox", goalId: "g-move", bind: "运动" },
      { id: "n-write", title: "公众号文章写作", area: "副业", priority: "高", minutes: 90, due: due(3), type: "一次性", bucket: "next", status: "inbox", goalId: "g-post" },
      { id: "n-publish", title: "文章发布", area: "副业", priority: "高", minutes: 30, due: due(5), type: "一次性", bucket: "next", status: "inbox", goalId: "g-post" },
      { id: "n-follow", title: "工作事项跟进", area: "工作", priority: "中", minutes: 45, due: due(2), type: "一次性", bucket: "next", status: "inbox", goalId: "g-work" },
      { id: "n-wrap", title: "本周工作整理", area: "工作", priority: "中", minutes: 40, due: due(4), type: "一次性", bucket: "next", status: "inbox", goalId: "g-work" },
      { id: "n-walk", title: "散步", area: "健康", priority: "中", minutes: 20, due: null, type: "每周", bucket: "next", status: "inbox", goalId: "g-move" },
      { id: "n-study", title: "个人学习", area: "学习", priority: "中", minutes: 45, due: due(5), type: "一次性", bucket: "next", status: "inbox", goalId: "g-learn" },
      { id: "n-family", title: "家庭事务", area: "家庭", priority: "中", minutes: 60, due: due(6), type: "一次性", bucket: "next", status: "inbox", goalId: "g-family" },
      { id: "n-review", title: "每周复盘", area: "生活", priority: "中", minutes: 20, due: due(6), type: "每周", bucket: "next", status: "inbox", goalId: null },
      { id: "n-docs", title: "整理家庭证件", area: "生活", priority: "低", minutes: 120, due: due(6), type: "一次性", bucket: "next", status: "inbox", goalId: "g-family" },
      { id: "n-hold", title: "下个月给父母安排体检", area: "父母", priority: "中", minutes: 30, due: null, type: "一次性", bucket: "next", status: "inbox", hold: true, goalId: "g-parent" },
      { id: "n-desk", title: "周末把书桌整理一下", area: "生活", priority: "低", minutes: 40, due: null, type: "一次性", bucket: "next", status: "inbox", hold: true, goalId: null }
    ];
  }

  function seedHomeTasks(today) {
    function on(offset) { return iso(addDays(today, offset)); }
    return [
      { id: "h-over", title: "回复一封拖着的邮件", area: "工作", priority: "高", minutes: 20, taskDate: on(-1), remindDate: on(-1), remindTime: "18:00", status: "pending", completedAt: "", completedOn: "", snoozeUntil: "" },
      { id: "h-work", title: "整理这周的工作", area: "工作", priority: "中", minutes: 40, taskDate: on(0), remindDate: on(0), remindTime: "10:00", status: "pending", completedAt: "", completedOn: "", snoozeUntil: "" },
      { id: "h-walk", title: "晚饭后散步", area: "健康", priority: "中", minutes: 20, taskDate: on(0), remindDate: on(0), remindTime: "18:45", status: "pending", completedAt: "", completedOn: "", snoozeUntil: "" },
      { id: "h-kid", title: "给孩子准备明天要用的东西", area: "孩子", priority: "高", minutes: 15, taskDate: on(0), remindDate: on(0), remindTime: "20:00", status: "pending", completedAt: "", completedOn: "", snoozeUntil: "" },
      { id: "h-desk", title: "把书桌收一收", area: "生活", priority: "低", minutes: 30, taskDate: on(0), remindDate: "", remindTime: "", status: "pending", completedAt: "", completedOn: "", snoozeUntil: "" },
      { id: "h-done", title: "早上看一眼今天的安排", area: "生活", priority: "低", minutes: null, taskDate: on(0), remindDate: on(0), remindTime: "08:00", status: "done", completedAt: "08:10", completedOn: on(0), snoozeUntil: "" },
      { id: "h-tom", title: "整理家里的药箱", area: "父母", priority: "中", minutes: 30, taskDate: on(1), remindDate: on(1), remindTime: "10:30", status: "pending", completedAt: "", completedOn: "", snoozeUntil: "" },
      { id: "h-sun", title: "出门走一走", area: "健康", priority: "中", minutes: 40, taskDate: on(2), remindDate: on(2), remindTime: "16:00", status: "pending", completedAt: "", completedOn: "", snoozeUntil: "" },
      { id: "h-exam", title: "带父母去体检", area: "父母", priority: "高", minutes: 120, taskDate: on(4), remindDate: on(3), remindTime: "20:00", status: "pending", completedAt: "", completedOn: "", snoozeUntil: "" },
      { id: "h-far", title: "预约下一次家庭聚餐", area: "生活", priority: "低", minutes: null, taskDate: on(10), remindDate: on(9), remindTime: "19:00", status: "pending", completedAt: "", completedOn: "", snoozeUntil: "" }
    ];
  }

  function seedEvents(today) {
    function on(offset) { return iso(addDays(today, offset)); }
    return [
      { id: "e-exam", title: "带父母去体检", date: on(4), area: "父母", note: "提前一晚提醒。带上医保卡、身份证和上次的检查报告。" },
      { id: "e-meet", title: "孩子的家长会", date: on(6), area: "孩子", note: "问这学期需要准备的东西，以及平时怎么配合。" },
      { id: "e-dinner", title: "家庭聚餐", date: on(9), area: "生活", note: "先问父母想吃什么，再定时间和地点。" }
    ];
  }

  function blankWeek(start, status) {
    return { start: iso(start), status: status, items: [], unscheduled: [] };
  }

  function createInitialState() {
    var today = new Date();
    return {
      version: 4,
      view: "today",
      homeTab: "today",
      weekTab: "this",
      railIndex: null,
      taskScope: "today",
      boardMode: "cards",
      laterMonth: null,
      goalCalendar: null,
      homeTasks: [],
      events: [],
      customReminders: [],
      doneOpen: false,
      menuId: "",
      rescheduleOpen: false,
      notified: {},
      settings: defaultSettings(),
      goals: [],
      tasks: [],
      currentWeek: blankWeek(mondayOf(today), "confirmed"),
      nextWeek: blankWeek(addDays(mondayOf(today), 7), "draft"),
      todayStatus: { date: iso(today), status: "pending", summary: null },
      panel: null,
      dismissed: {},
      reminderNotes: {},
      resetArmed: false,
      toast: ""
    };
  }

  function schedulableNext(state) {
    return state.tasks.filter(function (task) {
      return task.bucket === "next" && !task.hold && task.status !== "dropped";
    });
  }

  function taskById(state, id) {
    for (var i = 0; i < state.tasks.length; i += 1) {
      if (state.tasks[i].id === id) return state.tasks[i];
    }
    return null;
  }

  function findItem(state, id) {
    var found = null;
    [state.currentWeek, state.nextWeek].forEach(function (week) {
      if (!week) return;
      week.items.forEach(function (item) {
        if (item.id === id) found = item;
      });
    });
    return found;
  }

  function activeItems(week) {
    return (week.items || []).filter(function (item) {
      return item.state !== "removed" && item.state !== "dropped";
    });
  }

  function todayIso() {
    return iso(new Date());
  }

  function syncToday(state) {
    var today = todayIso();
    if (!state.todayStatus || state.todayStatus.date !== today) {
      state.todayStatus = { date: today, status: "pending", summary: null };
    }
  }

  function itemsOn(state, date, includeUnconfirmed) {
    var items = [];
    if (state.currentWeek && state.currentWeek.start) {
      activeItems(state.currentWeek).forEach(function (item) {
        if (item.date === date) items.push(item);
      });
    }
    if (state.nextWeek && (includeUnconfirmed || state.nextWeek.status === "confirmed")) {
      activeItems(state.nextWeek).forEach(function (item) {
        if (item.date === date) items.push(item);
      });
    }
    items.sort(function (a, b) { return a.start - b.start; });
    return items;
  }

  function todayItems(state) {
    return itemsOn(state, todayIso(), false);
  }

  function weekStats(week) {
    var items = activeItems(week);
    return {
      count: items.length,
      minutes: items.reduce(function (sum, item) { return sum + item.minutes; }, 0),
      focus: items.filter(function (item) { return item.focus; }).length
    };
  }

  function fixedOn(settings, date) {
    var day = parseISO(date).getDay();
    return settings.fixed.filter(function (item) { return item.weekdays.indexOf(day) !== -1; });
  }

  function laterThisWeek(date) {
    var start = mondayOf(parseISO(date));
    var dates = [];
    for (var i = 0; i < 7; i += 1) {
      var value = iso(addDays(start, i));
      if (value > date) dates.push(value);
    }
    return dates;
  }

  function option(value, current, label) {
    return '<option value="' + esc(value) + '"' + (value === current ? " selected" : "") + ">" + esc(label) + "</option>";
  }

  function buttons(html) {
    return '<div class="actions">' + html + "</div>";
  }

  function xmlText(value) {
    return esc(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  }

  function sheetXml(name, rows) {
    var body = rows.map(function (row) {
      return "<Row>" + row.map(function (cell) {
        var number = typeof cell === "number" && isFinite(cell);
        var type = number ? "Number" : "String";
        return '<Cell><Data ss:Type="' + type + '">' + (number ? cell : xmlText(cell)) + "</Data></Cell>";
      }).join("") + "</Row>";
    }).join("");
    return '<Worksheet ss:Name="' + xmlText(name) + '"><Table>' + body + "</Table></Worksheet>";
  }

  function ideaStatus(task) {
    if (task.status === "done") return "已完成";
    if (task.status === "dropped") return "已取消";
    if (task.status === "planned") return "已排进计划";
    return "待安排";
  }

  function weekRows(week) {
    var rows = [["日期", "时间", "标题", "领域", "分钟", "状态", "重点", "说明"]];
    if (!week) return rows;
    activeItems(week).slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.start - b.start;
    }).forEach(function (item) {
      rows.push([
        item.date || "",
        fromMin(item.start),
        item.title || "",
        item.area || "",
        item.minutes == null ? "" : item.minutes,
        item.state === "done" ? "已完成" : "待完成",
        item.focus ? "是" : "",
        item.reason || ""
      ]);
    });
    return rows;
  }

  function exportWorkbook() {
    var homeRows = [["标题", "领域", "优先级", "分钟", "任务日期", "提醒日期", "提醒时间", "状态", "完成日期", "完成时间"]];
    (state.homeTasks || []).forEach(function (task) {
      homeRows.push([
        task.title, task.area || "", task.priority || "", task.minutes == null ? "" : task.minutes,
        task.taskDate || "", task.remindDate || "", task.remindTime || "", statusLabel(task),
        task.completedOn || "", task.completedAt || ""
      ]);
    });
    var ideaRows = [["标题", "领域", "优先级", "分钟", "类型", "截止日期", "状态", "先记着", "所属目标"]];
    (state.tasks || []).forEach(function (task) {
      var goal = goalById(state, task.goalId);
      ideaRows.push([
        task.title, task.area || "", task.priority || "", task.minutes == null ? "" : task.minutes,
        task.type || "", task.due || "", ideaStatus(task), task.hold ? "是" : "",
        goal ? goal.title : ""
      ]);
    });
    var goalRows = [["级别", "标题", "领域", "完成时间", "进度", "每周", "每周提醒", "每月", "每月日", "每月提醒"]];
    var planRows = [["目标", "安排", "日期", "分钟", "提醒日期", "提醒时间", "这一天的标注"]];
    (state.goals || []).forEach(function (goal) {
      var week = goal.weekPlan || {};
      var month = goal.monthPlan || {};
      var days = (week.weekdays || []).map(function (day) { return "周" + WEEKDAYS[day]; }).join("、");
      goalRows.push([
        goal.level || "", goal.title || "", goal.area || "", goal.due || "",
        goal.progress == null ? "" : goal.progress,
        week.title ? days + " " + week.title : "", week.remindTime || "",
        month.title || "", month.day || "", month.remindTime || ""
      ]);
      (goal.plan || []).forEach(function (step) {
        planRows.push([
          goal.title || "", step.title || "", step.date || "", step.minutes == null ? "" : step.minutes,
          step.remindDate || "", step.remindTime || "", (goal.dayNotes && step.date && goal.dayNotes[step.date]) || ""
        ]);
      });
      Object.keys(goal.dayNotes || {}).forEach(function (date) {
        var noted = (goal.plan || []).some(function (step) { return step.date === date; });
        if (!noted && goal.dayNotes[date]) planRows.push([goal.title || "", "", date, "", "", "", goal.dayNotes[date]]);
      });
    });
    var eventRows = [["标题", "日期", "分类", "记录", "提醒日期", "提醒时间"]];
    (state.events || []).forEach(function (item) {
      eventRows.push([item.title || "", item.date || "", item.area || "", item.note || "", item.remindDate || "", item.remindTime || ""]);
    });
    var reminders = allReminders(state);
    var remindRows = [["来源", "标题", "时间", "来自"]];
    reminders.created.concat(reminders.converted).forEach(function (item) {
      remindRows.push([item.source, item.title || "", item.when || "", item.from || ""]);
    });
    var settings = state.settings || {};
    var review = settings.weeklyReview || {};
    var settingRows = [
      ["项目", "内容"],
      ["起床", settings.wake || ""],
      ["睡觉", settings.sleep || ""],
      ["工作开始", settings.workStart || ""],
      ["工作结束", settings.workEnd || ""],
      ["工作日个人时间（分钟）", settings.personalWeekday == null ? "" : settings.personalWeekday],
      ["周末个人时间（分钟）", settings.personalWeekend == null ? "" : settings.personalWeekend],
      ["早上提醒", settings.remindAt || ""],
      ["晚上看一眼", settings.eveningCheck || ""],
      ["每周复盘", "周" + WEEKDAYS[review.weekday == null ? 0 : review.weekday] + " " + (review.time || "")],
      ["", ""],
      ["固定日程", "星期", "开始", "结束"]
    ];
    (settings.fixed || []).forEach(function (item) {
      var days = (item.weekdays || []).map(function (day) { return "周" + WEEKDAYS[day]; }).join("、");
      settingRows.push([item.title || "", days, item.start || "", item.end || ""]);
    });
    var xml = '<?xml version="1.0" encoding="UTF-8"?>' +
      '<?mso-application progid="Excel.Sheet"?>' +
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
      sheetXml("今天的事", homeRows) +
      sheetXml("想法", ideaRows) +
      sheetXml("本周安排", weekRows(state.currentWeek)) +
      sheetXml("下周安排", weekRows(state.nextWeek)) +
      sheetXml("目标", goalRows) +
      sheetXml("目标计划", planRows) +
      sheetXml("重要事件", eventRows) +
      sheetXml("提醒", remindRows) +
      sheetXml("作息", settingRows) +
      "</Workbook>";
    var blob = new Blob([xml], { type: "application/vnd.ms-excel" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "今天做什么-" + todayIso() + ".xls";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    commit("数据已导出。");
  }

  function renderShell(state) {
    syncToday(state);
    var nav = [
      ["today", "今天 · 本周", homeAttention(state) > 0 || (state.nextWeek && state.nextWeek.status === "draft")],
      ["pool", "想法池", false],
      ["goals", "目标", false],
      ["events", "重要事件", false],
      ["reminders", "提醒", false],
      ["settings", "作息", false]
    ].map(function (item) {
      var on = state.view === item[0] || (item[0] === "today" && state.view === "week");
      return '<button type="button" class="nav-btn' + (on ? " is-on" : "") + '" data-action="goto" data-view="' + item[0] + '">' +
        item[1] + (item[2] ? '<span class="dot"></span>' : "<span></span>") + "</button>";
    }).join("");
    return '<div class="shell">' +
      '<aside class="sidebar">' +
        '<p class="brand-kicker">个人计划管家</p>' +
        '<h1 class="brand">今天做什么</h1>' +
        '<p class="brand-note">今天和本周在这里切换。重要的事单独记成卡片。</p>' +
        '<nav class="nav">' + nav + "</nav>" +
        '<button type="button" class="btn export-btn" data-action="export-data">导出数据</button>' +
        '<div class="side-foot"><p>写下来的内容保存在这台电脑上。</p></div>' +
      "</aside>" +
      '<main class="main">' + renderView(state) + "</main></div>" +
      (state.toast ? '<div class="toast">' + esc(state.toast) + "</div>" : "") +
      renderModal(state);
  }

  function renderView(state) {
    if (state.view === "pool") return renderPool(state);
    if (state.view === "goals") return state.goalCalendar ? renderGoalCalendar(state) : renderGoals(state);
    if (state.view === "events") return renderEvents(state);
    if (state.view === "reminders") return renderReminders(state);
    if (state.view === "settings") return renderSettings(state);
    if (state.view === "week" || state.homeTab === "this" || state.homeTab === "next") {
      return renderWeek(state, state.homeTab === "next" ? "next" : "this");
    }
    return renderExecution(state);
  }

  function renderHome(state) {
    return renderExecution(state);
  }

  function renderBoardSwitch(state) {
    var onWeek = state.homeTab === "this" || state.homeTab === "next";
    function tabBtn(id, label, on) {
      return '<button type="button" class="tab' + (on ? " is-on" : "") + '" data-action="home-tab" data-tab="' + id + '">' + label + "</button>";
    }
    return '<div class="week-switch is-lead">' + tabBtn("today", "今天", !onWeek) + tabBtn("week", "本周", onWeek) + "</div>";
  }

  function renderHomeSwitch(state, tab) {
    function tabBtn(id, label) {
      return '<button type="button" class="tab' + (tab === id ? " is-on" : "") + '" data-action="home-tab" data-tab="' + id + '">' + label + "</button>";
    }
    var nextLabel = "下周建议" + (state.nextWeek.status === "draft" ? " · 待确认" : "");
    return '<div class="week-switch">' + tabBtn("this", "这周") + tabBtn("next", nextLabel) + "</div>";
  }

  function nowClock() {
    var date = new Date();
    return pad(date.getHours()) + ":" + pad(date.getMinutes());
  }

  function nowStamp() {
    return todayIso() + "T" + nowClock();
  }

  function plusMinutes(mins) {
    var date = new Date();
    date.setMinutes(date.getMinutes() + mins);
    return iso(date) + "T" + pad(date.getHours()) + ":" + pad(date.getMinutes());
  }

  function dayDiff(from, to) {
    return Math.round((parseISO(to) - parseISO(from)) / 86400000);
  }

  function fullDate(value) {
    var date = parseISO(value);
    return date.getFullYear() + "年" + (date.getMonth() + 1) + "月" + date.getDate() + "日 · 周" + WEEKDAYS[date.getDay()];
  }

  function homeOpen(task) {
    return task && task.status !== "done";
  }

  function priorityRank(priority) {
    return priority === "高" ? 0 : priority === "低" ? 2 : 1;
  }

  function remindStamp(task) {
    if (!task.remindTime) return "";
    return (task.remindDate || task.taskDate || "") + "T" + task.remindTime;
  }

  function sortHomeTasks(tasks) {
    var now = nowStamp();
    return tasks.slice().sort(function (a, b) {
      var aLate = remindStamp(a) && remindStamp(a) < now ? 0 : 1;
      var bLate = remindStamp(b) && remindStamp(b) < now ? 0 : 1;
      if (aLate !== bLate) return aLate - bLate;
      if (a.remindTime && !b.remindTime) return -1;
      if (!a.remindTime && b.remindTime) return 1;
      if (a.remindTime !== b.remindTime) return a.remindTime < b.remindTime ? -1 : 1;
      return priorityRank(a.priority) - priorityRank(b.priority);
    });
  }

  function homeTasks(state) {
    return state.homeTasks || [];
  }

  function overdueTasks(state) {
    var today = todayIso();
    return sortHomeTasks(homeTasks(state).filter(function (task) {
      return homeOpen(task) && task.taskDate && task.taskDate < today;
    }));
  }

  function todayOpenTasks(state) {
    var today = todayIso();
    return sortHomeTasks(homeTasks(state).filter(function (task) {
      return homeOpen(task) && task.taskDate === today;
    }));
  }

  function upcomingTasks(state) {
    var today = todayIso();
    return homeTasks(state).filter(function (task) {
      if (!homeOpen(task) || !task.taskDate) return false;
      var diff = dayDiff(today, task.taskDate);
      return diff >= 1 && diff <= 7;
    });
  }

  function laterTasks(state) {
    var today = todayIso();
    return homeTasks(state).filter(function (task) {
      return homeOpen(task) && task.taskDate && dayDiff(today, task.taskDate) > 7;
    });
  }

  function doneToday(state) {
    var today = todayIso();
    return homeTasks(state).filter(function (task) {
      return task.status === "done" && task.completedOn === today;
    }).sort(function (a, b) {
      return (a.completedAt || "") < (b.completedAt || "") ? -1 : 1;
    });
  }

  function dueAlerts(state) {
    var now = nowStamp();
    return homeTasks(state).filter(function (task) {
      if (!homeOpen(task) || !task.remindDate || !task.remindTime) return false;
      if (task.snoozeUntil && task.snoozeUntil > now) return false;
      return remindStamp(task) <= now;
    }).sort(function (a, b) {
      return remindStamp(a) < remindStamp(b) ? -1 : remindStamp(a) > remindStamp(b) ? 1 : 0;
    });
  }

  function homeAttention(state) {
    return overdueTasks(state).length + dueAlerts(state).length;
  }

  function remindLabel(task) {
    if (!task.remindTime) return "没有具体提醒时间";
    if (task.remindDate && task.remindDate !== task.taskDate) return "提醒 " + monthDay(task.remindDate) + " " + task.remindTime;
    return task.remindTime;
  }

  function statusLabel(task) {
    if (task.status === "done") return "已完成";
    if (task.status === "deferred") return "已延期";
    return "待完成";
  }

  function areaChoices(current) {
    var list = HOME_AREAS.slice();
    if (current && list.indexOf(current) === -1) list.push(current);
    return list;
  }

  function areaKind(area) {
    var kinds = {
      "工作": "work",
      "健康": "health",
      "副业": "side",
      "孩子": "child",
      "父母": "parent",
      "生活": "life",
      "家庭": "family",
      "学习": "study",
      "其他": "other"
    };
    return kinds[area] || "other";
  }

  function areaChip(area) {
    var name = area || "其他";
    return '<span class="kind kind-' + areaKind(name) + '"><i></i>' + esc(name) + "</span>";
  }

  function upcomingLabel(date, today) {
    var head = dayDiff(today, date) === 1 ? "明天" : weekdayName(date);
    return head + " · " + monthDay(date);
  }

  function renderCardRail(inner, name) {
    return '<div class="rail-wrap">' +
      '<button type="button" class="rail-btn" data-action="rail-shift" data-dir="-1" aria-label="向左">‹</button>' +
      '<div class="rail' + (name === "cards" ? " is-cards" : "") + '" data-rail="' + name + '">' + inner + "</div>" +
      '<button type="button" class="rail-btn" data-action="rail-shift" data-dir="1" aria-label="向右">›</button></div>';
  }

  function renderLane(label, sub, date, count, inner) {
    var today = date && date === todayIso();
    return '<section class="lane' + (today ? " is-today" : "") + '"' + (date ? ' data-drop-date="' + esc(date) + '"' : "") + ">" +
      "<header><span>" + esc(label) + "</span><strong>" + esc(sub) + "</strong><em>" + count + "</em></header>" +
      '<div class="lane-cards">' + inner + "</div></section>";
  }

  function renderTaskCard(state, task, options) {
    options = options || {};
    var showCheck = options.check !== false;
    var late = homeOpen(task) && remindStamp(task) && remindStamp(task) < nowStamp();
    var menu = state.menuId === task.id
      ? '<div class="menu-pop"><button type="button" class="btn tiny" data-action="home-edit" data-id="' + esc(task.id) + '">编辑</button>' +
        '<button type="button" class="btn tiny" data-action="home-delete" data-id="' + esc(task.id) + '">' + (state.menuDeleteId === task.id ? "确认删除" : "删除") + "</button></div>"
      : "";
    var done = task.status === "done";
    var check = !showCheck ? "" : (done
      ? '<button type="button" class="check is-done" disabled aria-label="已完成"></button>'
      : '<button type="button" class="check" data-action="home-done" data-id="' + esc(task.id) + '" aria-label="完成"></button>');
    var finish = done
      ? '<span class="status-chip is-done">已完成</span>'
      : '<button type="button" class="btn tiny primary" data-action="home-done" data-id="' + esc(task.id) + '">完成</button>';
    var drag = done ? "" : ' data-drag-id="' + esc(task.id) + '" data-drag-kind="home"';
    var defer = done ? "" : '<button type="button" class="btn tiny" data-action="home-defer" data-id="' + esc(task.id) + '">延期</button>';
    var more = '<div class="slot-actions">' + finish + defer +
      '<button type="button" class="btn tiny" data-action="home-menu" data-id="' + esc(task.id) + '">更多</button></div>' + menu;
    return '<article class="task-card' + (done ? " is-done" : "") + '"' + drag + ' data-action="home-edit" data-id="' + esc(task.id) + '">' +
      '<div class="card-top">' + check + "<h3>" + esc(task.title) + "</h3></div>" +
      '<div class="meta">' + areaChip(task.area) + "<span>" + esc(remindLabel(task)) + "</span>" +
      (task.minutes ? "<span>" + task.minutes + " 分钟</span>" : "") +
      (done && task.completedAt ? "<span>" + esc(task.completedAt) + "</span>" : "") +
      (late ? '<span class="tag">已到提醒时间</span>' : "") +
      "</div>" + more + "</article>";
  }

  function todayBoardTasks(state) {
    var today = todayIso();
    var seen = {};
    var list = [];
    (state.homeTasks || []).forEach(function (task) {
      if (seen[task.id]) return;
      if (task.taskDate !== today && task.completedOn !== today) return;
      seen[task.id] = true;
      list.push(task);
    });
    var pending = sortHomeTasks(list.filter(homeOpen));
    var done = list.filter(function (task) { return !homeOpen(task); });
    done.sort(function (a, b) { return a.completedAt < b.completedAt ? -1 : a.completedAt > b.completedAt ? 1 : 0; });
    return pending.concat(done);
  }

  function ensureLaterMonth(state) {
    var today = parseISO(todayIso());
    if (!state.laterMonth || !state.laterMonth.year || !state.laterMonth.month) {
      state.laterMonth = { year: today.getFullYear(), month: today.getMonth() + 1, date: todayIso() };
    }
    if (!state.laterMonth.date) state.laterMonth.date = iso(new Date(state.laterMonth.year, state.laterMonth.month - 1, 1));
    return state.laterMonth;
  }

  function tasksOnDate(state, date) {
    var list = (state.homeTasks || []).filter(function (task) { return task.taskDate === date; });
    var pending = sortHomeTasks(list.filter(homeOpen));
    var done = list.filter(function (task) { return !homeOpen(task); });
    done.sort(function (a, b) { return a.completedAt < b.completedAt ? -1 : a.completedAt > b.completedAt ? 1 : 0; });
    return pending.concat(done);
  }

  function renderModeSwitch(state) {
    var mode = state.boardMode === "calendar" ? "calendar" : "cards";
    function tab(id, label) {
      return '<button type="button" class="tab' + (mode === id ? " is-on" : "") + '" data-action="board-mode" data-mode="' + id + '">' + label + "</button>";
    }
    return '<div class="mode-switch">' + tab("cards", "卡片") + tab("calendar", "日历") + "</div>";
  }

  function renderSheetHead(state, title) {
    return '<div class="sheet-head"><h2>' + title + "</h2>" + renderModeSwitch(state) + "</div>";
  }

  function renderMonthBoard(state, config) {
    var view = ensureLaterMonth(state);
    var cells = calendarCells(view.year, view.month);
    var dayNames = [["一", 1], ["二", 2], ["三", 3], ["四", 4], ["五", 5], ["六", 6], ["日", 0]];
    var head = dayNames.map(function (day) { return '<span class="cal-dow">' + day[0] + "</span>"; }).join("");
    var days = cells.map(function (date) {
      var value = iso(date);
      var tasks = config.tasksOn(value);
      var outside = date.getMonth() !== view.month - 1;
      var mark = tasks.length > 1 ? String(tasks.length) : (tasks.length ? config.mark(tasks[0]) : "");
      var tone = tasks.length === 1 ? areaKind(config.area(tasks[0])) : "";
      var cls = "cal-day" + (outside ? " is-out" : "") + (value === view.date ? " is-on" : "") + (value === todayIso() ? " is-today" : "") + (tasks.length ? " has-note" : "");
      return '<button type="button" class="' + cls + '" data-action="later-pick" data-date="' + value + '"><strong>' + date.getDate() + "</strong>" +
        (mark ? '<em class="kind-text' + (tone ? " kind-" + tone : "") + '">' + esc(mark) + "</em>" : "") + "</button>";
    }).join("");
    var selected = config.tasksOn(view.date);
    var cards = selected.length ? config.cards(selected) : '<p class="empty">这一天没有安排。</p>';
    return '<section class="sheet">' + renderSheetHead(state, config.title) +
      '<p class="context">按月查看。可以翻到之前的月份，点一天就看到那天的事。</p>' +
      '<div class="cal-nav"><button type="button" class="btn tiny" data-action="later-shift" data-dir="-1">上个月</button><strong>' + view.year + "年" + view.month + '月</strong><button type="button" class="btn tiny" data-action="later-shift" data-dir="1">下个月</button></div>' +
      '<div class="cal">' + head + days + "</div></section>" +
      '<section class="sheet"><h2>' + esc(view.date ? weekdayName(view.date) + " " + monthDay(view.date) : "选择一天") + "</h2>" + cards + "</section>";
  }

  function homeMonthConfig(state) {
    return {
      title: "要做的事",
      tasksOn: function (date) { return tasksOnDate(state, date); },
      mark: function (task) { return task.title.slice(0, 6); },
      area: function (task) { return task.area; },
      cards: function (tasks) {
        return '<div class="task-grid">' + tasks.map(function (task) { return renderTaskCard(state, task, { check: false }); }).join("") + "</div>";
      }
    };
  }

  function laterGroups(state) {
    var today = todayIso();
    var groups = {};
    var order = [];
    (state.homeTasks || []).forEach(function (task) {
      if (!homeOpen(task) || !task.taskDate || task.taskDate <= today) return;
      if (!groups[task.taskDate]) {
        groups[task.taskDate] = [];
        order.push(task.taskDate);
      }
      groups[task.taskDate].push(task);
    });
    order.sort();
    return order.map(function (date) {
      var label = upcomingLabel(date, today).split(" · ")[0];
      return { label: label, sub: monthDay(date), date: date, tasks: sortHomeTasks(groups[date]) };
    });
  }

  function renderTaskScope(state) {
    var scope = state.taskScope === "later" ? "later" : "today";
    function tab(id, label) {
      return '<button type="button" class="tab' + (scope === id ? " is-on" : "") + '" data-action="task-scope" data-scope="' + id + '">' + label + "</button>";
    }
    return '<div class="week-switch">' + tab("today", "今天") + tab("later", "以后要做的事") + "</div>";
  }

  function renderExecution(state) {
    var today = todayIso();
    var open = todayOpenTasks(state);
    var done = doneToday(state);
    var todays = todayBoardTasks(state);
    var todayNote = "";
    if (!open.length) {
      todayNote = done.length
        ? '<p class="empty">今天的事情都完成了，做得不错。已完成 ' + done.length + " 件。</p>"
        : '<p class="empty">今天暂时没有安排。</p><p class="empty">可以先记录一件想做的事情。</p>' +
          buttons('<button type="button" class="btn primary" data-action="open-capture">记录一件事</button>');
    }
    var todayCards = todays.length
      ? '<div class="task-grid">' + todays.map(function (task) { return renderTaskCard(state, task, { check: false }); }).join("") + "</div>"
      : "";
    var todayHint = todays.some(homeOpen) ? '<p class="context">点完成，就会变成已完成。</p>' : "";
    var board = '<section class="sheet">' + renderSheetHead(state, "要做的事") + todayNote + todayHint + todayCards + "</section>";
    if (state.boardMode === "calendar") board = renderMonthBoard(state, homeMonthConfig(state));
    return renderBoardSwitch(state) +
      '<header class="page-head"><div><p class="kicker">今天</p><h1>' + esc(fullDate(today)) + '</h1><p class="lede">今天需要处理的事情都在这里。</p></div>' +
      '<button type="button" class="btn primary" data-action="open-capture">+ 记录一件事</button></header>' +
      board;
  }

  function renderReschedule(state, tasks) {
    if (!state.rescheduleOpen) return "";
    var rows = tasks.map(function (task) {
      return '<div class="choice-row"><p>' + esc(task.title) + " · 原定 " + esc(monthDay(task.taskDate)) + '</p><div class="choices">' +
        '<button type="button" class="btn tiny" data-action="reschedule-tomorrow" data-id="' + esc(task.id) + '">改到明天</button>' +
        '<input type="date" data-reschedule-date="' + esc(task.id) + '">' +
        '<button type="button" class="btn tiny" data-action="reschedule-one" data-id="' + esc(task.id) + '">改到选定日期</button></div></div>';
    }).join("");
    return '<section class="panel"><h2>重新安排</h2><p class="lede">选一个新的任务日期。没有选定之前，这些事不会堆进今天。</p>' + rows +
      buttons('<button type="button" class="btn" data-action="close-reschedule">收起</button>') + "</section>";
  }

  function renderToday(state) {
    var today = todayIso();
    var items = todayItems(state);
    var checkable = items.filter(function (item) { return item.checkable; });
    var done = checkable.filter(function (item) { return item.state === "done"; });
    var status = state.todayStatus.status;
    var executing = status === "executing";
    var focus = checkable.filter(function (item) { return item.focus; }).slice(0, 3);
    checkable.forEach(function (item) {
      if (focus.length < 3 && focus.indexOf(item) === -1) focus.push(item);
    });
    var percent = checkable.length ? Math.round(done.length / checkable.length * 100) : 0;
    var minutes = checkable.reduce(function (sum, item) { return sum + item.minutes; }, 0);
    var banner = "";
    if (status === "pending") {
      banner = '<section class="banner"><p>今天的安排已经生成。确认一次，就可以按它执行。</p>' +
        buttons('<button type="button" class="btn primary" data-action="confirm-today">按此执行</button>' +
          '<button type="button" class="btn" data-action="open-panel" data-mode="adjust">重新安排</button>' +
          '<button type="button" class="btn" data-action="toggle-add">添加临时任务</button>') +
        "</section>";
    } else if (status === "executing") {
      banner = '<section class="banner ok"><p>今天按这个执行。做完就勾上，晚上再决定没做完的事。</p>' +
        buttons('<button type="button" class="btn" data-action="open-panel" data-mode="adjust">重新安排</button>' +
          '<button type="button" class="btn" data-action="toggle-add">添加临时任务</button>' +
          '<button type="button" class="btn primary" data-action="open-panel" data-mode="close">完成今天</button>') +
        "</section>";
    } else {
      banner = renderClosed(state);
    }
    var morning = "";
    if (status !== "closed" && !state.dismissed["morning-" + today]) {
      morning = '<section class="banner"><p>' + esc(state.settings.remindAt) + " 的提醒：先看今天这几件，再决定要不要调整。</p>" +
        buttons('<button type="button" class="btn tiny" data-action="dismiss-morning">知道了</button>') + "</section>";
    }
    var nextNote = state.nextWeek.status === "draft"
      ? '<p class="context">下周的建议已经生成，确认后才会写进每天。<button type="button" class="linkish" data-action="home-tab" data-tab="next">去看下周</button></p>'
      : "";
    return '<header class="page-head"><div><p class="kicker">' + esc(weekdayName(today)) + "</p><h1>" + esc(monthDay(today)) + "</h1>" +
      '<p class="lede">系统先排好今天。你确认之后，才开始勾选和提醒。</p></div></header>' +
      morning + banner + nextNote +
      '<div class="summary-line"><span>' + checkable.length + " 件事</span><span>已完成 " + done.length + "</span><span>大约 " + esc(formatHours(minutes)) + '</span><div class="bar"><span style="width:' + percent + '%"></span></div></div>' +
      "<h2>今日重点</h2>" + renderFocus(focus) +
      "<h2>时间安排</h2>" + renderTimeline(state, today, items, executing) +
      renderPanel(state) +
      "<h2>今日总结</h2>" + renderDaySummary(state, checkable, done);
  }

  function renderClosed(state) {
    var summary = state.todayStatus.summary || { done: [], moved: [], pooled: [], dropped: [] };
    function line(title, list) {
      if (!list.length) return "";
      return "<p>" + title + "：" + esc(list.join("、")) + "</p>";
    }
    return '<section class="banner ok"><p>今天已经收尾。</p>' +
      line("完成", summary.done) + line("改期", summary.moved) + line("放回待安排", summary.pooled) + line("取消", summary.dropped) +
      buttons('<button type="button" class="btn" data-action="reopen-today">重新打开今天</button>') + "</section>";
  }

  function renderFocus(items) {
    if (!items.length) return '<p class="empty">今天还没有重点。</p>';
    return '<div class="focus-grid">' + items.map(function (item, index) {
      return '<article class="focus-card"><p class="index">0' + (index + 1) + "</p><h3>" + esc(item.title) + "</h3><p>" +
        esc(fromMin(item.start)) + " · " + item.minutes + " 分钟</p>" + areaChip(item.area) + "</article>";
    }).join("") + "</div>";
  }

  function renderTimeline(state, today, items, executing) {
    var weekend = parseISO(today).getDay() === 0 || parseISO(today).getDay() === 6;
    var context = weekend
      ? "周末的个人时间从上午开始。固定日程会先占住原来的时段。"
      : "工作时间是 " + state.settings.workStart + "–" + state.settings.workEnd + "。个人的事排在傍晚之后。";
    var fixed = fixedOn(state.settings, today).filter(function (item) {
      return item.kind === "fixed" && !items.some(function (plan) { return plan.title === item.title; });
    });
    var fixedHtml = fixed.map(function (item) {
      return '<div class="slot"><div class="when">' + esc(item.start) + '</div><div><h3>' + esc(item.title) + '</h3><div class="meta"><span>固定日程</span>' + areaChip(item.area) + "</div></div><div></div></div>";
    }).join("");
    var rows = items.map(function (item) {
      var done = item.state === "done";
      return '<div class="slot' + (done ? " is-done" : "") + '"><div class="when">' + esc(fromMin(item.start)) + "</div><div><h3>" + esc(item.title) + '</h3><div class="meta">' + areaChip(item.area) + "<span>" + item.minutes + " 分钟</span>" +
        (item.focus ? '<span class="tag">重点</span>' : "") + '<span class="reason">' + esc(item.reason) + "</span></div></div>" +
        '<div class="slot-actions"><button type="button" class="check' + (done ? " is-done" : "") + '" data-action="toggle-done" data-id="' + esc(item.id) + '"' + (executing ? "" : " disabled") + ' aria-label="完成"></button>' +
        (state.todayStatus.status === "closed" ? "" : '<button type="button" class="btn tiny" data-action="defer" data-id="' + esc(item.id) + '">延期</button>') +
        "</div></div>";
    }).join("");
    return '<p class="context">' + esc(context) + "</p>" + fixedHtml + rows + (items.length ? "" : '<p class="empty">这一天还没有安排。</p>');
  }

  function renderPanel(state) {
    if (!state.panel) return "";
    var items = todayItems(state).filter(function (item) {
      return item.checkable && item.state !== "done";
    });
    var dates = laterThisWeek(todayIso());
    var rows = items.map(function (item) {
      var current = state.panel.choices[item.id] || "pool";
      var choices = '<button type="button" class="choice' + (current === "pool" ? " is-on" : "") + '" data-action="choose" data-id="' + esc(item.id) + '" data-choice="pool">放回待安排</button>' +
        dates.map(function (date) {
          var label = date === iso(addDays(parseISO(todayIso()), 1)) ? "改到明天" : "改到" + weekdayName(date);
          return '<button type="button" class="choice' + (current === date ? " is-on" : "") + '" data-action="choose" data-id="' + esc(item.id) + '" data-choice="' + date + '">' + label + "</button>";
        }).join("") +
        '<button type="button" class="choice' + (current === "drop" ? " is-on" : "") + '" data-action="choose" data-id="' + esc(item.id) + '" data-choice="drop">取消这件</button>';
      return '<div class="choice-row"><p>' + esc(item.title) + '</p><div class="choices">' + choices + "</div></div>";
    }).join("");
    var closing = state.panel.mode === "close";
    return '<section class="panel"><h2>' + (closing ? "结束今天" : "调整今天剩下的安排") + "</h2><p class=\"lede\">没做完的事先放回待安排。你也可以明确改到后面某一天。</p>" +
      rows + buttons('<button type="button" class="btn primary" data-action="apply-panel">' + (closing ? "结束今天" : "按这个调整") + '</button><button type="button" class="btn" data-action="close-panel">取消</button>') +
      "</section>";
  }

  function renderIdeaFields() {
    return '<label class="field wide">想到的事<input name="title" type="text" required placeholder="例如下个月给父母安排体检"></label>' +
      '<label class="field">领域<select name="area">' + AREAS.map(function (area) { return option(area, "生活", area); }).join("") + "</select></label>" +
      '<label class="field">优先级<select name="priority">' + ["中", "高", "低"].map(function (item) { return option(item, "中", item); }).join("") + "</select></label>" +
      '<label class="field">分钟<input name="minutes" type="number" min="10" max="240" value="30"></label>' +
      '<label class="field">截止日期<input name="due" type="date"></label>';
  }

  function renderDaySummary(state, checkable, done) {
    if (state.todayStatus.status === "closed") return "<p class=\"empty\">今天的处理结果写在上面。</p>";
    if (!checkable.length) return "<p class=\"empty\">今天没有待执行的安排。</p>";
    var left = checkable.length - done.length;
    if (state.todayStatus.status === "pending") return "<p class=\"empty\">还没开始。确认后，没做完的事会在晚上由你决定放回哪里。</p>";
    if (!left) return "<p class=\"empty\">今天的安排都勾完了。可以点「完成今天」收尾。</p>";
    return "<p class=\"empty\">还剩 " + left + " 件。点「完成今天」时，它们会回到待安排，或由你改到指定的一天。</p>";
  }

  function renderWeek(state, tab) {
    tab = tab === "next" ? "next" : "this";
    var week = tab === "next" ? state.nextWeek : state.currentWeek;
    var stats = weekStats(week);
    var range = monthDay(week.start) + " – " + monthDay(iso(addDays(parseISO(week.start), 6)));
    var banner = "";
    if (tab === "next" && week.status === "draft") {
      banner = '<section class="banner"><p>这是下周的建议。确认之后，这些事才会出现在对应的日期里。</p>' +
        buttons('<button type="button" class="btn primary" data-action="confirm-week">确认后执行</button><button type="button" class="btn" data-action="regen-week">重新生成</button>') +
        "</section>";
    } else if (tab === "next") {
      banner = '<section class="banner ok"><p>下周已经确认。每天打开时，仍然只需要确认那一天。</p>' +
        buttons('<button type="button" class="btn" data-action="regen-week">重新生成</button>') + "</section>";
    }
    var overload = "";
    if (tab === "next" && week.unscheduled.length) {
      var names = week.unscheduled.map(function (id) {
        var task = taskById(state, id);
        return task ? task.title + "（" + task.minutes + " 分钟）" : id;
      });
      overload = '<section class="sheet"><h2>这周排不下</h2><p>' + esc(names.join("、")) + "。这些留在想法池里，没有挤进已经满的日子。</p></section>";
    }
    return renderBoardSwitch(state) + renderHomeSwitch(state, tab) + '<header class="page-head"><h1 class="week-title">' + (tab === "next" ? "下周建议" : "这周") + "<span>" + esc(range) + "</span></h1></header>" +
      banner +
      '<section class="sheet"><div class="stats"><div><strong>' + stats.count + '</strong><span>计划任务</span></div><div><strong>' + esc(formatHours(stats.minutes)) + '</strong><span>预计耗时</span></div><div><strong>' + stats.focus + '</strong><span>本周重点</span></div></div></section>' +
      overload + renderWeekBoard(state, week, tab === "next") +
      (tab === "next" ? '<section class="sheet">' + renderWeekEditor(state, week) + "</section>" : "") +
      '<section class="sheet"><h2>排程规则</h2><ul class="rules">' + [
        "固定日程先占住时间。",
        "有截止日期的事，优先放在截止当天。",
        "高优先级先排。重点只取其中耗时最长的 3 件。",
        "工作放进工作时间，其他事放进个人时间。",
        "没有截止日期的事，你更看重的领域靠前。",
        "和固定日程重叠时，挪到空档，不盖掉原来的安排。",
        "时间不够就留在想法池，标成这周排不下。",
        "没做完的事回到待安排，由你决定下一次。"
      ].map(function (rule) { return "<li>" + rule + "</li>"; }).join("") + "</ul></section>";
  }

  function renderWeekTaskCard(item) {
    var done = item.state === "done";
    return '<article class="task-card' + (done ? " is-done" : "") + '">' +
      '<p class="when">' + esc(weekdayName(item.date) + " " + monthDay(item.date)) + " · " + esc(fromMin(item.start)) + "</p>" +
      "<h3>" + esc(item.title) + "</h3>" +
      '<div class="meta">' + areaChip(item.area) +
      (item.focus ? '<span class="tag">重点</span>' : "") +
      "<span>" + item.minutes + " 分钟</span></div></article>";
  }

  function weekItemsOnDate(week, date) {
    return activeItems(week).filter(function (item) { return item.date === date; }).sort(function (a, b) { return a.start - b.start; });
  }

  function renderWeekCards(week) {
    var items = activeItems(week).slice().sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : a.start - b.start;
    });
    if (!items.length) return '<p class="empty">这周还没有安排。</p>';
    return '<div class="task-grid">' + items.map(renderWeekTaskCard).join("") + "</div>";
  }

  function renderWeekBoard(state, week, draft) {
    if (state.boardMode === "calendar") {
      return renderMonthBoard(state, {
        title: "要做的事",
        tasksOn: function (date) { return weekItemsOnDate(week, date); },
        mark: function (item) { return item.title.slice(0, 6); },
        area: function (item) { return item.area; },
        cards: function (items) { return '<div class="task-grid">' + items.map(renderWeekTaskCard).join("") + "</div>"; }
      });
    }
    return '<section class="sheet">' + renderSheetHead(state, "要做的事") + renderWeekCards(week) + "</section>";
  }

  function renderWeekEditor(state, week) {
    var start = parseISO(week.start);
    var dates = [];
    for (var i = 0; i < 7; i += 1) dates.push(iso(addDays(start, i)));
    var rows = activeItems(week).slice().sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : a.start - b.start;
    }).map(function (item) {
      return '<div class="edit-row"><div><p>' + esc(item.title) + '</p><p class="reason">' + esc(item.reason) + "</p></div>" +
        '<select data-action="move-next-item" data-id="' + esc(item.id) + '">' + dates.map(function (date) {
          return option(date, item.date, weekdayName(date) + " " + monthDay(date));
        }).join("") + "</select>" +
        '<select data-action="set-priority" data-id="' + esc(item.id) + '">' + ["高", "中", "低"].map(function (priority) {
          return option(priority, item.priority, priority);
        }).join("") + "</select>" +
        '<button type="button" class="btn tiny" data-action="remove-item" data-id="' + esc(item.id) + '">移出</button></div>';
    }).join("");
    return "<h2>逐项调整</h2><div class=\"edit-list\">" + rows + "</div>";
  }

  function ideaEntries(state) {
    var seen = {};
    var list = [];
    state.tasks.forEach(function (task) {
      if (task.hold && task.status !== "dropped") {
        seen[task.id] = true;
        list.push({ task: task, kind: "hold" });
      }
    });
    (state.nextWeek.unscheduled || []).forEach(function (id) {
      if (seen[id]) return;
      var task = taskById(state, id);
      if (!task || task.status === "dropped") return;
      list.push({ task: task, kind: "blocked" });
    });
    return list;
  }

  function renderPool(state) {
    var ideas = ideaEntries(state);
    var scheduledCount = activeItems(state.nextWeek).length;
    return '<header class="page-head"><div><p class="kicker">想法池</p><h1>先记下来</h1><p class="lede">想到一件事，就先放在这里。要认真做的，点「变成目标」，把计划写清楚。</p></div>' +
      '<button type="button" class="btn primary" data-action="open-idea">新建想法</button></header>' +
      '<section class="sheet"><h2>想法</h2>' + renderIdeaCards(ideas) +
      '<p class="context">下周建议里目前有 ' + scheduledCount + ' 件。<button type="button" class="linkish" data-action="goto" data-view="today" data-tab="next">去看下周</button></p></section>';
  }

  function renderIdeaCards(ideas) {
    if (!ideas.length) return '<p class="empty">还没有先记下来的想法。</p>';
    return '<div class="idea-grid">' + ideas.map(function (entry) {
      var task = entry.task;
      var secondary = entry.kind === "blocked"
        ? '<button type="button" class="btn tiny" data-action="hold-task" data-id="' + esc(task.id) + '">仍然先记着</button>'
        : '<button type="button" class="btn tiny" data-action="release-task" data-id="' + esc(task.id) + '">交给系统排</button>';
      return '<article class="idea-card"><p class="level"><span>' + (entry.kind === "blocked" ? "这周排不下" : "先记着") + "</span>" + areaChip(task.area) + "</p><h3>" + esc(task.title) + '</h3><div class="meta"><span>' + esc(task.priority) + "优先级</span><span>" + task.minutes + " 分钟</span>" +
        (task.due ? "<span>截止 " + esc(monthDay(task.due)) + "</span>" : "<span>还没定日子</span>") + "</div>" +
        buttons('<button type="button" class="btn tiny primary" data-action="become-goal" data-id="' + esc(task.id) + '">变成目标</button>' + secondary) +
        "</article>";
    }).join("") + "</div>";
  }

  function goalById(state, id) {
    for (var i = 0; i < state.goals.length; i += 1) {
      if (state.goals[i].id === id) return state.goals[i];
    }
    return null;
  }

  function renderGoals(state) {
    var longTerm = state.goals.filter(function (goal) { return goal.level === "长期"; });
    var stage = state.goals.filter(function (goal) { return goal.level !== "长期"; });
    function column(title, goals) {
      if (!goals.length) return '<section class="sheet"><h2>' + title + '</h2><p class="empty">这里还没有目标。</p></section>';
      return '<section class="sheet"><h2>' + title + '</h2><div class="goals">' + goals.map(function (goal) {
        var planCount = (goal.plan || []).length;
        var related = state.tasks.filter(function (task) { return task.goalId === goal.id && task.status !== "dropped"; }).map(function (task) { return task.title; });
        var detail = planCount ? "计划里有 " + planCount + " 件" : (related.length ? "关联：" + related.join("、") : "还没有写下计划");
        return '<article class="goal" data-action="open-plan" data-id="' + esc(goal.id) + '"><p class="level"><span>' + esc(goal.level) + "</span>" + areaChip(goal.area) + "</p><h3>" + esc(goal.title) + "</h3><p class=\"context\">完成时间 " + esc(goal.due || "还没定") + " · 进度 " + goal.progress + '%</p>' +
          '<input type="range" min="0" max="100" value="' + goal.progress + '" data-action="goal-progress" data-id="' + esc(goal.id) + '">' +
          '<p class="context">' + esc(detail) + "</p>" +
          buttons('<button type="button" class="btn tiny primary" data-action="open-plan" data-id="' + esc(goal.id) + '">调整计划</button><button type="button" class="btn tiny" data-action="edit-goal" data-id="' + esc(goal.id) + '">改目标</button>') +
          "</article>";
      }).join("") + "</div></section>";
    }
    return '<header class="page-head"><div><p class="kicker">目标</p><h1>让系统知道方向</h1><p class="lede">点一张目标卡片，就能按每周、每月来排，也可以在日历上指定某一天，并写上注释。</p></div><button type="button" class="btn primary" data-action="new-goal">新建目标</button></header>' +
      column("阶段目标", stage) + column("长期目标", longTerm);
  }

  function calendarCells(year, month) {
    var first = new Date(year, month - 1, 1);
    var cursor = mondayOf(first);
    var last = new Date(year, month, 0);
    var cells = [];
    while (cells.length < 42) {
      cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()));
      cursor = addDays(cursor, 1);
      if (cursor > last && cursor.getDay() === 1) break;
    }
    return cells;
  }

  function weekPlanOf(goal) {
    goal.weekPlan = goal.weekPlan || { weekdays: [], title: "", note: "" };
    goal.weekPlan.weekdays = goal.weekPlan.weekdays || [];
    return goal.weekPlan;
  }

  function monthPlanOf(goal) {
    goal.monthPlan = goal.monthPlan || { day: "", title: "", note: "" };
    return goal.monthPlan;
  }

  function readOpenRhythm(goal) {
    if (!goal) return;
    var weekBox = document.querySelector("[data-rhythm-week]");
    var monthBox = document.querySelector("[data-rhythm-month]");
    if (weekBox) {
      var week = weekPlanOf(goal);
      var title = weekBox.querySelector("[name=title]");
      var note = weekBox.querySelector("[name=note]");
      if (title) week.title = title.value.trim();
      if (note) week.note = note.value.trim();
      var weekRemind = weekBox.querySelector("[name=remindTime]");
      if (weekRemind) week.remindTime = weekRemind.value;
    }
    if (monthBox) {
      var month = monthPlanOf(goal);
      var day = monthBox.querySelector("[name=day]");
      var monthTitle = monthBox.querySelector("[name=title]");
      var monthNote = monthBox.querySelector("[name=note]");
      var monthRemind = monthBox.querySelector("[name=remindTime]");
      if (day) {
        var raw = String(day.value || "").trim();
        month.day = raw ? String(Math.max(1, Math.min(31, Number(raw) || 1))) : "";
      }
      if (monthTitle) month.title = monthTitle.value.trim();
      if (monthNote) month.note = monthNote.value.trim();
      if (monthRemind) month.remindTime = monthRemind.value;
    }
  }

  function renderGoalCalendar(state) {
    var view = state.goalCalendar;
    var goal = view && goalById(state, view.goalId);
    if (!goal) {
      state.goalCalendar = null;
      return renderGoals(state);
    }
    var week = weekPlanOf(goal);
    var month = monthPlanOf(goal);
    var notes = goal.dayNotes || {};
    var cells = calendarCells(view.year, view.month);
    var selected = view.date;
    var counts = {};
    (goal.plan || []).forEach(function (step) {
      if (!step.date) return;
      counts[step.date] = (counts[step.date] || 0) + 1;
    });
    var dayNames = [["一", 1], ["二", 2], ["三", 3], ["四", 4], ["五", 5], ["六", 6], ["日", 0]];
    var weekDays = dayNames.map(function (day) {
      var on = week.weekdays.indexOf(day[1]) !== -1;
      return '<button type="button" class="choice' + (on ? " is-on" : "") + '" data-action="toggle-week-day" data-id="' + esc(goal.id) + '" data-day="' + day[1] + '">' + day[0] + "</button>";
    }).join("");
    var head = dayNames.map(function (day) {
      return '<span class="cal-dow">' + day[0] + "</span>";
    }).join("");
    var days = cells.map(function (date) {
      var value = iso(date);
      var outside = date.getMonth() !== view.month - 1;
      var weekHit = week.weekdays.indexOf(date.getDay()) !== -1 && (week.title || week.note || week.remindTime);
      var monthHit = month.day && Number(month.day) === date.getDate() && (month.title || month.note || month.remindTime);
      var cls = "cal-day" + (outside ? " is-out" : "") + (value === selected ? " is-on" : "") + (value === todayIso() ? " is-today" : "") +
        (weekHit ? " is-rhythm" : "") + (monthHit ? " is-month" : "") + (notes[value] ? " has-note" : "");
      var mark = notes[value] ? notes[value].slice(0, 8) : (counts[value] ? String(counts[value]) : (weekHit ? (week.title || "每周").slice(0, 6) : (monthHit ? (month.title || "每月").slice(0, 6) : "")));
      return '<button type="button" class="' + cls + '" data-action="pick-day" data-date="' + value + '"><strong>' + date.getDate() + "</strong>" +
        (mark ? '<em class="kind-text kind-' + areaKind(goal.area) + '">' + esc(mark) + "</em>" : "") + "</button>";
    }).join("");
    var onDay = (goal.plan || []).filter(function (step) { return step.date === selected; });
    var undated = (goal.plan || []).filter(function (step) { return !step.date; });
    var selectedDate = selected ? parseISO(selected) : null;
    var rhythmNote = "";
    if (selectedDate && week.weekdays.indexOf(selectedDate.getDay()) !== -1 && (week.title || week.remindTime)) {
      rhythmNote += "<p>这一天按每周安排：" + esc(week.title || "还没写做什么") + (week.remindTime ? "，" + esc(week.remindTime) + " 提醒" : "") + "</p>";
    }
    if (selectedDate && month.day && Number(month.day) === selectedDate.getDate() && (month.title || month.remindTime)) {
      rhythmNote += "<p>这一天按每月安排：" + esc(month.title || "还没写做什么") + (month.remindTime ? "，" + esc(month.remindTime) + " 提醒" : "") + "</p>";
    }
    return '<header class="page-head is-plan"><button type="button" class="btn" data-action="close-calendar">返回</button><div><p class="kicker">' + esc(goal.level) + " · " + areaChip(goal.area) + "</p><h1>" + esc(goal.title) + '</h1><p class="lede">每周和每月并排来定。下面的日历会跟着标出这些天。文字注只写在日历上。</p></div>' +
      buttons('<button type="button" class="btn" data-action="edit-goal" data-id="' + esc(goal.id) + '">改目标</button>') + "</header>" +
      '<div class="rhythm-row">' +
      '<section class="rhythm" data-rhythm-week="1"><h2>每周</h2><div class="daypicks">' + weekDays + "</div>" +
      '<div class="stack-form"><label class="field">每周做什么<input name="title" type="text" value="' + esc(week.title) + '" placeholder="例如写一篇"></label>' +
      '<label class="field">提醒时间<input name="remindTime" type="time" value="' + esc(week.remindTime || "") + '"></label></div>' +
      buttons('<button type="button" class="btn primary" data-action="save-week-rhythm" data-id="' + esc(goal.id) + '">记下每周</button>') + "</section>" +
      '<section class="rhythm" data-rhythm-month="1"><h2>每月</h2><div class="stack-form">' +
      '<label class="field">每月第几天<input name="day" type="number" min="1" max="31" value="' + esc(month.day || "") + '" placeholder="1–31"></label>' +
      '<label class="field">每月做什么<input name="title" type="text" value="' + esc(month.title) + '" placeholder="例如月度复盘"></label>' +
      '<label class="field">提醒时间<input name="remindTime" type="time" value="' + esc(month.remindTime || "") + '"></label></div>' +
      buttons('<button type="button" class="btn primary" data-action="save-month-rhythm" data-id="' + esc(goal.id) + '">记下每月</button>') + "</section></div>" +
      '<section class="sheet"><h2>日历</h2>' +
      '<div class="cal-nav"><button type="button" class="btn tiny" data-action="cal-shift" data-dir="-1">上个月</button><strong>' + view.year + "年" + view.month + '月</strong><button type="button" class="btn tiny" data-action="cal-shift" data-dir="1">下个月</button></div>' +
      '<div class="cal">' + head + days + "</div>" +
      "<h2>" + esc(selected ? weekdayName(selected) + " " + monthDay(selected) : "选择一天") + "</h2>" +
      rhythmNote +
      '<label class="field">这一天的标注<textarea data-action="plan-day-note" data-id="' + esc(goal.id) + '" rows="3" placeholder="文字注写在日历这一天">' + esc(selected ? (notes[selected] || "") : "") + "</textarea></label>" +
      renderPlanEditor(goal, onDay, "这一天还没有单独的安排。") +
      buttons('<button type="button" class="btn" data-action="add-plan-step" data-id="' + esc(goal.id) + '" data-date="' + esc(selected || "") + '">在这一天加一件</button>') +
      "</section>" +
      (undated.length ? '<section class="sheet"><h2>还没定日子</h2>' + renderPlanEditor(goal, undated, "") + "</section>" : "");
  }

  function renderPlanEditor(goal, steps, empty) {
    if (!steps.length) return empty ? '<p class="empty">' + empty + "</p>" : "";
    return '<div class="edit-list">' + steps.map(function (step) {
      return '<div class="edit-row plan-edit"><input data-action="plan-title" data-goal="' + esc(goal.id) + '" data-step="' + esc(step.id) + '" type="text" value="' + esc(step.title) + '" placeholder="这一天做什么">' +
        '<input data-action="plan-minutes" data-goal="' + esc(goal.id) + '" data-step="' + esc(step.id) + '" type="number" min="10" max="240" value="' + esc(step.minutes || 30) + '">' +
        '<input data-action="plan-date" data-goal="' + esc(goal.id) + '" data-step="' + esc(step.id) + '" type="date" value="' + esc(step.date || "") + '">' +
        '<input data-action="plan-remind-date" data-goal="' + esc(goal.id) + '" data-step="' + esc(step.id) + '" type="date" value="' + esc(step.remindDate || "") + '" title="提醒日期">' +
        '<input data-action="plan-remind-time" data-goal="' + esc(goal.id) + '" data-step="' + esc(step.id) + '" type="time" value="' + esc(step.remindTime || "") + '" title="提醒时间">' +
        '<button type="button" class="btn tiny" data-action="delete-plan-step" data-goal="' + esc(goal.id) + '" data-step="' + esc(step.id) + '">删除</button></div>';
    }).join("") + "</div>";
  }

  function reminderWhen(date, time) {
    var parts = [];
    if (date) parts.push(monthDay(date));
    if (time) parts.push(time);
    return parts.join(" ") || "还没定时间";
  }

  function reminderActions(id) {
    return '<div class="actions"><button type="button" class="btn tiny" data-action="edit-remind" data-id="' + esc(id) + '">修改</button>' +
      '<button type="button" class="btn tiny" data-action="delete-remind" data-id="' + esc(id) + '">删除</button></div>';
  }

  function allReminders(state) {
    var created = [];
    var converted = [];
    (state.customReminders || []).forEach(function (item) {
      created.push({ id: "custom:" + item.id, kind: "custom", source: "新建", title: item.title, date: item.date || "", time: item.time || "", day: "", when: reminderWhen(item.date, item.time), from: "" });
    });
    (state.goals || []).forEach(function (goal) {
      var week = goal.weekPlan || {};
      if (week.remindTime) {
        var days = (week.weekdays || []).map(function (day) { return "周" + WEEKDAYS[day]; }).join("、");
        converted.push({ id: "week:" + goal.id, kind: "week", source: "每周计划", title: week.title || goal.title, date: "", time: week.remindTime, day: "", when: (days || "每周") + " " + week.remindTime, from: goal.title });
      }
      var month = goal.monthPlan || {};
      if (month.remindTime) {
        converted.push({ id: "month:" + goal.id, kind: "month", source: "每月计划", title: month.title || goal.title, date: "", time: month.remindTime, day: month.day || "", when: "每月 " + (month.day || "?") + " 日 " + month.remindTime, from: goal.title });
      }
      (goal.plan || []).forEach(function (step) {
        if (!step.remindDate && !step.remindTime) return;
        converted.push({ id: "step:" + goal.id + ":" + step.id, kind: "step", source: "计划", title: step.title, date: step.remindDate || step.date || "", time: step.remindTime || "", day: "", when: reminderWhen(step.remindDate || step.date, step.remindTime), from: goal.title });
      });
    });
    (state.events || []).forEach(function (item) {
      if (!item.remindDate && !item.remindTime) return;
      converted.push({ id: "event:" + item.id, kind: "event", source: "重要事件", title: item.title, date: item.remindDate || item.date || "", time: item.remindTime || "", day: "", when: reminderWhen(item.remindDate || item.date, item.remindTime), from: "重要事件" });
    });
    return { created: created, converted: converted };
  }

  function findReminder(state, id) {
    var both = allReminders(state);
    var found = null;
    both.created.concat(both.converted).forEach(function (item) {
      if (item.id === id) found = item;
    });
    return found;
  }

  function reminderParts(id) {
    var bits = String(id || "").split(":");
    return { kind: bits[0], goalId: bits[1] || "", ref: bits[1] || "", stepId: bits[2] || "" };
  }

  function removeReminder(id) {
    var parts = reminderParts(id);
    if (parts.kind === "custom") {
      state.customReminders = (state.customReminders || []).filter(function (item) { return item.id !== parts.ref; });
    } else if (parts.kind === "event") {
      var record = eventById(parts.ref);
      if (record) { record.remindDate = ""; record.remindTime = ""; }
    } else if (parts.kind === "week") {
      var weekGoal = goalById(state, parts.goalId);
      if (weekGoal && weekGoal.weekPlan) weekGoal.weekPlan.remindTime = "";
    } else if (parts.kind === "month") {
      var monthGoal = goalById(state, parts.goalId);
      if (monthGoal && monthGoal.monthPlan) monthGoal.monthPlan.remindTime = "";
    } else if (parts.kind === "step") {
      var stepOwner = findPlanStep(parts.goalId, parts.stepId);
      if (stepOwner) { stepOwner.step.remindDate = ""; stepOwner.step.remindTime = ""; }
    } else return;
    commit("这条提醒已删掉。");
  }

  function saveRemind(form) {
    var draft = state.modal && state.modal.draft;
    if (!draft) return;
    var title = form.title.value.trim();
    if (!title) {
      toast("先写上提醒什么。");
      render();
      return;
    }
    var parts = reminderParts(draft.id);
    if (parts.kind === "custom") {
      (state.customReminders || []).forEach(function (item) {
        if (item.id === parts.ref) {
          item.title = title;
          item.date = form.date ? form.date.value : "";
          item.time = form.time ? form.time.value : "";
        }
      });
    } else if (parts.kind === "event") {
      var record = eventById(parts.ref);
      if (record) {
        record.title = title;
        record.remindDate = form.date ? form.date.value : "";
        record.remindTime = form.time ? form.time.value : "";
      }
    } else if (parts.kind === "week") {
      var weekGoal = goalById(state, parts.goalId);
      if (weekGoal) {
        weekGoal.weekPlan = weekPlanOf(weekGoal);
        weekGoal.weekPlan.title = title;
        weekGoal.weekPlan.remindTime = form.time ? form.time.value : "";
      }
    } else if (parts.kind === "month") {
      var monthGoal = goalById(state, parts.goalId);
      if (monthGoal) {
        monthGoal.monthPlan = monthPlanOf(monthGoal);
        monthGoal.monthPlan.title = title;
        monthGoal.monthPlan.day = form.day && form.day.value ? String(Math.max(1, Math.min(31, Number(form.day.value) || 1))) : "";
        monthGoal.monthPlan.remindTime = form.time ? form.time.value : "";
      }
    } else if (parts.kind === "step") {
      var stepOwner = findPlanStep(parts.goalId, parts.stepId);
      if (stepOwner) {
        stepOwner.step.title = title;
        stepOwner.step.remindDate = form.date ? form.date.value : "";
        stepOwner.step.remindTime = form.time ? form.time.value : "";
      }
    }
    state.modal = null;
    commit("提醒已更新。");
  }

  function renderReminderCard(item) {
    return '<article class="card reminder"><div><p class="tag">' + esc(item.source) + "</p><h3>" + esc(item.title) + '</h3><p class="context">' + esc(item.when) + (item.from ? " · " + esc(item.from) : "") + "</p></div>" + reminderActions(item.id) + "</article>";
  }

  function renderReminders(state) {
    var groups = allReminders(state);
    var created = groups.created.map(renderReminderCard).join("");
    var converted = groups.converted.map(renderReminderCard).join("");
    return '<header class="page-head"><div><p class="kicker">提醒</p><h1>提醒</h1><p class="lede">上面是新建的临时提醒，下面是从计划和重要事件转过来的。都可以修改或删除。</p></div>' +
      '<button type="button" class="btn primary" data-action="open-remind">新建提醒</button></header>' +
      '<section class="sheet"><h2>新建的提醒</h2>' +
      '<div class="cards">' + (created || '<p class="empty">还没有临时提醒。</p>') + "</div></section>" +
      '<section class="sheet"><h2>转换过来的提醒</h2>' +
      '<div class="cards">' + (converted || '<p class="empty">计划和重要事件里还没有设提醒。</p>') + "</div></section>";
  }

  function renderIdeaModal() {
    return '<div class="modal" data-action="close-modal"><form class="modal-card" data-modal-card="1" data-action="add-task"><h2>新建想法</h2><p class="lede">先记下来。它进想法池，不会直接出现在今天。</p><div class="stack-form">' +
      renderIdeaFields() + "</div>" +
      buttons('<button type="button" class="btn" data-action="close-modal">取消</button><button class="btn primary" type="submit">先记下来</button>') +
      "</form></div>";
  }

  function renderNewRemindModal() {
    return '<div class="modal" data-action="close-modal"><form class="modal-card" data-modal-card="1" data-action="add-custom-remind"><h2>新建提醒</h2><p class="lede">记一条临时提醒。日期和时间都要填上。</p><div class="stack-form">' +
      '<label class="field wide">提醒什么<input name="title" type="text" required placeholder="例如出门前带钥匙"></label>' +
      '<label class="field">日期<input name="date" type="date" required value="' + esc(todayIso()) + '"></label>' +
      '<label class="field">时间<input name="time" type="time" required value="09:00"></label></div>' +
      buttons('<button type="button" class="btn" data-action="close-modal">取消</button><button class="btn primary" type="submit">记下这条提醒</button>') +
      "</form></div>";
  }

  function renderRemindModal(state) {
    var draft = state.modal.draft;
    var dateField = draft.kind === "week" || draft.kind === "month" ? "" :
      '<label class="field">日期<input name="date" type="date" value="' + esc(draft.date || "") + '"></label>';
    var dayField = draft.kind === "month" ? '<label class="field">每月第几天<input name="day" type="number" min="1" max="31" value="' + esc(draft.day || "") + '"></label>' : "";
    return '<div class="modal" data-action="close-modal"><form class="modal-card" data-modal-card="1" data-action="save-remind"><h2>修改提醒</h2><div class="stack-form">' +
      '<label class="field wide">提醒什么<input name="title" type="text" required value="' + esc(draft.title) + '"></label>' +
      dateField + dayField +
      '<label class="field">时间<input name="time" type="time" value="' + esc(draft.time || "") + '"></label></div>' +
      buttons('<button type="button" class="btn" data-action="close-modal">取消</button><button class="btn primary" type="submit">保存</button>') +
      "</form></div>";
  }

  function buildReminders(state) {
    var list = [];
    todayItems(state).forEach(function (item) {
      if (!item.checkable || item.state === "done") return;
      list.push({ id: "task-" + item.id, type: "任务提醒", when: "今天 " + fromMin(item.start), title: item.title, itemId: item.id });
    });
    state.tasks.forEach(function (task) {
      if (!task.due || task.hold || task.status === "done" || task.status === "dropped") return;
      var diff = Math.round((parseISO(task.due) - parseISO(todayIso())) / 86400000);
      if (diff >= 0 && diff <= 1) {
        list.push({ id: "due-" + task.id, type: "截止提醒", when: monthDay(task.due) + " 前", title: task.title + "快到截止日期", itemId: "" });
      }
    });
    return list;
  }

  function renderSettings(state) {
    var settings = state.settings;
    var dayNames = [["一", 1], ["二", 2], ["三", 3], ["四", 4], ["五", 5], ["六", 6], ["日", 0]];
    var fixed = settings.fixed.map(function (item) {
      var days = dayNames.map(function (day) {
        var on = item.weekdays.indexOf(day[1]) !== -1;
        return '<button type="button" class="choice' + (on ? " is-on" : "") + '" data-action="toggle-fixed-day" data-id="' + esc(item.id) + '" data-day="' + day[1] + '">' + day[0] + "</button>";
      }).join("");
      return '<div class="fixed-block" data-fixed-id="' + esc(item.id) + '"><div class="inline-form">' +
        '<label class="field">名称<input name="title" type="text" value="' + esc(item.title) + '"></label>' +
        '<label class="field">开始<input name="start" type="time" value="' + esc(item.start) + '"></label>' +
        '<label class="field">结束<input name="end" type="time" value="' + esc(item.end) + '"></label>' +
        '<button type="button" class="btn" data-action="remove-fixed" data-id="' + esc(item.id) + '">删除</button></div><div class="daypicks">' + days + "</div></div>";
    }).join("");
    var areas = AREAS.map(function (area) {
      var value = String(settings.areas[area] || 2);
      return '<label class="field">' + area + '<select name="area-' + esc(area) + '">' +
        option("1", value, "少") + option("2", value, "一般") + option("3", value, "多") + "</select></label>";
    }).join("");
    var workdays = dayNames.map(function (day) {
      var on = settings.workdays.indexOf(day[1]) !== -1;
      return '<button type="button" class="choice' + (on ? " is-on" : "") + '" data-action="toggle-workday" data-day="' + day[1] + '">' + day[0] + "</button>";
    }).join("");
    return '<header class="page-head"><div><p class="kicker">作息</p><h1>先认识你的作息</h1><p class="lede">系统靠这些空档排计划。改完保存，再去下周建议里重新生成。</p></div></header>' +
      '<form id="settings-form" class="sheet" data-action="save-settings"><div class="stack-form">' +
      field("起床", "wake", "time", settings.wake) + field("睡觉", "sleep", "time", settings.sleep) +
      field("工作开始", "workStart", "time", settings.workStart) + field("工作结束", "workEnd", "time", settings.workEnd) +
      field("工作日个人时间（分钟）", "personalWeekday", "number", settings.personalWeekday) +
      field("周末个人时间（分钟）", "personalWeekend", "number", settings.personalWeekend) +
      field("早上看计划", "remindAt", "time", settings.remindAt) + field("晚上检查未完成", "eveningCheck", "time", settings.eveningCheck) +
      "</div><h2>工作日</h2><div class=\"daypicks\">" + workdays + "</div><h2>领域关注</h2><div class=\"stack-form\">" + areas + "</div>" +
      "<h2>固定日程</h2>" + fixed + buttons('<button type="button" class="btn" data-action="add-fixed">加一条固定日程</button><button class="btn primary" type="submit">保存设置</button>') +
      "</form>";
  }

  function field(label, name, type, value) {
    return '<label class="field">' + label + '<input name="' + name + '" type="' + type + '" value="' + esc(value) + '"' + (type === "number" ? ' min="30" max="360"' : "") + "></label>";
  }

  function renderEvents(state) {
    var list = state.events || [];
    var cards = list.map(function (item) {
      var hasRemind = !!(item.remindDate || item.remindTime);
      var remindLine = hasRemind ? '<p class="context">提醒 ' + esc(reminderWhen(item.remindDate || item.date, item.remindTime)) + "</p>" : "";
      var bell = hasRemind ? '<span class="bell" aria-label="有提醒"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 3.5a4.5 4.5 0 0 0-4.5 4.5v2.2c0 .8-.3 1.5-.9 2.1L5.2 14h13.6l-1.4-1.7a3 3 0 0 1-.9-2.1V8A4.5 4.5 0 0 0 12 3.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 16.5a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></span>' : "";
      return '<article class="event-card"><p class="level">' + areaChip(item.area) + "<span>" + esc(fullDate(item.date)) + "</span></p><h3>" + esc(item.title) + bell + "</h3><p>" + esc(item.note) + "</p>" + remindLine +
        buttons('<button type="button" class="btn tiny" data-action="edit-event" data-id="' + esc(item.id) + '">修改</button>' +
          '<button type="button" class="btn tiny" data-action="delete-event" data-id="' + esc(item.id) + '">' +
          (state.eventDeleteId === item.id ? "确认删除" : "删除") + "</button>") +
        "</article>";
    }).join("");
    var body = cards
      ? '<div class="event-grid">' + cards + "</div>"
      : '<p class="empty">还没有重要事件。</p><p class="empty">值得单独记住的事，可以记在这里。</p>';
    return '<header class="page-head"><div><p class="kicker">记录</p><h1>重要事件记录</h1><p class="lede">每件重要的事单独一张卡片。这里只记必须留下的事，不会混进今天的待办。</p></div>' +
      '<button type="button" class="btn primary" data-action="open-event">+ 记录重要事件</button></header>' +
      '<section class="sheet">' + body + "</section>";
  }

  function blankEvent() {
    return { title: "", date: todayIso(), area: "生活", note: "", remindDate: "", remindTime: "" };
  }

  function renderEventModal(state) {
    var draft = state.modal.draft || blankEvent();
    var editing = !!state.modal.id;
    return '<div class="modal" data-action="close-modal"><form class="modal-card is-wide" data-modal-card="1" data-action="save-event"><h2>' +
      (editing ? "修改这条记录" : "增加必记录事件") + '</h2><p class="lede">写清楚这件事，以及以后要记住的内容。</p><div class="stack-form">' +
      '<label class="field wide">事件<input name="title" type="text" required value="' + esc(draft.title) + '" placeholder="例如带父母去体检"></label>' +
      '<label class="field">日期<input name="date" type="date" required value="' + esc(draft.date || "") + '"></label>' +
      '<label class="field">分类<select name="area">' + areaChoices(draft.area).map(function (area) { return option(area, draft.area, area); }).join("") + "</select></label>" +
      '<label class="field wide">记录<textarea name="note" rows="4" required placeholder="这件事要记住什么">' + esc(draft.note) + "</textarea></label>" +
      '<label class="field">提醒日期<input name="remindDate" type="date" value="' + esc(draft.remindDate || "") + '"></label>' +
      '<label class="field">提醒时间<input name="remindTime" type="time" value="' + esc(draft.remindTime || "") + '"></label></div>' +
      buttons('<button type="button" class="btn" data-action="close-modal">取消</button><button class="btn primary" type="submit">保存</button>') +
      "</form></div>";
  }

  function renderModal(state) {
    if (!state.modal) return "";
    if (state.modal.kind === "capture") return renderCaptureModal(state);
    if (state.modal.kind === "edit-home") return renderHomeEditModal(state);
    if (state.modal.kind === "defer-home") return renderHomeDeferModal(state);
    if (state.modal.kind === "goal") return renderGoalModal(state);
    if (state.modal.kind === "event") return renderEventModal(state);
    if (state.modal.kind === "edit-remind") return renderRemindModal(state);
    if (state.modal.kind === "idea") return renderIdeaModal();
    if (state.modal.kind === "new-remind") return renderNewRemindModal();
    var item = findItem(state, state.modal.itemId);
    if (!item) return "";
    var dates = laterThisWeek(item.date);
    var choices = '<button type="button" class="btn" data-action="defer-to" data-id="' + esc(item.id) + '" data-choice="pool">放回待安排</button>' +
      dates.map(function (date) {
        var label = date === iso(addDays(parseISO(item.date), 1)) ? "改到明天" : "改到" + weekdayName(date);
        return '<button type="button" class="btn" data-action="defer-to" data-id="' + esc(item.id) + '" data-choice="' + date + '">' + label + "</button>";
      }).join("");
    return '<div class="modal" data-action="close-modal"><div class="modal-card" data-modal-card="1"><h2>延期</h2><p>' + esc(item.title) + '</p><div class="choices">' + choices + '</div></div></div>';
  }

  function blankCapture() {
    return { title: "", area: "生活", priority: "中", minutes: "", taskDate: "", remindDate: "", remindTime: "" };
  }

  function renderCaptureModal(state) {
    var draft = state.modal.draft || blankCapture();
    var extra = "";
    if (state.modal.expanded) {
      extra = '<div class="stack-form">' +
        '<label class="field">分类<select name="area">' + areaChoices(draft.area).map(function (area) { return option(area, draft.area, area); }).join("") + "</select></label>" +
        '<label class="field">优先级<select name="priority">' + ["中", "高", "低"].map(function (item) { return option(item, draft.priority, item); }).join("") + "</select></label>" +
        '<label class="field">预计耗时<input name="minutes" type="number" min="5" max="480" placeholder="可不填" value="' + esc(draft.minutes || "") + '"></label>' +
        '<label class="field">任务日期<input name="taskDate" type="date" required value="' + esc(draft.taskDate || "") + '"></label>' +
        '<label class="field">提醒日期<input name="remindDate" type="date" value="' + esc(draft.remindDate || "") + '"></label>' +
        '<label class="field">提醒时间<input name="remindTime" type="time" value="' + esc(draft.remindTime || "") + '"></label></div>' +
        '<p class="lede">任务日期是准备做的那天。提醒日期可以更早，用来提前叫你。</p>' +
        notifyNote() +
        buttons('<button type="button" class="btn" data-action="close-modal">取消</button><button class="btn primary" type="submit">保存任务</button>');
    } else {
      extra = buttons('<button type="button" class="btn" data-action="capture-inbox">先放进收集箱</button><button type="button" class="btn primary" data-action="capture-more">设置日期和提醒</button>');
    }
    return '<div class="modal" data-action="close-modal"><form class="modal-card is-wide" data-modal-card="1" data-action="save-capture"><h2>记录一件事</h2><p class="lede">先记下来。放进收集箱的事不会出现在首页。</p>' +
      '<label class="field">事情<input name="title" type="text" required value="' + esc(draft.title) + '" placeholder="例如带父母去体检"></label>' + extra + "</form></div>";
  }

  function renderHomeEditModal(state) {
    var task = homeById(state.modal.id);
    if (!task) return "";
    return '<div class="modal" data-action="close-modal"><form class="modal-card is-wide" data-modal-card="1" data-action="save-home-task"><h2>编辑任务</h2><div class="stack-form">' +
      '<label class="field wide">任务名称<input name="title" type="text" required value="' + esc(task.title) + '"></label>' +
      '<label class="field">分类<select name="area">' + areaChoices(task.area).map(function (area) { return option(area, task.area, area); }).join("") + "</select></label>" +
      '<label class="field">优先级<select name="priority">' + ["高", "中", "低"].map(function (item) { return option(item, task.priority, item); }).join("") + "</select></label>" +
      '<label class="field">预计耗时<input name="minutes" type="number" min="5" max="480" placeholder="可不填" value="' + esc(task.minutes || "") + '"></label>' +
      '<label class="field">任务日期<input name="taskDate" type="date" required value="' + esc(task.taskDate || "") + '"></label>' +
      '<label class="field">提醒日期<input name="remindDate" type="date" value="' + esc(task.remindDate || "") + '"></label>' +
      '<label class="field">提醒时间<input name="remindTime" type="time" value="' + esc(task.remindTime || "") + '"></label></div>' +
      notifyNote() +
      buttons('<button type="button" class="btn" data-action="close-modal">取消</button><button class="btn primary" type="submit">保存</button>') +
      "</form></div>";
  }

  function renderHomeDeferModal(state) {
    var task = homeById(state.modal.id);
    if (!task) return "";
    var tomorrow = iso(addDays(parseISO(todayIso()), 1));
    return '<div class="modal" data-action="close-modal"><form class="modal-card" data-modal-card="1" data-action="save-home-defer"><h2>延期</h2><p>' + esc(task.title) + '</p><p class="lede">改的是任务日期。单独设过的提醒日期会留在原来的那天。</p>' +
      '<label class="field">新的任务日期<input name="taskDate" type="date" required value="' + esc(tomorrow) + '"></label>' +
      buttons('<button type="button" class="btn" data-action="close-modal">取消</button><button class="btn primary" type="submit">改到这一天</button>') +
      "</form></div>";
  }

  function notifyNote() {
    if (!window.Notification || Notification.permission === "granted") return "";
    return '<p class="context">浏览器通知还没打开。保存带提醒时间的任务时，可以允许这个页面发通知。没打开时，到点会在页面里提示。</p>';
  }

  function homeById(id) {
    var list = state.homeTasks || [];
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function renderGoalModal(state) {
    var draft = state.modal.draft;
    var title = state.modal.goalId ? "调整这个目标" : (state.modal.sourceId ? "把想法变成目标" : "新建目标");
    var steps = draft.steps.map(function (step) {
      return '<div class="plan-step"><label class="field">做什么<input data-step="' + esc(step.id) + '" data-field="title" type="text" value="' + esc(step.title) + '" placeholder="这一步做什么"></label>' +
        '<label class="field">哪一天<input data-step="' + esc(step.id) + '" data-field="date" type="date" value="' + esc(step.date || "") + '"></label>' +
        '<label class="field">分钟<input data-step="' + esc(step.id) + '" data-field="minutes" type="number" min="10" max="240" value="' + esc(step.minutes || 30) + '"></label>' +
        '<button type="button" class="btn tiny" data-action="remove-goal-step" data-step="' + esc(step.id) + '">删除</button></div>';
    }).join("");
    return '<div class="modal" data-action="close-modal"><form class="modal-card is-wide" data-modal-card="1" data-action="save-goal"><h2>' + title + '</h2><p class="lede">写清要做到什么，再列出准备怎么做。日子可以先空着，之后在日历里改。</p><div class="stack-form">' +
      '<label class="field wide">目标<input name="title" type="text" required value="' + esc(draft.title) + '" placeholder="例如这个月发出 4 篇公众号"></label>' +
      '<label class="field">层级<select name="level">' + ["阶段", "长期"].map(function (level) { return option(level, draft.level, level); }).join("") + "</select></label>" +
      '<label class="field">领域<select name="area">' + AREAS.map(function (area) { return option(area, draft.area, area); }).join("") + "</select></label>" +
      '<label class="field">完成时间<input name="due" type="date" value="' + esc(draft.due || "") + '"></label>' +
      '<label class="field">进度<input name="progress" type="number" min="0" max="100" value="' + esc(draft.progress || 0) + '"></label></div>' +
      "<h2>计划</h2>" + steps +
      buttons('<button type="button" class="btn" data-action="add-goal-step">加一条计划</button><button type="button" class="btn" data-action="close-modal">取消</button><button class="btn primary" type="submit">保存目标</button>') +
      "</form></div>";
  }

  var state = null;
  var toastTimer = null;
  var suppressClick = false;
  var drag = null;

  var saveTimer = null;

  function persist() {
    var copy = JSON.parse(JSON.stringify(state));
    copy.toast = "";
    copy.savedAt = new Date().toISOString();
    state.savedAt = copy.savedAt;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(copy));
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveRemote, 250);
  }

  function saveRemote() {
    var body = localStorage.getItem(STORAGE_KEY);
    if (!body) return;
    fetch("/api/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: body,
      keepalive: true
    }).catch(function () {});
  }

  function normalizeHomeTask(task) {
    task.status = task.status || "pending";
    task.area = task.area || "生活";
    task.priority = task.priority || "中";
    task.taskDate = task.taskDate || "";
    task.remindDate = task.remindDate || "";
    task.remindTime = task.remindTime || "";
    task.completedAt = task.completedAt || "";
    task.completedOn = task.completedOn || "";
    task.snoozeUntil = task.snoozeUntil || "";
    if (task.minutes === undefined) task.minutes = null;
    return task;
  }

  function normalizeState(parsed) {
    if (!parsed.homeTab) parsed.homeTab = parsed.weekTab || "this";
    if (parsed.homeTab !== "today" && parsed.homeTab !== "this" && parsed.homeTab !== "next") parsed.homeTab = "this";
    parsed.homeTasks = (parsed.homeTasks || []).map(normalizeHomeTask);
    parsed.doneOpen = !!parsed.doneOpen;
    if (parsed.taskScope !== "later") parsed.taskScope = "today";
    if (parsed.boardMode !== "calendar") parsed.boardMode = "cards";
    parsed.menuId = "";
    parsed.menuDeleteId = "";
    parsed.rescheduleOpen = !!parsed.rescheduleOpen;
    parsed.notified = parsed.notified || {};
    parsed.goals = (parsed.goals || []).map(function (goal) {
      goal.plan = (goal.plan || []).map(function (step) {
        step.id = step.id || uid("s-");
        step.date = step.date || "";
        step.minutes = step.minutes || 30;
        step.note = step.note || "";
        step.remindDate = step.remindDate || "";
        step.remindTime = step.remindTime || "";
        return step;
      });
      goal.weekPlan = goal.weekPlan || { weekdays: [], title: "", note: "", remindTime: "" };
      goal.weekPlan.weekdays = (goal.weekPlan.weekdays || []).map(Number);
      goal.weekPlan.title = goal.weekPlan.title || "";
      goal.weekPlan.note = goal.weekPlan.note || "";
      goal.weekPlan.remindTime = goal.weekPlan.remindTime || "";
      goal.monthPlan = goal.monthPlan || { day: "", title: "", note: "", remindTime: "" };
      goal.monthPlan.day = goal.monthPlan.day || "";
      goal.monthPlan.title = goal.monthPlan.title || "";
      goal.monthPlan.note = goal.monthPlan.note || "";
      goal.monthPlan.remindTime = goal.monthPlan.remindTime || "";
      goal.dayNotes = goal.dayNotes || {};
      return goal;
    });
    if (!parsed.settings.weeklyReview) parsed.settings.weeklyReview = { weekday: 0, time: "20:30" };
    parsed.goalCalendar = parsed.goalCalendar || null;
    if (!parsed.events) parsed.events = [];
    parsed.events = parsed.events.map(function (item) {
      item.id = item.id || uid("e-");
      item.title = item.title || "";
      item.date = item.date || todayIso();
      item.area = item.area || "生活";
      item.note = item.note || "";
      item.remindDate = item.remindDate || "";
      item.remindTime = item.remindTime || "";
      return item;
    });
    parsed.customReminders = (parsed.customReminders || []).map(function (item) {
      item.id = item.id || uid("r-");
      item.title = item.title || "";
      item.date = item.date || "";
      item.time = item.time || "";
      return item;
    }).filter(function (item) { return item.title; });
    if (!parsed.laterMonth || !parsed.laterMonth.year || !parsed.laterMonth.month) {
      var laterNow = new Date();
      parsed.laterMonth = { year: laterNow.getFullYear(), month: laterNow.getMonth() + 1, date: todayIso() };
    }
    parsed.eventDeleteId = "";
    parsed.railIndex = null;
    if (parsed.view === "week") parsed.view = "today";
    parsed.version = 4;
    stripDemo(parsed);
    return parsed;
  }

  var DEMO_IDS = {
    "h-over": 1, "h-work": 1, "h-walk": 1, "h-kid": 1, "h-desk": 1, "h-done": 1, "h-tom": 1, "h-sun": 1, "h-exam": 1, "h-far": 1,
    "c-mon-work": 1, "c-mon-walk": 1, "c-tue-topic": 1, "c-wed-sport": 1,
    "c-today-family": 1, "c-today-side": 1, "c-today-parent": 1, "c-today-work": 1, "c-today-walk": 1,
    "c-fri-work": 1, "c-sat-side": 1, "c-sun-family": 1, "c-sun-review": 1,
    "n-work": 1, "n-topic": 1, "n-sport": 1, "n-write": 1, "n-publish": 1, "n-follow": 1, "n-wrap": 1,
    "n-walk": 1, "n-study": 1, "n-family": 1, "n-review": 1, "n-docs": 1, "n-hold": 1, "n-desk": 1,
    "g-post": 1, "g-side": 1, "g-work": 1, "g-move": 1, "g-parent": 1, "g-family": 1, "g-learn": 1,
    "e-exam": 1, "e-meet": 1, "e-dinner": 1
  };

  function isDemo(id) {
    return !!(id && DEMO_IDS[id]);
  }

  function stripDemo(state) {
    state.homeTasks = (state.homeTasks || []).filter(function (item) { return !isDemo(item.id); });
    state.tasks = (state.tasks || []).filter(function (item) { return !isDemo(item.id); });
    state.goals = (state.goals || []).filter(function (item) { return !isDemo(item.id); });
    state.events = (state.events || []).filter(function (item) { return !isDemo(item.id); });
    [state.currentWeek, state.nextWeek].forEach(function (week) {
      if (!week) return;
      week.items = (week.items || []).filter(function (item) { return !isDemo(item.taskId) && !isDemo(item.id); });
      week.unscheduled = (week.unscheduled || []).filter(function (id) { return !isDemo(id); });
    });
    if (state.settings && state.settings.fixed) {
      state.settings.fixed = state.settings.fixed.filter(function (item) { return item.id !== "sport" && item.id !== "kid"; });
    }
  }

  function storedState(parsed) {
    if (!parsed || (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3 && parsed.version !== 4)) return null;
    if (!parsed.nextWeek || !parsed.currentWeek) return null;
    return normalizeState(parsed);
  }

  function readStored() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return storedState(JSON.parse(raw));
    } catch (error) {
      return null;
    }
  }

  function pickState(local, remote) {
    if (local && !local.savedAt) return local;
    if (local && remote) return (remote.savedAt || "") > (local.savedAt || "") ? remote : local;
    return local || remote || createInitialState();
  }

  function toast(text) {
    state.toast = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      state.toast = "";
      persist();
      render();
    }, 2600);
  }

  function render() {
    var main = document.querySelector(".main");
    var rail = document.querySelector('[data-rail="days"]');
    var keep = main && !state.scrollReset ? main.scrollTop : 0;
    var keepRail = rail && !state.scrollReset ? rail.scrollLeft : null;
    state.scrollReset = false;
    document.title = "今天做什么";
    document.getElementById("app").innerHTML = renderShell(state);
    var next = document.querySelector(".main");
    if (next) next.scrollTop = keep;
    var nextRail = document.querySelector('[data-rail="days"]');
    if (!nextRail) return;
    if (keepRail !== null) nextRail.scrollLeft = keepRail;
    else placeRail();
  }

  function commit(message) {
    persist();
    if (message) toast(message);
    render();
  }

  function readSettingsForm() {
    var form = document.querySelector("#settings-form");
    if (!form) return;
    ["wake", "sleep", "workStart", "workEnd", "remindAt", "eveningCheck"].forEach(function (name) {
      if (form[name] && form[name].value) state.settings[name] = form[name].value;
    });
    state.settings.personalWeekday = clamp(form.personalWeekday.value, 30, 360);
    state.settings.personalWeekend = clamp(form.personalWeekend.value, 30, 360);
    AREAS.forEach(function (area) {
      var input = form["area-" + area];
      if (input) state.settings.areas[area] = Number(input.value);
    });
    var rows = form.querySelectorAll("[data-fixed-id]");
    Array.prototype.forEach.call(rows, function (row) {
      var fixed = null;
      state.settings.fixed.forEach(function (item) {
        if (item.id === row.getAttribute("data-fixed-id")) fixed = item;
      });
      if (!fixed) return;
      fixed.title = row.querySelector('[name="title"]').value || fixed.title;
      fixed.start = row.querySelector('[name="start"]').value || fixed.start;
      fixed.end = row.querySelector('[name="end"]').value || fixed.end;
    });
  }

  function clamp(value, min, max) {
    var number = Number(value);
    if (!number) number = min;
    return Math.max(min, Math.min(max, number));
  }

  function returnToPool(item) {
    item.state = "removed";
    var task = taskById(state, item.taskId);
    if (task) {
      task.status = "inbox";
      task.hold = true;
      task.bucket = "next";
    }
  }

  function dropTask(item) {
    item.state = "dropped";
    var task = taskById(state, item.taskId);
    if (task) task.status = "dropped";
  }

  function moveTask(item, date) {
    item.date = date;
    item.state = "pending";
    item.reason = "你把它改到了这一天";
  }

  function applyPanel(closeDay) {
    var items = todayItems(state).filter(function (item) { return item.checkable && item.state !== "done"; });
    var summary = state.todayStatus.summary || { done: [], moved: [], pooled: [], dropped: [] };
    if (closeDay) {
      summary = { done: [], moved: [], pooled: [], dropped: [] };
      todayItems(state).forEach(function (item) {
        if (item.state === "done") summary.done.push(item.title);
      });
    }
    items.forEach(function (item) {
      var choice = state.panel.choices[item.id] || "pool";
      if (choice === "pool") {
        returnToPool(item);
        summary.pooled.push(item.title);
      } else if (choice === "drop") {
        dropTask(item);
        summary.dropped.push(item.title);
      } else {
        moveTask(item, choice);
        summary.moved.push(item.title + " → " + monthDay(choice));
      }
    });
    if (closeDay) {
      state.todayStatus.status = "closed";
      state.todayStatus.summary = summary;
    }
    state.panel = null;
    commit(closeDay ? "今天收尾了。没做完的没有自动堆到明天。" : "已按你的决定调整。");
  }

  function regenerate(message) {
    readSettingsForm();
    var start = parseISO(state.nextWeek.start);
    state.tasks.forEach(function (task) {
      if (task.bucket === "next" && task.status !== "dropped" && !task.hold) task.status = "inbox";
    });
    state.nextWeek = generateWeek(start, schedulableNext(state), state.settings);
    state.view = "today";
    state.homeTab = "next";
    state.weekTab = "next";
    commit(message || "已按现在的任务和作息重排。确认后才会执行。");
  }

  function addTask(form) {
    var title = form.title.value.trim();
    if (!title) return;
    state.tasks.push({
      id: uid("u-"),
      title: title,
      area: form.area.value,
      priority: form.priority.value,
      minutes: clamp(form.minutes.value, 10, 240),
      due: form.due.value || null,
      type: "一次性",
      bucket: "next",
      status: "inbox",
      hold: true,
      goalId: null
    });
    state.showAdder = false;
    state.modal = null;
    state.view = "pool";
    state.scrollReset = true;
    commit("已记进想法池。它还不会出现在今天。");
  }

  function blankStep(title, date, minutes) {
    return { id: uid("s-"), title: title || "", date: date || "", minutes: minutes || 30, note: "", remindDate: "", remindTime: "" };
  }

  function openGoalComposer(task, goal) {
    var draft;
    if (goal) {
      draft = {
        title: goal.title,
        level: goal.level === "长期" ? "长期" : "阶段",
        area: goal.area || "生活",
        due: goal.due || "",
        progress: goal.progress || 0,
        steps: (goal.plan || []).map(function (step) {
          return { id: step.id, title: step.title, date: step.date || "", minutes: step.minutes || 30, note: step.note || "", remindDate: step.remindDate || "", remindTime: step.remindTime || "" };
        })
      };
      if (!draft.steps.length) draft.steps.push(blankStep());
    } else if (task) {
      draft = {
        title: task.title,
        level: "阶段",
        area: task.area || "生活",
        due: task.due || "",
        progress: 0,
        steps: [blankStep(task.title, task.due, task.minutes)]
      };
    } else {
      draft = { title: "", level: "阶段", area: "生活", due: "", progress: 0, steps: [blankStep()] };
    }
    state.modal = { kind: "goal", sourceId: task ? task.id : null, goalId: goal ? goal.id : null, draft: draft };
  }

  function readGoalForm(form) {
    if (!form || !state.modal || state.modal.kind !== "goal") return;
    var draft = state.modal.draft;
    draft.title = form.title.value;
    draft.level = form.level.value;
    draft.area = form.area.value;
    draft.due = form.due.value;
    draft.progress = clamp(form.progress.value, 0, 100);
    draft.steps.forEach(function (step) {
      var title = form.querySelector('[data-step="' + step.id + '"][data-field="title"]');
      var date = form.querySelector('[data-step="' + step.id + '"][data-field="date"]');
      var minutes = form.querySelector('[data-step="' + step.id + '"][data-field="minutes"]');
      if (title) step.title = title.value;
      if (date) step.date = date.value;
      if (minutes) step.minutes = clamp(minutes.value, 10, 240);
    });
  }

  function saveGoal(form) {
    readGoalForm(form);
    var draft = state.modal.draft;
    var title = draft.title.trim();
    if (!title) {
      toast("先写上目标名称。");
      render();
      return;
    }
    var plan = draft.steps.filter(function (step) { return step.title.trim() || step.date; }).map(function (step) {
      return { id: step.id || uid("s-"), title: step.title.trim() || "还没写名称", date: step.date || "", minutes: step.minutes || 30, note: step.note || "", remindDate: step.remindDate || "", remindTime: step.remindTime || "" };
    });
    var goal = state.modal.goalId ? goalById(state, state.modal.goalId) : null;
    if (goal) {
      goal.title = title;
      goal.level = draft.level;
      goal.area = draft.area;
      goal.due = draft.due || "";
      goal.progress = draft.progress || 0;
      goal.plan = plan;
    } else {
      state.goals.push({
        id: uid("g-"),
        level: draft.level,
        title: title,
        area: draft.area,
        due: draft.due || "",
        progress: draft.progress || 0,
        plan: plan
      });
    }
    if (state.modal.sourceId) {
      var task = taskById(state, state.modal.sourceId);
      if (task) {
        task.status = "dropped";
        task.hold = false;
      }
      var sourceId = state.modal.sourceId;
      state.nextWeek.unscheduled = (state.nextWeek.unscheduled || []).filter(function (id) { return id !== sourceId; });
    }
    state.modal = null;
    state.view = "goals";
    state.goalCalendar = null;
    state.scrollReset = true;
    commit(goal ? "目标计划已更新。" : "目标已记下。打开日历就能安排每一天。");
  }

  function findPlanStep(goalId, stepId) {
    var goal = goalById(state, goalId);
    if (!goal) return null;
    var found = null;
    (goal.plan || []).forEach(function (step) {
      if (step.id === stepId) found = step;
    });
    return found ? { goal: goal, step: found } : null;
  }

  function shiftMonth(year, month, dir) {
    var date = new Date(year, month - 1 + dir, 1);
    return { year: date.getFullYear(), month: date.getMonth() + 1 };
  }

  function onClick(event) {
    if (suppressClick) {
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.target.classList && event.target.classList.contains("modal")) {
      state.modal = null;
      commit();
      return;
    }
    var el = event.target.closest("[data-action]");
    if (!el) return;
    var action = el.dataset.action;
    if (el.classList.contains("modal") && event.target.closest("[data-modal-card]")) return;
    if (action === "export-data") {
      exportWorkbook();
      return;
    }
    if (action === "goto") {
      state.view = el.dataset.view;
      if (el.dataset.tab) state.homeTab = el.dataset.tab;
      state.menuId = "";
      state.scrollReset = true;
      state.resetArmed = false;
      commit();
      return;
    }
    if (action === "home-tab" || action === "week-tab") {
      var picked = el.dataset.tab;
      state.view = "today";
      if (picked === "today") state.homeTab = "today";
      else if (picked === "week") state.homeTab = state.homeTab === "next" ? "next" : "this";
      else state.homeTab = picked === "next" ? "next" : "this";
      state.weekTab = state.homeTab === "next" ? "next" : "this";
      state.railIndex = null;
      state.scrollReset = true;
      commit();
      return;
    }
    if (action === "rail-shift") {
      shiftRail(el);
      return;
    }
    if (action === "task-scope") {
      state.taskScope = el.dataset.scope === "later" ? "later" : "today";
      if (state.taskScope === "later") ensureLaterMonth(state);
      state.railIndex = null;
      persist();
      render();
      return;
    }
    if (action === "board-mode") {
      state.boardMode = el.dataset.mode === "calendar" ? "calendar" : "cards";
      if (state.boardMode === "calendar") ensureLaterMonth(state);
      persist();
      render();
      return;
    }
    if (action === "later-shift") {
      var laterView = ensureLaterMonth(state);
      var shiftedLater = shiftMonth(laterView.year, laterView.month, Number(el.dataset.dir));
      state.laterMonth.year = shiftedLater.year;
      state.laterMonth.month = shiftedLater.month;
      state.laterMonth.date = iso(new Date(shiftedLater.year, shiftedLater.month - 1, 1));
      persist();
      render();
      return;
    }
    if (action === "later-pick") {
      var pickedLater = parseISO(el.dataset.date);
      state.laterMonth = { year: pickedLater.getFullYear(), month: pickedLater.getMonth() + 1, date: el.dataset.date };
      persist();
      render();
      return;
    }
    if (action === "open-idea" || action === "toggle-add") {
      state.modal = { kind: "idea" };
      render();
      return;
    }
    if (action === "open-remind") {
      state.modal = { kind: "new-remind" };
      render();
      return;
    }
    if (action === "open-event") {
      state.modal = { kind: "event", id: "", draft: blankEvent() };
      render();
      return;
    }
    if (action === "edit-event") {
      var record = eventById(el.dataset.id);
      if (!record) return;
      state.modal = { kind: "event", id: record.id, draft: { title: record.title, date: record.date, area: record.area, note: record.note, remindDate: record.remindDate || "", remindTime: record.remindTime || "" } };
      render();
      return;
    }
    if (action === "delete-event") {
      if (state.eventDeleteId !== el.dataset.id) {
        state.eventDeleteId = el.dataset.id;
        render();
        return;
      }
      state.events = (state.events || []).filter(function (item) { return item.id !== el.dataset.id; });
      state.eventDeleteId = "";
      commit("已删除。");
      return;
    }
    if (action === "delete-custom-remind" || action === "delete-remind") {
      removeReminder(el.dataset.id);
      return;
    }
    if (action === "edit-remind") {
      var editingRemind = findReminder(state, el.dataset.id);
      if (!editingRemind) return;
      state.modal = { kind: "edit-remind", draft: { id: editingRemind.id, kind: editingRemind.kind, title: editingRemind.title, date: editingRemind.date, time: editingRemind.time, day: editingRemind.day } };
      render();
      return;
    }
    if (action === "confirm-today") {
      state.todayStatus.status = "executing";
      commit("今天开始执行。");
      return;
    }
    if (action === "toggle-done") {
      if (state.todayStatus.status !== "executing") {
        toast("先按此执行，再勾完成。");
        render();
        return;
      }
      var item = findItem(state, el.dataset.id);
      if (!item) return;
      item.state = item.state === "done" ? "pending" : "done";
      var task = taskById(state, item.taskId);
      if (task) task.status = item.state === "done" ? "done" : "planned";
      commit();
      return;
    }
    if (action === "defer") {
      state.modal = { kind: "defer", itemId: el.dataset.id };
      render();
      return;
    }
    if (action === "close-modal") {
      state.modal = null;
      render();
      return;
    }
    if (action === "defer-to") {
      var target = findItem(state, el.dataset.id);
      if (target) {
        if (el.dataset.choice === "pool") returnToPool(target);
        else moveTask(target, el.dataset.choice);
      }
      state.modal = null;
      commit(el.dataset.choice === "pool" ? "已放回待安排。" : "已改期。");
      return;
    }
    if (action === "open-panel") {
      var pending = todayItems(state).filter(function (entry) { return entry.checkable && entry.state !== "done"; });
      if (!pending.length) {
        if (el.dataset.mode === "close") {
          state.todayStatus.status = "closed";
          state.todayStatus.summary = { done: todayItems(state).map(function (entry) { return entry.title; }), moved: [], pooled: [], dropped: [] };
          commit("今天的安排都完成了。");
        } else {
          toast("今天没有要改的安排。");
          render();
        }
        return;
      }
      var choices = {};
      pending.forEach(function (entry) { choices[entry.id] = "pool"; });
      state.panel = { mode: el.dataset.mode, choices: choices };
      render();
      return;
    }
    if (action === "choose") {
      if (state.panel) state.panel.choices[el.dataset.id] = el.dataset.choice;
      render();
      return;
    }
    if (action === "apply-panel") {
      applyPanel(state.panel && state.panel.mode === "close");
      return;
    }
    if (action === "close-panel") {
      state.panel = null;
      render();
      return;
    }
    if (action === "reopen-today") {
      state.todayStatus.status = "executing";
      state.todayStatus.summary = null;
      commit("今天重新打开了。");
      return;
    }
    if (action === "dismiss-morning") {
      state.dismissed["morning-" + todayIso()] = true;
      commit();
      return;
    }
    if (action === "confirm-week") {
      state.nextWeek.status = "confirmed";
      activeItems(state.nextWeek).forEach(function (entry) {
        var task = taskById(state, entry.taskId);
        if (task) task.status = "planned";
      });
      commit("下周已确认。到了那一天，仍会请你确认一次今天。");
      return;
    }
    if (action === "regen-week") {
      regenerate();
      return;
    }
    if (action === "remove-item") {
      var removing = findItem(state, el.dataset.id);
      if (removing) returnToPool(removing);
      state.nextWeek.items = state.nextWeek.items.filter(function (entry) { return entry.state !== "removed"; });
      markFocus(activeItems(state.nextWeek));
      commit("已移出下周建议，先记在想法池。");
      return;
    }
    if (action === "release-task") {
      var releasing = taskById(state, el.dataset.id);
      if (releasing) {
        releasing.hold = false;
        releasing.status = "inbox";
      }
      regenerate("已交给系统排。新的一周建议需要再确认。");
      return;
    }
    if (action === "hold-task") {
      var holding = taskById(state, el.dataset.id);
      if (holding) {
        holding.hold = true;
        state.nextWeek.unscheduled = (state.nextWeek.unscheduled || []).filter(function (id) { return id !== holding.id; });
      }
      commit("先记着，这周不再排它。");
      return;
    }
    if (action === "reminder-done") {
      if (el.dataset.item) {
        if (state.todayStatus.status !== "executing") {
          toast("先确认今天的计划，再把事情标成完成。");
          render();
          return;
        }
        var linked = findItem(state, el.dataset.item);
        if (linked) linked.state = "done";
      }
      state.reminderNotes[el.dataset.id] = "已处理";
      commit();
      return;
    }
    if (action === "reminder-snooze") {
      state.reminderNotes[el.dataset.id] = "30 分钟后再看";
      commit("已稍后提醒。");
      return;
    }
    if (action === "reminder-shift") {
      state.reminderNotes[el.dataset.id] = "改到今晚再看";
      commit("已改到今晚。");
      return;
    }
    if (action === "reminder-move") {
      if (el.dataset.item) {
      state.modal = { kind: "defer", itemId: el.dataset.item };
      state.view = "today";
      state.homeTab = "today";
        render();
        return;
      }
      state.view = "today";
      state.scrollReset = true;
      commit();
      return;
    }
    if (action === "add-fixed") {
      readSettingsForm();
      state.settings.fixed.push({ id: uid("f-"), title: "新的固定日程", weekdays: [1], start: "19:00", end: "20:00", kind: "fixed", area: "生活" });
      render();
      return;
    }
    if (action === "remove-fixed") {
      readSettingsForm();
      state.settings.fixed = state.settings.fixed.filter(function (item) { return item.id !== el.dataset.id; });
      render();
      return;
    }
    if (action === "toggle-fixed-day") {
      readSettingsForm();
      var fixed = null;
      state.settings.fixed.forEach(function (item) { if (item.id === el.dataset.id) fixed = item; });
      if (!fixed) return;
      var day = Number(el.dataset.day);
      var index = fixed.weekdays.indexOf(day);
      if (index === -1) fixed.weekdays.push(day);
      else fixed.weekdays.splice(index, 1);
      render();
      return;
    }
    if (action === "toggle-workday") {
      readSettingsForm();
      var workday = Number(el.dataset.day);
      var at = state.settings.workdays.indexOf(workday);
      if (at === -1) state.settings.workdays.push(workday);
      else state.settings.workdays.splice(at, 1);
      render();
      return;
    }
    if (action === "become-goal") {
      openGoalComposer(taskById(state, el.dataset.id), null);
      render();
      return;
    }
    if (action === "new-goal") {
      openGoalComposer(null, null);
      render();
      return;
    }
    if (action === "edit-goal") {
      openGoalComposer(null, goalById(state, el.dataset.id));
      render();
      return;
    }
    if (action === "add-goal-step") {
      var goalForm = document.querySelector("[data-action='save-goal']");
      readGoalForm(goalForm);
      state.modal.draft.steps.push(blankStep());
      render();
      return;
    }
    if (action === "remove-goal-step") {
      readGoalForm(document.querySelector("[data-action='save-goal']"));
      state.modal.draft.steps = state.modal.draft.steps.filter(function (step) { return step.id !== el.dataset.step; });
      if (!state.modal.draft.steps.length) state.modal.draft.steps.push(blankStep());
      render();
      return;
    }
    if (action === "open-calendar" || action === "open-plan") {
      var today = parseISO(todayIso());
      state.view = "goals";
      state.goalCalendar = { goalId: el.dataset.id, year: today.getFullYear(), month: today.getMonth() + 1, date: todayIso() };
      state.scrollReset = true;
      commit();
      return;
    }
    if (action === "toggle-week-day") {
      var rhythmGoal = goalById(state, el.dataset.id);
      if (!rhythmGoal) return;
      readOpenRhythm(rhythmGoal);
      var week = weekPlanOf(rhythmGoal);
      var weekday = Number(el.dataset.day);
      var at = week.weekdays.indexOf(weekday);
      if (at === -1) week.weekdays.push(weekday);
      else week.weekdays.splice(at, 1);
      commit();
      return;
    }
    if (action === "save-week-rhythm" || action === "save-month-rhythm") {
      var rhythmOwner = goalById(state, el.dataset.id);
      if (!rhythmOwner) return;
      readOpenRhythm(rhythmOwner);
      commit(action === "save-week-rhythm" ? "每周安排已记下。" : "每月安排已记下。");
      return;
    }
    if (action === "close-calendar") {
      state.goalCalendar = null;
      commit();
      return;
    }
    if (action === "cal-shift") {
      if (!state.goalCalendar) return;
      readOpenRhythm(goalById(state, state.goalCalendar.goalId));
      var shifted = shiftMonth(state.goalCalendar.year, state.goalCalendar.month, Number(el.dataset.dir));
      state.goalCalendar.year = shifted.year;
      state.goalCalendar.month = shifted.month;
      render();
      return;
    }
    if (action === "pick-day") {
      if (!state.goalCalendar) return;
      readOpenRhythm(goalById(state, state.goalCalendar.goalId));
      var picked = parseISO(el.dataset.date);
      state.goalCalendar.date = el.dataset.date;
      state.goalCalendar.year = picked.getFullYear();
      state.goalCalendar.month = picked.getMonth() + 1;
      render();
      return;
    }
    if (action === "add-plan-step") {
      var owner = goalById(state, el.dataset.id);
      if (!owner) return;
      readOpenRhythm(owner);
      owner.plan = owner.plan || [];
      owner.plan.push(blankStep("", el.dataset.date, 30));
      commit();
      return;
    }
    if (action === "delete-plan-step") {
      var removingGoal = goalById(state, el.dataset.goal);
      if (!removingGoal) return;
      removingGoal.plan = (removingGoal.plan || []).filter(function (step) { return step.id !== el.dataset.step; });
      commit();
      return;
    }
    if (action === "open-capture") {
      state.modal = { kind: "capture", expanded: false, draft: blankCapture() };
      render();
      return;
    }
    if (action === "capture-inbox") {
      saveInbox(readCaptureForm());
      return;
    }
    if (action === "capture-more") {
      var draft = readCaptureForm();
      state.modal = { kind: "capture", expanded: true, draft: draft };
      render();
      return;
    }
    if (action === "home-done" || action === "alert-done") {
      completeHomeTask(el.dataset.id);
      return;
    }
    if (action === "home-edit") {
      state.menuId = "";
      state.modal = { kind: "edit-home", id: el.dataset.id };
      render();
      return;
    }
    if (action === "home-defer") {
      state.menuId = "";
      state.modal = { kind: "defer-home", id: el.dataset.id };
      render();
      return;
    }
    if (action === "home-menu") {
      state.menuId = state.menuId === el.dataset.id ? "" : el.dataset.id;
      state.menuDeleteId = "";
      render();
      return;
    }
    if (action === "home-delete") {
      if (state.menuDeleteId !== el.dataset.id) {
        state.menuDeleteId = el.dataset.id;
        render();
        return;
      }
      state.homeTasks = homeTasks(state).filter(function (task) { return task.id !== el.dataset.id; });
      state.menuId = "";
      state.menuDeleteId = "";
      commit("已删除。");
      return;
    }
    if (action === "toggle-done-list") {
      state.doneOpen = !state.doneOpen;
      render();
      return;
    }
    if (action === "open-reschedule") {
      state.rescheduleOpen = true;
      render();
      return;
    }
    if (action === "close-reschedule") {
      state.rescheduleOpen = false;
      render();
      return;
    }
    if (action === "reschedule-tomorrow") {
      moveHomeDate(el.dataset.id, iso(addDays(parseISO(todayIso()), 1)));
      return;
    }
    if (action === "reschedule-one") {
      var picked = document.querySelector('[data-reschedule-date="' + el.dataset.id + '"]');
      if (!picked || !picked.value) {
        toast("先选一个日期。");
        render();
        return;
      }
      moveHomeDate(el.dataset.id, picked.value);
      return;
    }
    if (action === "alert-snooze") {
      var snoozed = homeById(el.dataset.id);
      if (snoozed) snoozed.snoozeUntil = plusMinutes(30);
      commit("30 分钟后再提醒。");
      return;
    }
    if (action === "ask-notify") {
      if (window.Notification && Notification.requestPermission) {
        Notification.requestPermission().then(function () {
          scanReminders();
          render();
        });
      }
    }
  }

  function onSubmit(event) {
    var form = event.target.closest("[data-action]");
    if (!form) return;
    event.preventDefault();
    if (form.dataset.action === "add-task") addTask(form);
    if (form.dataset.action === "save-goal") saveGoal(form);
    if (form.dataset.action === "save-capture") {
      var captured = readCaptureForm(form);
      if (state.modal && state.modal.expanded) saveScheduled(captured);
      else saveInbox(captured);
    }
    if (form.dataset.action === "save-home-task") saveHomeEdit(form);
    if (form.dataset.action === "save-event") saveEvent(form);
    if (form.dataset.action === "save-home-defer") {
      var moving = homeById(state.modal && state.modal.id);
      if (moving && form.taskDate.value) moveHomeDate(moving.id, form.taskDate.value);
    }
    if (form.dataset.action === "save-settings") {
      readSettingsForm();
      commit("作息已保存。到下周建议里重新生成后，新的空档才会生效。");
    }
    if (form.dataset.action === "add-custom-remind") {
      var title = form.title.value.trim();
      if (!title || !form.date.value || !form.time.value) {
        toast("提醒的事情、日期和时间都要填。");
        render();
        return;
      }
      state.customReminders = state.customReminders || [];
      state.customReminders.unshift({ id: uid("r-"), title: title, date: form.date.value, time: form.time.value });
      state.modal = null;
      commit("这条临时提醒已记下。");
    }
    if (form.dataset.action === "save-remind") saveRemind(form);
  }

  function onChange(event) {
    var el = event.target.closest("[data-action]");
    if (!el) return;
    if (el.dataset.action === "move-next-item") {
      var item = findItem(state, el.dataset.id);
      if (item) moveTask(item, el.value);
      commit("已改到这一天。");
    }
    if (el.dataset.action === "set-priority") {
      var planItem = findItem(state, el.dataset.id);
      if (planItem) {
        planItem.priority = el.value;
        var task = taskById(state, planItem.taskId);
        if (task) task.priority = el.value;
        markFocus(activeItems(state.nextWeek));
      }
      commit("优先级已改。重点会按高优先级里耗时最长的 3 件重算。");
    }
    if (el.dataset.action === "goal-progress") {
      state.goals.forEach(function (goal) {
        if (goal.id === el.dataset.id) goal.progress = Number(el.value);
      });
      commit();
    }
    if (el.dataset.action === "set-remind") {
      if (el.dataset.key === "remindAt" || el.dataset.key === "eveningCheck") state.settings[el.dataset.key] = el.value;
      commit("提醒时间已改。");
    }
    if (el.dataset.action === "set-weekly-day") {
      state.settings.weeklyReview = state.settings.weeklyReview || { weekday: 0, time: "20:30" };
      state.settings.weeklyReview.weekday = Number(el.value);
      commit("每周复盘的日子已改。");
    }
    if (el.dataset.action === "set-weekly-time") {
      state.settings.weeklyReview = state.settings.weeklyReview || { weekday: 0, time: "20:30" };
      state.settings.weeklyReview.time = el.value;
      commit("每周复盘的时间已改。");
    }
    if (el.dataset.action === "plan-day-note") {
      var noted = goalById(state, el.dataset.id);
      if (!noted || !state.goalCalendar || !state.goalCalendar.date) return;
      readOpenRhythm(noted);
      noted.dayNotes = noted.dayNotes || {};
      var writing = el.value.trim();
      if (writing) noted.dayNotes[state.goalCalendar.date] = writing;
      else delete noted.dayNotes[state.goalCalendar.date];
      commit("这一天的注释已记下。");
      return;
    }
    if (el.dataset.action === "plan-title" || el.dataset.action === "plan-minutes" || el.dataset.action === "plan-date" || el.dataset.action === "plan-note" || el.dataset.action === "plan-remind-date" || el.dataset.action === "plan-remind-time") {
      var found = findPlanStep(el.dataset.goal, el.dataset.step);
      if (!found) return;
      readOpenRhythm(found.goal);
      if (el.dataset.action === "plan-title") found.step.title = el.value;
      if (el.dataset.action === "plan-minutes") found.step.minutes = clamp(el.value, 10, 240);
      if (el.dataset.action === "plan-note") found.step.note = el.value;
      if (el.dataset.action === "plan-remind-date") found.step.remindDate = el.value;
      if (el.dataset.action === "plan-remind-time") found.step.remindTime = el.value;
      if (el.dataset.action === "plan-date") {
        found.step.date = el.value;
        if (el.value && state.goalCalendar) {
          var moved = parseISO(el.value);
          state.goalCalendar.year = moved.getFullYear();
          state.goalCalendar.month = moved.getMonth() + 1;
          state.goalCalendar.date = el.value;
        }
      }
      commit(el.dataset.action === "plan-date" && el.value ? "已改到这一天。" : "");
    }
  }

  function optionalMinutes(value) {
    if (value == null || String(value).trim() === "") return null;
    var number = Number(value);
    if (!number || number < 5) return null;
    return Math.min(480, number);
  }

  function readCaptureForm(form) {
    form = form || document.querySelector("[data-action='save-capture']");
    var draft = blankCapture();
    if (!form) return draft;
    draft.title = form.title ? form.title.value.trim() : "";
    if (form.area) draft.area = form.area.value;
    if (form.priority) draft.priority = form.priority.value;
    if (form.minutes) draft.minutes = form.minutes.value;
    if (form.taskDate) draft.taskDate = form.taskDate.value;
    if (form.remindDate) draft.remindDate = form.remindDate.value;
    if (form.remindTime) draft.remindTime = form.remindTime.value;
    return draft;
  }

  function saveInbox(draft) {
    if (!draft.title) {
      toast("先写上这件事。");
      render();
      return;
    }
    state.tasks.push({
      id: uid("u-"),
      title: draft.title,
      area: draft.area || "生活",
      priority: draft.priority || "中",
      minutes: optionalMinutes(draft.minutes) || 30,
      due: null,
      type: "一次性",
      bucket: "next",
      status: "inbox",
      hold: true,
      goalId: null
    });
    state.modal = null;
    commit("已放进收集箱。首页先不展示它。");
  }

  function askNotifyIfNeeded(remindTime) {
    if (!remindTime || !window.Notification) return;
    if (Notification.permission === "default" && Notification.requestPermission) Notification.requestPermission();
  }

  function saveScheduled(draft) {
    if (!draft.title) {
      toast("先写上这件事。");
      render();
      return;
    }
    if (!draft.taskDate) {
      toast("先选任务日期。只是想记下来的话，放进收集箱。");
      render();
      return;
    }
    var remindDate = draft.remindDate;
    if (draft.remindTime && !remindDate) remindDate = draft.taskDate;
    state.homeTasks.push({
      id: uid("h-"),
      title: draft.title,
      area: draft.area || "生活",
      priority: draft.priority || "中",
      minutes: optionalMinutes(draft.minutes),
      taskDate: draft.taskDate,
      remindDate: remindDate || "",
      remindTime: draft.remindTime || "",
      status: "pending",
      completedAt: "",
      completedOn: "",
      snoozeUntil: ""
    });
    state.modal = null;
    state.view = "today";
    askNotifyIfNeeded(draft.remindTime);
    commit("已按这个日期放进首页。");
  }

  function saveHomeEdit(form) {
    var task = homeById(state.modal && state.modal.id);
    if (!task) return;
    var title = form.title.value.trim();
    if (!title || !form.taskDate.value) return;
    var previousRemind = task.remindDate + "T" + task.remindTime;
    task.title = title;
    task.area = form.area.value;
    task.priority = form.priority.value;
    task.minutes = optionalMinutes(form.minutes.value);
    task.taskDate = form.taskDate.value;
    task.remindTime = form.remindTime.value;
    task.remindDate = form.remindTime.value ? (form.remindDate.value || form.taskDate.value) : (form.remindDate.value || "");
    if (previousRemind !== task.remindDate + "T" + task.remindTime) task.snoozeUntil = "";
    state.modal = null;
    askNotifyIfNeeded(task.remindTime);
    commit("任务已更新。");
  }

  function completeHomeTask(id) {
    var task = homeById(id);
    if (!task || task.status === "done") return;
    task.status = "done";
    task.completedAt = nowClock();
    task.completedOn = todayIso();
    state.menuId = "";
    state.modal = null;
    commit("已完成。");
  }

  function moveHomeDate(id, date) {
    var task = homeById(id);
    if (!task || !date) return;
    var oldDate = task.taskDate;
    if (task.remindDate && task.remindDate === oldDate) task.remindDate = date;
    task.taskDate = date;
    task.status = "deferred";
    task.snoozeUntil = "";
    state.modal = null;
    if (!overdueTasks(state).length) state.rescheduleOpen = false;
    commit("已改到 " + monthDay(date) + "。");
  }

  function scanReminders() {
    if (!state || !state.homeTasks || !window.Notification || Notification.permission !== "granted") return;
    var changed = false;
    dueAlerts(state).forEach(function (task) {
      var key = task.id + "|" + task.remindDate + "|" + task.remindTime + "|" + (task.snoozeUntil || "");
      if (state.notified[key]) return;
      state.notified[key] = true;
      changed = true;
      try {
        var note = new Notification(task.title, { body: task.remindTime + " 到了。回到页面可以完成、稍后或改期。" });
        note.onclick = function () { window.focus(); };
      } catch (error) {}
    });
    if (changed) persist();
  }

  function eventById(id) {
    var list = state.events || [];
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function saveEvent(form) {
    var title = form.title.value.trim();
    var note = form.note.value.trim();
    var date = form.date.value;
    if (!title || !note || !date) {
      toast("事件、日期和记录都要填。");
      render();
      return;
    }
    var editing = !!(state.modal && state.modal.id);
    if (editing) {
      var current = eventById(state.modal.id);
      if (current) {
        current.title = title;
        current.date = date;
        current.area = form.area.value;
        current.note = note;
        current.remindDate = form.remindDate ? form.remindDate.value : "";
        current.remindTime = form.remindTime ? form.remindTime.value : "";
      }
    } else {
      state.events.unshift({ id: uid("e-"), title: title, date: date, area: form.area.value, note: note, remindDate: form.remindDate ? form.remindDate.value : "", remindTime: form.remindTime ? form.remindTime.value : "" });
    }
    state.modal = null;
    commit(editing ? "记录已更新。" : "这条重要事件已记下。");
  }

  function railStep(rail) {
    var card = rail.querySelector(".lane, .task-card");
    return card ? card.getBoundingClientRect().width + 12 : 280;
  }

  function placeRail() {
    var rail = document.querySelector('[data-rail="days"]');
    if (!rail) return;
    var index = 0;
    var today = todayIso();
    rail.querySelectorAll(".lane").forEach(function (lane, at) {
      if (lane.dataset.dropDate === today) index = at;
    });
    rail.scrollLeft = index * railStep(rail);
  }

  function shiftRail(el) {
    var wrap = el.closest(".rail-wrap");
    var rail = wrap && wrap.querySelector(".rail");
    if (!rail) return;
    var step = railStep(rail) || 280;
    var dir = Number(el.dataset.dir);
    if (rail.dataset.rail === "days") {
      var total = rail.querySelectorAll(".lane").length;
      var index = Math.max(0, Math.min(total - 1, Math.round(rail.scrollLeft / step) + dir));
      rail.scrollTo({ left: index * step, behavior: "smooth" });
      return;
    }
    rail.scrollBy({ left: dir * step, behavior: "smooth" });
  }

  function clearDrag() {
    if (drag && drag.ghost) drag.ghost.remove();
    if (drag && drag.card) drag.card.classList.remove("is-source");
    document.querySelectorAll("[data-drop-date].is-over").forEach(function (lane) { lane.classList.remove("is-over"); });
    drag = null;
  }

  function markDrop(event) {
    document.querySelectorAll("[data-drop-date].is-over").forEach(function (lane) { lane.classList.remove("is-over"); });
    var under = document.elementFromPoint(event.clientX, event.clientY);
    var lane = under && under.closest("[data-drop-date]");
    if (lane) lane.classList.add("is-over");
    return lane;
  }

  function bindDrag(app) {
    app.addEventListener("pointerdown", function (event) {
      if (drag || state.modal || event.button) return;
      var card = event.target.closest("[data-drag-id]");
      if (!card || event.target.closest("button, a, input, select, textarea")) return;
      drag = {
        id: card.dataset.dragId,
        kind: card.dataset.dragKind,
        card: card,
        x: event.clientX,
        y: event.clientY,
        pointerId: event.pointerId,
        moved: false,
        ghost: null
      };
    });
    app.addEventListener("pointermove", function (event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      var dx = event.clientX - drag.x;
      var dy = event.clientY - drag.y;
      if (!drag.moved) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        drag.moved = true;
        var rect = drag.card.getBoundingClientRect();
        var ghost = drag.card.cloneNode(true);
        ghost.classList.add("drag-ghost");
        ghost.style.width = rect.width + "px";
        ghost.style.left = rect.left + "px";
        ghost.style.top = rect.top + "px";
        ghost.style.pointerEvents = "none";
        document.body.appendChild(ghost);
        drag.ghost = ghost;
        drag.card.classList.add("is-source");
        try { drag.card.setPointerCapture(event.pointerId); } catch (error) {}
      }
      event.preventDefault();
      drag.ghost.style.left = (drag.card.getBoundingClientRect().left + dx) + "px";
      drag.ghost.style.top = (drag.card.getBoundingClientRect().top + dy) + "px";
      markDrop(event);
    }, { passive: false });
    function endDrag(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      var moved = drag.moved;
      var id = drag.id;
      var kind = drag.kind;
      var lane = moved ? markDrop(event) : null;
      clearDrag();
      if (!moved) return;
      suppressClick = true;
      if (!lane || !lane.dataset.dropDate) return;
      if (kind === "home") {
        var task = homeById(id);
        if (!task || task.taskDate === lane.dataset.dropDate) return;
        moveHomeDate(id, lane.dataset.dropDate);
        return;
      }
      var item = findItem(state, id);
      if (!item || item.date === lane.dataset.dropDate) return;
      moveTask(item, lane.dataset.dropDate);
      commit("已改到 " + monthDay(lane.dataset.dropDate) + "。");
    }
    app.addEventListener("pointerup", endDrag);
    app.addEventListener("pointercancel", function (event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      clearDrag();
    });
  }

  function boot() {
    var app = document.getElementById("app");
    app.addEventListener("click", onClick);
    app.addEventListener("submit", onSubmit);
    app.addEventListener("change", onChange);
    bindDrag(app);
    var local = readStored();
    fetch("/api/state").then(function (res) {
      if (!res.ok) return null;
      return res.json();
    }).then(function (remote) {
      return storedState(remote);
    }).catch(function () {
      return null;
    }).then(function (remote) {
      state = pickState(local, remote);
      persist();
      render();
      scanReminders();
      setInterval(scanReminders, 20000);
    });
  }

  if (typeof document === "undefined") {
    var sample = createInitialState();
    var lines = sample.nextWeek.items.slice().sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : a.start - b.start;
    }).map(function (item) {
      return item.date + " " + fromMin(item.start) + "-" + fromMin(item.end) + " " + item.title + " | " + item.reason + (item.focus ? " | 重点" : "");
    });
    console.log(lines.join("\n"));
    console.log("UNSCHEDULED");
    sample.nextWeek.unscheduled.forEach(function (id) {
      var task = sample.tasks.filter(function (item) { return item.id === id; })[0];
      console.log(task.title, task.minutes);
    });
  } else {
    boot();
  }
})();
