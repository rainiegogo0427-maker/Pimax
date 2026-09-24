(function (root) {
  "use strict";

  const DAY_MS = 24 * 60 * 60 * 1000;
  const RULES = {
    unconnected: { days: 14, stage: "未建联", target: "公海", fallback: "claimedDate", fallbackLabel: "认领日" },
    negotiating: { days: 14, stage: "谈判中", target: "公海", fallback: "stageDate", fallbackLabel: "进入谈判日" },
    signed: { days: 28, stage: "已签约", target: "待分配池", fallback: "stageDate", fallbackLabel: "签约日" }
  };

  function parseDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
    return date.getTime();
  }

  function formatDate(timestamp) {
    return new Date(timestamp).toISOString().slice(0, 10);
  }

  function calculate(task, today) {
    const rule = RULES[task.krmStage];
    if (!rule) return null;
    const todayMs = parseDate(today);
    if (todayMs === null) throw new Error("今天的日期无效");
    const candidates = [
      { date: task.lastActivityDate, label: "最后触达/沟通日" },
      { date: task[rule.fallback], label: rule.fallbackLabel }
    ].filter((item) => item.date && parseDate(item.date) !== null);
    if (!candidates.length) return { status: "missing", stage: rule.stage, target: rule.target, days: rule.days };
    candidates.sort((a, b) => parseDate(b.date) - parseDate(a.date));
    const baseline = candidates[0];
    if (parseDate(baseline.date) > todayMs) {
      return { status: "invalid", stage: rule.stage, target: rule.target, days: rule.days, baseDate: baseline.date, basis: baseline.label };
    }
    const deadlineMs = parseDate(baseline.date) + rule.days * DAY_MS;
    return {
      status: "ready",
      stage: rule.stage,
      target: rule.target,
      days: rule.days,
      baseDate: baseline.date,
      basis: baseline.label,
      deadline: formatDate(deadlineMs),
      remainingDays: Math.round((deadlineMs - todayMs) / DAY_MS)
    };
  }

  const api = { calculate, isValidDate: (value) => parseDate(value) !== null };
  if (root) root.KrmCountdown = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : null);
