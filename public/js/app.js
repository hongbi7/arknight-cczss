const MODE_LABELS = { sudden: "突然死亡", endless: "无尽模式" };

let token = null;
let namesIndex = [];
let validNames = new Set();
let currentMode = "sudden";
let attempts = 0;
let finished = false;
let suggestItems = [];
let activeIndex = -1;
let totalOperators = 0;
let bubbleTimer = null;

const modeScreen = document.getElementById("modeScreen");
const gameScreen = document.getElementById("gameScreen");
const modeLabel = document.getElementById("modeLabel");
const attemptLabel = document.getElementById("attemptLabel");
const input = document.getElementById("guessInput");
const btn = document.getElementById("guessBtn");
const revealBtn = document.getElementById("revealBtn");
const statusEl = document.getElementById("status");
const rowsEl = document.getElementById("rows");
const boardEmpty = document.getElementById("boardEmpty");
const victoryEl = document.getElementById("victory");
const victoryText = document.getElementById("victoryText");
const restartBtn = document.getElementById("restartBtn");
const changeModeBtn = document.getElementById("changeModeBtn");
const suggestEl = document.getElementById("suggest");
const livesPips = document.getElementById("livesPips");
const choiceModal = document.getElementById("choiceModal");
const choiceList = document.getElementById("choiceList");
const choiceGiveup = document.getElementById("choiceGiveup");
const hudTagL = document.getElementById("hudTagL");
const hudTagR = document.getElementById("hudTagR");
const modeStage = document.querySelector(".mode-stage");
const modeSuddenBtn = document.getElementById("modeSudden");
const modeEndlessBtn = document.getElementById("modeEndless");
const endlessBubble = document.getElementById("endlessBubble");
const gameSidebarIndex = document.getElementById("gameSidebarIndex");

function setStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.className = "status" + (isError ? " error" : "");
}

async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  return res.json();
}

function playWipe() {
  const wipe = document.querySelector(".wipe");
  if (!wipe) return;
  wipe.classList.remove("play");
  void wipe.offsetWidth;
  wipe.classList.add("play");
}

async function startGame(mode) {
  currentMode = mode;
  document.body.dataset.mode = mode;
  updateHudTags(mode);
  playWipe();
  token = null;
  attempts = 0;
  lastRemaining = null;
  finished = false;
  rowsEl.innerHTML = "";
  boardEmpty.classList.remove("hidden");
  victoryEl.classList.add("hidden");
  victoryEl.classList.remove("fail");
  choiceModal.classList.add("hidden");
  hideSuggest();
  setInputEnabled(false);
  modeLabel.textContent = MODE_LABELS[mode];
  modeLabel.classList.toggle("hot", mode === "sudden");
  setStatus("正在准备谜题……");
  const data = await fetchJSON("/api/new?mode=" + mode);
  if (data.error) {
    setStatus("出错了：" + data.error, true);
    return;
  }
  token = data.token;
  totalOperators = data.total || 0;
  updateEndlessBubble();
  hideEndlessBubble();
  updateAttemptLabel();
  setStatus("谜底已就绪（共 " + data.total + " 名干员）");
  setInputEnabled(true);
  input.focus();
}

function updateHudTags(mode) {
  if (mode === "endless") {
    hudTagL.textContent = "ENDFIELD // TALOS-II FIELD PROTOCOL";
    hudTagR.textContent = "E.F.S. — UNLIMITED TRACE SYSTEM";
    gameSidebarIndex.textContent = "/ 02";
  } else {
    hudTagL.textContent = "PARADISE FULCRUM // LATERANO ARCHIVE";
    hudTagR.textContent = "P.F.S. — OPERATOR TRACE SYSTEM";
    gameSidebarIndex.textContent = "/ 01";
  }
}

function updateAttemptLabel() {
  if (currentMode === "sudden") {
    const remaining = lastRemaining != null ? lastRemaining : 5;
    attemptLabel.textContent = "剩余 " + remaining + " 次猜测";
    renderPips(remaining);
    livesPips.classList.remove("hidden");
  } else {
    attemptLabel.textContent = "已猜 " + attempts + " 次";
    livesPips.classList.add("hidden");
  }
}

function renderPips(remaining) {
  livesPips.innerHTML = "";
  for (let i = 0; i < 5; i++) {
    const pip = document.createElement("i");
    if (i >= remaining) pip.className = "off";
    livesPips.appendChild(pip);
  }
}

function updateEndlessBubble() {
  if (!endlessBubble) return;
  const remaining = Math.max(0, totalOperators - attempts);
  endlessBubble.textContent = "离穷举完成还差 " + remaining;
}

function showEndlessBubble(won) {
  if (!endlessBubble) return;
  if (won) {
    endlessBubble.textContent = "穷举成功";
  } else {
    updateEndlessBubble();
  }
  endlessBubble.classList.add("show");
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => endlessBubble.classList.remove("show"), 4000);
}

function hideEndlessBubble() {
  if (!endlessBubble) return;
  endlessBubble.classList.remove("show");
  if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null; }
}

let lastRemaining = null;

function setInputEnabled(on) {
  input.disabled = !on;
  btn.disabled = !on;
  revealBtn.disabled = !on;
  if (!on) hideSuggest();
}

/* ---------- 拼音模糊搜索 ---------- */

function isSubsequence(query, target) {
  let qi = 0;
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (target[ti] === query[qi]) qi++;
  }
  return qi === query.length;
}

function scoreMatch(op, q) {
  const n = op.n.toLowerCase();
  if (n.includes(q)) return 3;
  if (op.p && op.p === q) return 2.5;
  if (op.p && op.p.includes(q)) return 2;
  if (op.i && op.i === q) return 2.5;
  if (op.i && isSubsequence(q, op.i)) return 1.5;
  if (op.p && isSubsequence(q, op.p)) return 1;
  return 0;
}

function searchNames(query) {
  const q = query.trim().toLowerCase().replace(/\s+/g, "");
  if (!q) return [];
  const scored = [];
  for (const op of namesIndex) {
    const s = scoreMatch(op, q);
    if (s > 0) scored.push({ op, s });
  }
  scored.sort((a, b) => b.s - a.s || (b.op.hot - a.op.hot) || a.op.n.localeCompare(b.op.n, "zh"));
  return scored.slice(0, 8);
}

function renderSuggest(results) {
  suggestEl.innerHTML = "";
  suggestItems = results;
  activeIndex = results.length ? 0 : -1;
  if (!results.length) {
    const d = document.createElement("div");
    d.className = "suggest-empty";
    d.textContent = "没有匹配的干员";
    suggestEl.appendChild(d);
    suggestEl.classList.remove("hidden");
    return;
  }
  results.forEach((r, idx) => {
    const d = document.createElement("div");
    d.className = "suggest-item" + (idx === activeIndex ? " active" : "");
    const name = document.createElement("span");
    name.textContent = r.op.n + (r.op.hot ? " " : "");
    const hot = document.createElement("span");
    hot.className = "hot-mark";
    hot.textContent = r.op.hot ? "🔥" : "";
    const py = document.createElement("span");
    py.className = "py";
    py.textContent = r.op.p;
    name.appendChild(hot);
    d.appendChild(name);
    d.appendChild(py);
    d.addEventListener("mousedown", (e) => { e.preventDefault(); chooseSuggestion(idx); });
    d.addEventListener("mouseenter", () => { setActive(idx); });
    suggestEl.appendChild(d);
  });
  suggestEl.classList.remove("hidden");
}

function setActive(idx) {
  activeIndex = idx;
  const items = suggestEl.querySelectorAll(".suggest-item");
  items.forEach((el, i) => el.classList.toggle("active", i === idx));
}

function chooseSuggestion(idx) {
  if (idx < 0 || idx >= suggestItems.length) return;
  input.value = suggestItems[idx].op.n;
  hideSuggest();
}

function hideSuggest() {
  suggestEl.classList.add("hidden");
  suggestItems = [];
  activeIndex = -1;
}

/* ---------- 猜测 ---------- */

async function submitGuess() {
  if (finished || !token) return;
  const raw = input.value.trim();
  if (!raw) return;
  let guessName = raw;
  if (!validNames.has(raw)) {
    if (suggestItems.length) {
      guessName = suggestItems[0].op.n;
    } else {
      setStatus("“" + raw + "”不在可猜干员名单中，请从下拉提示中选择。", true);
      return;
    }
  }
  setInputEnabled(false);
  hideSuggest();
  try {
    const data = await fetchJSON("/api/guess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, guess: guessName }),
    });
    if (data.error === "invalid_session") {
      setStatus("会话失效，重新开始……");
      await startGame(currentMode);
      return;
    }
    if (data.error) {
      setStatus("出错了：" + data.error, true);
      setInputEnabled(true);
      return;
    }
    attempts += 1;
    token = data.token;
    lastRemaining = data.remaining;
    renderRow(data);
    input.value = "";
    if (data.win) {
      if (currentMode === "endless") showEndlessBubble(true);
      finishGame(true, "猜中了！答案是 " + data.answerName + "，共用 " + attempts + " 次");
      return;
    }
    if (currentMode === "endless") showEndlessBubble(false);
    updateAttemptLabel();
    if (data.remaining === 0) {
      await showChoiceModal();
      return;
    }
    setStatus("已猜 " + attempts + " 次");
    setInputEnabled(true);
  } catch (e) {
    setStatus("网络错误，请重试。", true);
    setInputEnabled(true);
  }
  input.focus();
}

function finishGame(won, text) {
  finished = true;
  victoryEl.classList.remove("hidden");
  victoryEl.classList.toggle("fail", !won);
  victoryText.textContent = text;
  setStatus("");
  setInputEnabled(false);
  if (!won) hideSuggest();
}

/* ---------- 四选一（突然死亡终局） ---------- */

async function showChoiceModal() {
  setStatus("机会用尽，最后一搏！");
  try {
    const data = await fetchJSON("/api/choices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (data.error === "invalid_session") {
      await startGame(currentMode);
      return;
    }
    choiceList.innerHTML = "";
    data.options.forEach((name) => {
      const b = document.createElement("button");
      b.className = "choice-btn";
      b.textContent = name;
      b.addEventListener("click", () => onPick(name));
      choiceList.appendChild(b);
    });
    choiceModal.querySelectorAll(".modal-note").forEach((n) => n.remove());
    if (data.fullMatches != null && data.fullMatches < 4) {
      const note = document.createElement("p");
      note.className = "modal-sub modal-note";
      note.textContent = "注意：4 个选项中仅 " + data.fullMatches + " 项完全符合你已确认的线索";
      choiceModal.querySelector(".modal-box").appendChild(note);
    }
    choiceModal.classList.remove("hidden");
  } catch (e) {
    setStatus("网络错误，请重试。", true);
  }
}

async function onPick(name) {
  const btns = choiceList.querySelectorAll(".choice-btn");
  btns.forEach((b) => (b.disabled = true));
  const data = await fetchJSON("/api/pick", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, pick: name }),
  });
  choiceModal.classList.add("hidden");
  if (data.dims) renderRow({ guessName: data.answerName, dims: data.dims });
  if (data.win) {
    finishGame(true, "绝杀成功！答案是 " + data.answerName + "，共用了 5 次猜测 + 1 次抉择");
  } else {
    finishGame(false, "猜错了……答案是 " + data.answerName);
  }
}

/* ---------- 渲染档案卡 ---------- */

function dimText(dim) {
  if (typeof dim.guess === "boolean") return dim.guess ? "是" : "否";
  return dim.guessText != null ? dim.guessText : (dim.guess == null ? "?" : String(dim.guess));
}

function hintTitle(what, direction) {
  if (direction === "high") return "谜底" + what + "更低/更少";
  if (direction === "low") return "谜底" + what + "更高/更多";
  if (direction === "after") return "谜底生日更晚";
  if (direction === "before") return "谜底生日更早";
  return "";
}

function visualState(state, close) {
  if (state === "exact") return "exact";
  if (close) return "tip";
  if (state === "unknown") return "unknown";
  return "wrong";
}

function stateLabel(state) {
  if (state === "exact") return "吻合";
  if (state === "tip") return "接近";
  if (state === "unknown") return "未知";
  return "不符";
}

function directionMark(state) {
  if (state === "high") return "↓";
  if (state === "low") return "↑";
  if (state === "after") return "→";
  if (state === "before") return "←";
  return "";
}

function createClue(label, dim, hint, options) {
  const config = options || {};
  const state = visualState(dim.state, config.close);
  const clue = document.createElement("div");
  clue.className = "clue cell-" + state + (config.special ? " cell-special" : "") + (config.className ? " " + config.className : "");
  if (hint) clue.title = hint;

  const labelEl = document.createElement("span");
  labelEl.className = "clue-label";
  labelEl.textContent = label;
  const stateEl = document.createElement("i");
  stateEl.className = "clue-state";
  stateEl.textContent = stateLabel(state);
  labelEl.appendChild(stateEl);

  const valueEl = document.createElement("strong");
  valueEl.className = "clue-value";
  valueEl.textContent = dimText(dim);
  const mark = directionMark(dim.state);
  if (mark) {
    const directionEl = document.createElement("b");
    directionEl.className = "clue-direction";
    directionEl.textContent = mark;
    valueEl.appendChild(directionEl);
  }

  clue.appendChild(labelEl);
  clue.appendChild(valueEl);
  if (hint && state !== "exact") {
    const hintEl = document.createElement("span");
    hintEl.className = "clue-hint";
    hintEl.textContent = hint;
    clue.appendChild(hintEl);
  }
  return { clue, state };
}

function createTagClue(tags) {
  const sharedSet = new Set(tags.shared);
  const exact = tags.shared.length === tags.guess.length && tags.shared.length === tags.answer.length;
  const state = exact ? "exact" : (tags.shared.length ? "tip" : "wrong");
  const clue = document.createElement("div");
  clue.className = "clue clue-tags cell-" + state;

  const labelEl = document.createElement("span");
  labelEl.className = "clue-label";
  labelEl.textContent = "标签 TAG";
  const stateEl = document.createElement("i");
  stateEl.className = "clue-state";
  stateEl.textContent = stateLabel(state);
  labelEl.appendChild(stateEl);

  const pills = document.createElement("div");
  pills.className = "tag-pills";
  tags.guess.forEach((tag) => {
    const pill = document.createElement("span");
    pill.className = "tag" + (sharedSet.has(tag) ? " shared" : "");
    pill.textContent = tag;
    pills.appendChild(pill);
  });

  clue.appendChild(labelEl);
  clue.appendChild(pills);
  if (tags.shared.length) {
    const hint = document.createElement("span");
    hint.className = "clue-hint";
    hint.textContent = "共同标签：" + tags.shared.join("、");
    clue.appendChild(hint);
  }
  return { clue, state };
}

function renderRow(r) {
  const d = r.dims;
  const card = document.createElement("article");
  card.className = "guess-card";

  const head = document.createElement("header");
  head.className = "guess-card-head";
  const identity = document.createElement("div");
  identity.className = "guess-identity";
  const number = document.createElement("span");
  number.className = "guess-number";
  number.textContent = String(rowsEl.children.length + 1).padStart(2, "0");
  const title = document.createElement("div");
  title.className = "guess-title";
  title.innerHTML = "<small>OPERATOR RECORD</small>";
  const name = document.createElement("h3");
  name.textContent = r.guessName;
  title.appendChild(name);
  identity.appendChild(number);
  identity.appendChild(title);

  const grid = document.createElement("div");
  grid.className = "clue-grid";
  let exactCount = 0;
  const add = (result) => {
    if (result.state === "exact") exactCount += 1;
    grid.appendChild(result.clue);
  };

  add(createClue("职业", d.profession, d.profession.state === "exact" ? "职业吻合" : "职业不同"));
  add(createClue("子职业", d.subProfession, d.subProfession.state === "exact" ? "子职业吻合" : (d.profession.state === "exact" ? "同职业，但子职业不同" : "子职业不同")));
  add(createClue("星级", d.rarity, d.rarity.state === "exact" ? "星级吻合" : hintTitle("星级", d.rarity.state)));
  add(createClue("站位", d.position, d.position.state === "exact" ? "站位吻合" : "站位不同"));
  add(createTagClue(d.tags));
  add(createClue("性别", d.gender, d.gender.state === "exact" ? "性别吻合" : "性别不同"));
  add(createClue("战斗经验", d.exp, d.exp.state === "exact" ? "战斗经验吻合" : (d.exp.state === "unknown" ? "情报未知" : hintTitle("战斗经验", d.exp.state)), { special: d.exp.special }));
  add(createClue("出身地", d.origin, d.origin.state === "exact" ? "出身地吻合" : (d.origin.state === "unknown" ? "情报未知" : "出身地不同"), { special: d.origin.special }));
  add(createClue("生日", d.birthday, d.birthday.state === "exact" ? "生日吻合" : (d.birthday.state === "unknown" ? "情报未知" : (d.birthday.close ? "谜底生日在 2 个月内" : hintTitle("生日", d.birthday.state))), { close: d.birthday.close }));
  add(createClue("种族", d.race, d.race.state === "exact" ? "种族吻合" : "种族不同", { special: d.race.special }));
  add(createClue("身高", d.height, d.height.state === "exact" ? "身高吻合" : (d.height.state === "unknown" ? "情报未知" : (d.height.close ? "与谜底相差 15cm 以内" : hintTitle("身高", d.height.state))), { close: d.height.close }));
  add(createClue("矿石病", d.infected, d.infected.state === "exact" ? "感染情况吻合" : (d.infected.state === "unknown" ? "情报未知" : "感染情况不同")));

  const summary = document.createElement("div");
  summary.className = "guess-summary";
  const summaryNumber = document.createElement("strong");
  summaryNumber.textContent = exactCount + "/12";
  const summaryLabel = document.createElement("span");
  summaryLabel.textContent = "线索吻合";
  summary.appendChild(summaryNumber);
  summary.appendChild(summaryLabel);

  head.appendChild(identity);
  head.appendChild(summary);
  card.appendChild(head);
  card.appendChild(grid);
  boardEmpty.classList.add("hidden");
  rowsEl.prepend(card);
}

/* ---------- 放弃 ---------- */

async function giveUp() {
  if (finished || !token) return;
  if (!confirm("确定要放弃本局并揭晓答案吗？")) return;
  const data = await fetchJSON("/api/reveal?token=" + encodeURIComponent(token));
  if (data.error) {
    setStatus("出错了，重新开始……", true);
    await startGame(currentMode);
    return;
  }
  if (data.dims) renderRow({ guessName: data.answerName, dims: data.dims });
  finishGame(false, "本局答案是 " + data.answerName + "，共猜了 " + attempts + " 次");
}

async function giveUpChoice() {
  choiceModal.classList.add("hidden");
  const data = await fetchJSON("/api/reveal?token=" + encodeURIComponent(token));
  if (!data.error) {
    if (data.dims) renderRow({ guessName: data.answerName, dims: data.dims });
    finishGame(false, "本局答案是 " + data.answerName + "，共猜了 " + attempts + " 次");
  }
}

/* ---------- 模式切换 ---------- */

function showModeScreen() {
  document.body.dataset.mode = "";
  updateHudTags("");
  setModePreview("");
  gameScreen.classList.add("hidden");
  modeScreen.classList.remove("hidden");
  window.scrollTo(0, 0);
}

function showGameScreen() {
  modeScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  window.scrollTo(0, 0);
}

function setModePreview(mode) {
  modeStage.classList.toggle("preview-sudden", mode === "sudden");
  modeStage.classList.toggle("preview-endless", mode === "endless");
}

/* ---------- 事件绑定 ---------- */

input.addEventListener("input", () => {
  const results = searchNames(input.value);
  if (input.value.trim()) renderSuggest(results);
  else hideSuggest();
});

input.addEventListener("keydown", (e) => {
  if (e.isComposing) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (suggestItems.length) setActive((activeIndex + 1) % suggestItems.length);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (suggestItems.length) setActive((activeIndex - 1 + suggestItems.length) % suggestItems.length);
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (suggestItems.length) chooseSuggestion(activeIndex >= 0 ? activeIndex : 0);
    submitGuess();
  } else if (e.key === "Escape") {
    hideSuggest();
  }
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".input-wrap")) hideSuggest();
});

btn.addEventListener("click", submitGuess);
revealBtn.addEventListener("click", giveUp);
restartBtn.addEventListener("click", () => startGame(currentMode));
changeModeBtn.addEventListener("click", showModeScreen);
choiceGiveup.addEventListener("click", giveUpChoice);
modeSuddenBtn.addEventListener("click", () => startSudden());
modeEndlessBtn.addEventListener("click", () => startEndless());

[modeSuddenBtn, modeEndlessBtn].forEach((el) => {
  const mode = el === modeSuddenBtn ? "sudden" : "endless";
  el.addEventListener("mouseenter", () => setModePreview(mode));
  el.addEventListener("focus", () => setModePreview(mode));
  el.addEventListener("mouseleave", () => setModePreview(""));
  el.addEventListener("blur", () => setModePreview(""));
});

async function startSudden() {
  showGameScreen();
  await startGame("sudden");
}

async function startEndless() {
  showGameScreen();
  await startGame("endless");
}

/* ---------- 初始化 ---------- */

async function init() {
  const data = await fetchJSON("data/names.json");
  namesIndex = data;
  validNames = new Set(data.map((x) => x.n));
  showModeScreen();
}

init();
