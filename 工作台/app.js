(function () {
  "use strict";

  const STORAGE_KEY = "pimax-kol-workbench-v1";
  const CATEGORIES = ["today", "progress", "focus", "future"];
  const PRIORITIES = { high: 0, medium: 1, low: 2 };
  const SOURCE_LABELS = { manual: "手动", main: "KOL 主表", followup: "跟进记录", candidate: "候选名单", workbook: "跟进表单", krm: "KRM 摘要" };
  const FLOW_LABELS = { uncontacted: "尚未触达", no_reply: "已触达未回复", reply_pending: "已回复待核对跟进", collaboration: "合作推进", collaboration_review: "合作状态待核实", script: "样机与脚本", verify: "候选待核实" };
  const KRM_STAGE_LABELS = { unconnected: "未建联", negotiating: "谈判中", signed: "已签约", allocation: "待分配池", public: "公海" };
  const $ = (id) => document.getElementById(id);
  let today = localDate(new Date());
  let state = loadState();

  function localDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function clean(value, max = 400) {
    return String(value == null ? "" : value).trim().slice(0, max);
  }

  function validDate(value) {
    const date = clean(value, 10);
    return window.KrmCountdown.isValidDate(date) ? date : "";
  }

  function normalizeTask(value) {
    if (!value || typeof value !== "object") return null;
    const title = clean(value.title, 120);
    if (!title) return null;
    return {
      id: clean(value.id, 180) || `manual:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      title,
      category: CATEGORIES.includes(value.category) ? value.category : "future",
      type: value.source === "candidate" && value.type === "KOL 触达" ? "KOL 核实" : clean(value.type, 40) || "其他",
      priority: Object.hasOwn(PRIORITIES, value.priority) ? value.priority : "medium",
      due: validDate(value.due),
      person: clean(value.person, 100),
      next: clean(value.next, 400),
      source: Object.hasOwn(SOURCE_LABELS, value.source) ? value.source : "manual",
      flow: Object.hasOwn(FLOW_LABELS, value.flow) ? value.flow : "",
      evidence: clean(value.evidence, 300),
      need: clean(value.need, 300),
      krmStage: Object.hasOwn(KRM_STAGE_LABELS, value.krmStage) ? value.krmStage : "",
      claimedDate: validDate(value.claimedDate),
      stageDate: validDate(value.stageDate),
      lastActivityDate: validDate(value.lastActivityDate),
      suggested: value.suggested === true,
      done: value.done === true,
      edited: value.edited === true
    };
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return { tasks: Array.isArray(saved.tasks) ? saved.tasks.slice(0, 5000).map(normalizeTask).filter(Boolean) : [], imports: saved.imports && typeof saved.imports === "object" ? saved.imports : {} };
    } catch (_) {
      return { tasks: [], imports: {} };
    }
  }

  function persist(message) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      if (message) setStatus(message);
    } catch (_) {
      setStatus("浏览器无法保存事项，请立即导出备份。", true);
    }
  }

  function setStatus(message, isError = false) {
    const element = $("data-status");
    element.textContent = message;
    element.classList.toggle("overdue", isError);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function dateLabel(date) {
    if (!date) return "";
    if (date === today) return "今天到期";
    if (date < today) return `已超期 · ${date}`;
    return `计划 ${date}`;
  }

  function createTaskCard(task) {
    const card = el("article", `task${task.done ? " is-complete" : ""}`);
    const checkbox = el("input", "task-check");
    checkbox.type = "checkbox";
    checkbox.checked = task.done;
    checkbox.setAttribute("aria-label", `${task.done ? "取消完成" : "完成"}：${task.title}`);
    checkbox.addEventListener("change", () => {
      task.done = checkbox.checked;
      persist(task.done ? "事项已完成。" : "事项已恢复。 ");
      render();
    });
    card.append(checkbox);

    const main = el("div", "task-main");
    const line = el("div", "task-line");
    line.append(el("span", "task-title", task.title));
    line.append(el("span", `task-priority ${task.priority}`, { high: "高优先级", medium: "中优先级", low: "低优先级" }[task.priority]));
    main.append(line);
    const meta = el("div", "task-meta");
    meta.append(el("span", "", task.type));
    if (task.person) meta.append(el("span", "", task.person));
    if (task.due) meta.append(el("span", task.due < today && !task.done ? "overdue" : "", dateLabel(task.due)));
    const risk = window.KrmCountdown.calculate(task, today);
    if (risk) meta.append(riskBadge(risk));
    else if (["allocation", "public"].includes(task.krmStage)) meta.append(el("span", "overdue", `${KRM_STAGE_LABELS[task.krmStage]} · 先核对归属`));
    meta.append(el("span", "", SOURCE_LABELS[task.source]));
    main.append(meta);
    if (task.need) main.append(el("p", "task-next", `对方需要 / 待确认：${task.need}`));
    if (task.next) main.append(el("p", "task-next", task.next));
    if (task.evidence) main.append(el("p", "task-evidence", `依据：${task.evidence}`));
    const actions = el("div", "task-actions");
    const edit = el("button", "text-button", "编辑");
    edit.type = "button";
    edit.addEventListener("click", () => openDialog(task));
    actions.append(edit);
    if (task.source === "manual") {
      const remove = el("button", "text-button", "删除");
      remove.type = "button";
      remove.addEventListener("click", () => {
        if (!window.confirm(`确定删除“${task.title}”吗？删除后只能从备份恢复。`)) return;
        state.tasks = state.tasks.filter((item) => item.id !== task.id);
        persist("事项已删除。");
        render();
      });
      actions.append(remove);
    }
    main.append(actions);
    card.append(main);
    return card;
  }

  function sortTasks(a, b) {
    return Number(a.done) - Number(b.done) || PRIORITIES[a.priority] - PRIORITIES[b.priority] || (a.due || "9999").localeCompare(b.due || "9999") || a.title.localeCompare(b.title, "zh-CN");
  }

  function accountKey(person) {
    return clean(person).toLocaleLowerCase().replace(/[\s_@-]/g, "");
  }

  function render() {
    const showCompleted = $("show-completed").checked;
    const activeFollowups = new Set(state.tasks.filter((task) => ["followup", "workbook", "krm"].includes(task.source) && !task.done).map((task) => accountKey(task.person)));
    for (const category of CATEGORIES) {
      const list = $(`list-${category}`);
      list.replaceChildren();
      const tasks = state.tasks.filter((task) => displayCategory(task) === category && (showCompleted || !task.done) && !(task.source === "main" && activeFollowups.has(accountKey(task.person)))).sort(sortTasks);
      $(`count-${category}`).textContent = String(tasks.filter((task) => !task.done).length);
      if (tasks.length === 0) {
        list.append(el("div", "empty", category === "today" ? "今天还没有记录的待办。添加事项，或导入台账查看到期跟进。" : "这里暂时没有事项。"));
      } else {
        for (const task of tasks) list.append(createTaskCard(task));
      }
    }
    renderDailyLists();
    renderKrmCountdown();
  }

  function riskBadge(info) {
    let label, level;
    if (info.status === "missing") { label = `${info.target}倒计时 · 待补日期`; level = "missing"; }
    else if (info.status === "invalid") { label = "日期晚于今天 · 请核对"; level = "missing"; }
    else if (info.remainingDays < 0) { label = `已超 ${-info.remainingDays} 天 · 核对 KRM`; level = "urgent"; }
    else if (info.remainingDays === 0) { label = `${info.target}今日临界`; level = "urgent"; }
    else { label = `距${info.target}还剩 ${info.remainingDays} 天`; level = info.remainingDays <= 3 ? "urgent" : info.remainingDays <= 7 ? "soon" : "normal"; }
    return el("span", `risk-chip risk-${level}`, label);
  }

  function renderKrmCountdown() {
    const entries = state.tasks.filter((task) => !task.done).map((task) => ({ task, info: window.KrmCountdown.calculate(task, today) })).filter((item) => item.info);
    const known = entries.filter((item) => item.info.status === "ready");
    const urgent = known.filter((item) => item.info.remainingDays <= 3);
    const missing = entries.length - known.length;
    $("krm-risk-total").textContent = String(entries.length);
    $("krm-risk-urgent").textContent = String(urgent.length);
    $("krm-risk-missing").textContent = String(missing);
    const list = $("krm-risk-list");
    list.replaceChildren();
    if (!entries.length) {
      list.append(el("p", "daily-empty", "还没有可计算的 KRM 阶段记录。编辑事项，填写 KRM 阶段与日期后会显示倒计时。"));
      return;
    }
    entries.sort((a, b) => (a.info.status === "ready" ? 0 : 1) - (b.info.status === "ready" ? 0 : 1) || (a.info.remainingDays ?? 9999) - (b.info.remainingDays ?? 9999) || a.task.title.localeCompare(b.task.title, "zh-CN"));
    for (const { task, info } of entries) {
      const card = el("article", "krm-risk-item");
      const heading = el("div", "krm-risk-item-head");
      heading.append(el("strong", "", task.person || task.title));
      heading.append(riskBadge(info));
      card.append(heading);
      let detail = `${info.stage} · ${info.days} 天无跟进记录 → ${info.target}`;
      if (info.status === "ready") detail += ` · ${info.basis} ${info.baseDate} · 临界日 ${info.deadline}`;
      else if (info.status === "invalid") detail += ` · ${info.basis} ${info.baseDate} 晚于今天`;
      else detail += " · 缺少认领/阶段日期或最后触达沟通日期";
      card.append(el("p", "krm-risk-detail", detail));
      const edit = el("button", "text-button", info.status === "ready" ? "更新日期" : "补录日期");
      edit.type = "button";
      edit.addEventListener("click", () => openDialog(task));
      card.append(edit);
      list.append(card);
    }
  }

  function compactCard(task) {
    const card = el("article", "daily-item");
    const head = el("div", "daily-item-head");
    head.append(el("strong", "", task.person || task.title));
    head.append(el("span", "daily-item-source", SOURCE_LABELS[task.source]));
    card.append(head);
    if (task.evidence) card.append(el("p", "daily-item-evidence", task.evidence));
    const risk = window.KrmCountdown.calculate(task, today);
    if (risk) card.append(riskBadge(risk));
    if (task.need) card.append(el("p", "daily-item-need", `对方需要 / 待确认：${task.need}`));
    card.append(el("p", "daily-item-next", task.next || task.title));
    const edit = el("button", "text-button", "编辑下一步");
    edit.type = "button";
    edit.addEventListener("click", () => openDialog(task));
    card.append(edit);
    return card;
  }

  function renderDailyLists() {
    const active = state.tasks.filter((task) => !task.done && !["allocation", "public"].includes(task.krmStage));
    const contacted = new Set(active.filter((task) => ["workbook", "followup", "krm"].includes(task.source) && task.flow !== "uncontacted").map((task) => accountKey(task.person)));
    const groups = {
      uncontacted: active.filter((task) => task.flow === "uncontacted" && !contacted.has(accountKey(task.person))),
      no_reply: active.filter((task) => task.flow === "no_reply"),
      reply_pending: active.filter((task) => task.flow === "reply_pending"),
      collaboration: active.filter((task) => ["collaboration", "collaboration_review", "reply_pending"].includes(task.flow)),
      script: active.filter((task) => task.flow === "script"),
      today: active.filter((task) => displayCategory(task) === "today" || task.suggested)
    };
    const candidates = active.filter((task) => task.flow === "verify").length;
    const empty = {
      uncontacted: `台账未记录已核实、尚未触达的 KOL。${candidates ? `${candidates} 名候选仍待核实。` : ""}`,
      no_reply: "台账未记录已触达且未回复的 KOL。",
      reply_pending: "台账未记录已回复、但缺少后续跟进记录的 KOL。",
      collaboration: "台账未记录明确的谈判或合作需求。",
      script: "台账未记录欧洲 KOL 已持有样机且需要修改脚本。",
      today: "没有记录今天到期的事项；需要先补充下次跟进日期。"
    };
    for (const [key, tasks] of Object.entries(groups)) {
      const list = $(`daily-${key}`);
      list.replaceChildren();
      $(`daily-count-${key}`).textContent = String(tasks.length);
      if (!tasks.length) list.append(el("p", "daily-empty", empty[key]));
      else for (const task of tasks.sort(sortTasks)) list.append(compactCard(task));
    }
    const diagnostics = window.PIMAX_LOCAL_SEED?.diagnostics;
    if (diagnostics && state.imports.privateSeedRevision) {
      const krmSummary = diagnostics.krm_rows ? `KRM 复制文本 ${diagnostics.krm_rows} 条，识别欧洲尚未触达 ${diagnostics.krm_europe} 条；${diagnostics.krm_outside_or_unknown} 条非欧洲或地区不明、${diagnostics.krm_unsupported_stage} 条阶段无法归类，未进入待办。` : "";
      $("source-summary").textContent = `${krmSummary}跟进表单 ${diagnostics.workbook_rows} 条；${diagnostics.outside_europe_or_unknown} 条地区不在欧洲或未知、${diagnostics.do_not_contact} 条明确拒绝未进入待办。倒计时只依据可核实的跟进或认领日期。`;
    }
  }

  function displayCategory(task) {
    if (["allocation", "public"].includes(task.krmStage)) return "future";
    const risk = window.KrmCountdown.calculate(task, today);
    return task.category !== "focus" && ((task.due && task.due <= today) || (risk?.status === "ready" && risk.remainingDays <= 3)) ? "today" : task.category;
  }

  function openDialog(task) {
    $("task-form").reset();
    $("task-id").value = task ? task.id : "";
    $("dialog-title").textContent = task ? "编辑事项" : "添加事项";
    if (task) {
      $("task-title").value = task.title;
      $("task-category").value = task.category;
      $("task-type").value = [...$("task-type").options].some((option) => option.value === task.type) ? task.type : "其他";
      $("task-priority").value = task.priority;
      $("task-due").value = task.due;
      $("task-person").value = task.person;
      $("task-next").value = task.next;
      $("task-flow").value = task.flow;
      $("task-krm-stage").value = task.krmStage;
      $("task-last-activity").value = task.lastActivityDate;
      $("task-claimed-date").value = task.claimedDate;
      $("task-stage-date").value = task.stageDate;
      $("task-need").value = task.need;
      $("task-evidence").value = task.evidence;
    }
    $("task-dialog").showModal();
    $("task-title").focus();
  }

  function saveForm(event) {
    event.preventDefault();
    const id = $("task-id").value;
    const existing = state.tasks.find((task) => task.id === id);
    const task = normalizeTask({
      id: existing ? existing.id : `manual:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      title: $("task-title").value,
      category: $("task-category").value,
      type: $("task-type").value,
      priority: $("task-priority").value,
      due: $("task-due").value,
      person: $("task-person").value,
      next: $("task-next").value,
      flow: $("task-flow").value,
      krmStage: $("task-krm-stage").value,
      lastActivityDate: $("task-last-activity").value,
      claimedDate: $("task-claimed-date").value,
      stageDate: $("task-stage-date").value,
      need: $("task-need").value,
      evidence: $("task-evidence").value,
      suggested: existing ? existing.suggested : false,
      source: existing ? existing.source : "manual",
      done: existing ? existing.done : false,
      edited: Boolean(existing)
    });
    if (!task) return;
    if (existing) Object.assign(existing, task);
    else state.tasks.push(task);
    persist(existing ? "事项已更新。" : "事项已添加。 ");
    $("task-dialog").close();
    render();
  }

  function parseCSV(text) {
    const input = text.replace(/^\uFEFF/, "");
    const rows = [];
    let row = [], field = "", quoted = false;
    for (let i = 0; i < input.length; i++) {
      const char = input[i];
      if (quoted) {
        if (char === '"' && input[i + 1] === '"') { field += '"'; i++; }
        else if (char === '"') quoted = false;
        else field += char;
      } else if (char === '"' && field === "") quoted = true;
      else if (char === ",") { row.push(field); field = ""; }
      else if (char === "\n" || char === "\r") {
        if (char === "\r" && input[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.some((cell) => cell.trim())) rows.push(row);
        row = [];
      } else field += char;
    }
    if (quoted) throw new Error("CSV 引号不完整");
    row.push(field);
    if (row.some((cell) => cell.trim())) rows.push(row);
    if (!rows.length) return [];
    const headers = rows.shift().map((cell) => cell.trim());
    return rows.map((cells) => Object.fromEntries(headers.map((header, index) => [header, clean(cells[index], 1000)])));
  }

  function detectSource(rows) {
    if (!rows.length) return null;
    const keys = rows[0];
    if (Object.hasOwn(keys, "KOL账号") && Object.hasOwn(keys, "当前状态")) return "followup";
    if (Object.hasOwn(keys, "账号名") && Object.hasOwn(keys, "公海查重结果")) return "candidate";
    if (Object.hasOwn(keys, "账号名") && Object.hasOwn(keys, "状态")) return "main";
    return null;
  }

  function sampleRow(row) {
    return Object.values(row).some((value) => clean(value, 1000).includes("这行是示例请删除")) || clean(row["账号名"] || row["KOL账号"]).includes("示例账号");
  }

  function importedTask(id, title, category, type, priority, due, person, next, source) {
    return normalizeTask({ id, title, category, type, priority, due, person, next, source });
  }

  function tasksFromRows(rows, source) {
    const output = [];
    const seen = new Set();
    for (const row of rows) {
      if (sampleRow(row)) continue;
      const account = clean(row["KOL账号"] || row["账号名"], 100);
      if (!account || seen.has(account.toLowerCase())) continue;
      seen.add(account.toLowerCase());
      let task = null;
      if (source === "main") {
        if (row["状态"] !== "待外联") continue;
        const rating = clean(row["初筛评级"]);
        task = importedTask(`main:${account.toLowerCase()}`, `触达 ${account}`, rating === "C" ? "future" : "today", "KOL 触达", rating === "A" ? "high" : "medium", "", account, "先核近期内容，再按对方内容语言准备首触；发送后更新跟进记录。", source);
        task.flow = "uncontacted";
      } else if (source === "followup") {
        const status = clean(row["当前状态"]);
        if (["已拒绝-勿再联系", "已放弃", "内容已发"].includes(status)) continue;
        if (!["未建联", "已首触", "跟进中", "谈判中", "洽谈中", "已签约", "已成交", "已发货", "已暂缓"].includes(status)) continue;
        const due = validDate(row["下次跟进日期"]);
        if (status === "已暂缓" && !due) continue;
        const category = due && due <= today ? "today" : status === "已暂缓" ? "future" : "progress";
        const title = status === "已发货" ? `确认 ${account} 样机签收与内容进度` : `跟进 ${account}`;
        const next = clean(row["卡点/等待什么"]) || (status === "已发货" ? "确认是否签收样机，并约定内容进度。" : "查看上次沟通内容，按约定时间跟进。");
        task = importedTask(`followup:${account.toLowerCase()}`, title, category, status === "已发货" ? "样机与内容" : "KOL 跟进", due && due <= today ? "high" : "medium", due, account, next, source);
        task.krmStage = { "未建联": "unconnected", "谈判中": "negotiating", "已签约": "signed" }[status] || "";
        task.lastActivityDate = validDate(row["最后联系日期"]) || validDate(row["首触日期"]);
        task.claimedDate = validDate(row["认领日期"]);
        task.stageDate = validDate(row["进入谈判日期"]) || validDate(row["签约日期"]);
      } else if (source === "candidate") {
        if (row["公海查重结果"] !== "未发现重复" || row["状态"] !== "待核实") continue;
        task = importedTask(`candidate:${account.toLowerCase()}`, `核实候选 ${account}`, "future", "KOL 核实", "low", "", account, "先核实主页、近期内容、国家和语言；通过后才进入正式主表和触达队列。", source);
        task.flow = "verify";
      }
      if (task) output.push(task);
    }
    return output;
  }

  async function importCSVs(files) {
    const parsed = [];
    const skipped = [];
    for (const file of files) {
      try {
        const rows = parseCSV(await file.text());
        const source = detectSource(rows);
        if (!source) { skipped.push(file.name); continue; }
        parsed.push({ source, tasks: tasksFromRows(rows, source) });
      } catch (_) { skipped.push(file.name); }
    }
    if (!parsed.length) { setStatus("未识别到可用的 KOL 主表、跟进记录或候选名单 CSV。", true); return; }
    const previous = new Map(state.tasks.map((task) => [task.id, task]));
    for (const group of parsed) {
      state.tasks = state.tasks.filter((task) => task.source !== group.source);
      for (const fresh of group.tasks) {
        const old = previous.get(fresh.id);
        if (old) {
          fresh.done = old.done;
          if (old.edited) Object.assign(fresh, { title: old.title, category: old.category, type: old.type, priority: old.priority, due: old.due, person: old.person, next: old.next, flow: old.flow, evidence: old.evidence, need: old.need, krmStage: old.krmStage, lastActivityDate: old.lastActivityDate, claimedDate: old.claimedDate, stageDate: old.stageDate, suggested: old.suggested, edited: true });
        }
        state.tasks.push(fresh);
      }
      state.imports[group.source] = { date: today, count: group.tasks.length };
    }
    const total = parsed.reduce((sum, group) => sum + group.tasks.length, 0);
    persist(`已导入 ${parsed.length} 份台账，生成 ${total} 个事项；跳过示例、已拒绝或暂不可触达的记录。${skipped.length ? ` 未识别：${skipped.join("、")}` : ""}`);
    render();
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), tasks: state.tasks, imports: state.imports }, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = el("a");
    link.href = url;
    link.download = `工作台备份-${today}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("备份已下载。请妥善保存，文件中可能包含你填写的工作备注。");
  }

  async function restoreBackup(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data.version !== 1 || !Array.isArray(data.tasks)) throw new Error("格式不符");
      const tasks = data.tasks.slice(0, 5000).map(normalizeTask).filter(Boolean);
      if (tasks.length !== data.tasks.length) throw new Error("事项不完整");
      if (state.tasks.length && !window.confirm(`恢复备份会替换当前的 ${state.tasks.length} 个事项，确定继续吗？`)) return;
      state = { tasks, imports: data.imports && typeof data.imports === "object" ? data.imports : {} };
      persist(`已恢复 ${tasks.length} 个事项。`);
      render();
    } catch (_) { setStatus("备份文件无法恢复，请确认它由此工作台导出。", true); }
  }

  function applyLocalSeed() {
    const seed = window.PIMAX_LOCAL_SEED;
    if (!seed || seed.version !== 1 || !Array.isArray(seed.tasks) || !seed.revision || state.imports.privateSeedRevision === seed.revision) return;
    const previous = new Map(state.tasks.map((task) => [task.id, task]));
    const fresh = seed.tasks.map(normalizeTask).filter(Boolean);
    state.tasks = state.tasks.filter((task) => !["workbook", "candidate", "krm"].includes(task.source));
    for (const task of fresh) {
      const old = previous.get(task.id);
      if (old) {
        task.done = old.done;
        if (old.edited) Object.assign(task, { title: old.title, category: old.category, type: old.type, priority: old.priority, due: old.due, person: old.person, next: old.next, flow: old.flow, evidence: old.evidence, need: old.need, krmStage: old.krmStage, lastActivityDate: old.lastActivityDate, claimedDate: old.claimedDate, stageDate: old.stageDate, suggested: old.suggested, edited: true });
      }
      state.tasks.push(task);
    }
    state.imports.privateSeedRevision = seed.revision;
    persist(`已载入本机脱敏跟进摘要，生成 ${fresh.length} 个事项；原表未修改。`);
  }

  $("today-label").textContent = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(new Date());
  $("add-button").addEventListener("click", () => openDialog(null));
  $("close-dialog").addEventListener("click", () => $("task-dialog").close());
  $("cancel-button").addEventListener("click", () => $("task-dialog").close());
  $("task-form").addEventListener("submit", saveForm);
  $("show-completed").addEventListener("change", render);
  $("csv-button").addEventListener("click", () => $("csv-input").click());
  $("csv-input").addEventListener("change", async (event) => { await importCSVs([...event.target.files]); event.target.value = ""; });
  $("export-button").addEventListener("click", exportBackup);
  $("restore-button").addEventListener("click", () => $("backup-input").click());
  $("backup-input").addEventListener("change", async (event) => { if (event.target.files[0]) await restoreBackup(event.target.files[0]); event.target.value = ""; });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      today = localDate(new Date());
      $("today-label").textContent = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(new Date());
      render();
    }
  });
  if (document.modelContext?.registerTool) {
    try {
      Promise.resolve(document.modelContext.registerTool({
        name: "create_work_item",
        title: "添加工作事项",
        description: "在当前浏览器的个人工作台新增一个事项，并立即显示在所选区块。",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string" },
            category: { type: "string", enum: CATEGORIES },
            type: { type: "string" },
            priority: { type: "string", enum: ["high", "medium", "low"] },
            due: { type: "string", description: "可选，YYYY-MM-DD" },
            person: { type: "string" },
            next: { type: "string" }
          },
          required: ["title", "category"],
          additionalProperties: false
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          if (!input || typeof input !== "object" || typeof input.title !== "string" || !CATEGORIES.includes(input.category) || (input.due && !validDate(input.due))) throw new Error("事项内容或日期无效");
          const task = normalizeTask({ ...input, id: `manual:${Date.now()}:${Math.random().toString(36).slice(2)}`, source: "manual" });
          if (!task) throw new Error("事项名称不能为空");
          state.tasks.push(task);
          persist("事项已添加。");
          render();
          return { id: task.id, title: task.title, category: displayCategory(task) };
        }
      })).catch(() => {});
    } catch (_) { /* Browser does not support WebMCP. */ }
  }
  applyLocalSeed();
  render();
})();
