const MODE_LABELS = { sudden: "突然死亡", endless: "无尽" };

let token = null;
let namesIndex = [];
let validNames = new Set();
let currentMode = "sudden";
let attempts = 0;
let finished = false;
let suggestItems = [];
let activeIndex = -1;

const modeScreen = document.getElementById("modeScreen");
const gameScreen = document.getElementById("gameScreen");
const modeLabel = document.getElementById("modeLabel");
const attemptLabel = document.getElementById("attemptLabel");
const input = document.getElementById("guessInput");
const btn = document.getElementById("guessBtn");
const revealBtn = document.getElementById("revealBtn");
const statusEl = document.getElementById("status");
const rowsEl = document.getElementById("rows");
const victoryEl = document.getElementById("victory");
const victoryText = document.getElementById("victoryText");
const restartBtn = document.getElementById("restartBtn");
const changeModeBtn = document.getElementById("changeModeBtn");
const suggestEl = document.getElementById("suggest");
const choiceModal = document.getElementById("choiceModal");
const choiceList = document.getElementById("choiceList");
const choiceGiveup = document.getElementById("choiceGiveup");

function setStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.className = "status" + (isError ? " error" : "");
}

async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  return res.json();
}

async function startGame(mode) {
  currentMode = mode;
  token = null;
  attempts = 0;
  finished = false;
  rowsEl.innerHTML = "";
  victoryEl.classList.add("hidden");
  victoryEl.classList.remove("fail");
  choiceModal.classList.add("hidden");
  hideSuggest();
  setInputEnabled(false);
  modeLabel.textContent = MODE_LABELS[mode] + "模式";
  modeLabel.classList.toggle("hot", mode === "sudden");
  setStatus("正在准备谜题……");
  const data = await fetchJSON("/api/new?mode=" + mode);
  if (data.error) {
    setStatus("出错了：" + data.error, true);
    return;
  }
  token = data.token;
  updateAttemptLabel();
  setStatus("谜底已就绪（共 " + data.total + " 名干员）");
  setInputEnabled(true);
  input.focus();
}

function updateAttemptLabel() {
  if (currentMode === "sudden") {
    const remaining = lastRemaining != null ? lastRemaining : 5;
    attemptLabel.textContent = "剩余 " + remaining + " 次猜测";
  } else {
    attemptLabel.textContent = "已猜 " + attempts + " 次";
  }
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
    hot.textContent = r.op.hot ? "热门" : "";
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
      finishGame(true, "猜中了！答案是 " + data.answerName + "，共用 " + attempts + " 次");
      return;
    }
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
  if (data.win) {
    finishGame(true, "绝杀成功！答案是 " + data.answerName + "，共用了 5 次猜测 + 1 次抉择");
  } else {
    finishGame(false, "猜错了……答案是 " + data.answerName);
  }
}

/* ---------- 渲染表格 ---------- */

function cell(dim, extraClass, title) {
  const td = document.createElement("td");
  td.textContent = dim.guessText != null ? dim.guessText : (dim.guess == null ? "?" : String(dim.guess));
  td.className = extraClass;
  if (title) td.title = title;
  return td;
}

function hintTitle(what, direction) {
  if (direction === "high") return "谜底" + what + "更高/更多";
  if (direction === "low") return "谜底" + what + "更低/更少";
  if (direction === "after") return "谜底生日更晚";
  if (direction === "before") return "谜底生日更早";
  return "";
}

function renderRow(r) {
  const d = r.dims;
  const tr = document.createElement("tr");

  const nameTd = document.createElement("td");
  nameTd.textContent = r.guessName;
  nameTd.className = "op-name";
  tr.appendChild(nameTd);

  tr.appendChild(cell(d.profession, d.profession.state === "exact" ? "cell-exact" : "cell-wrong",
    d.profession.state === "exact" ? "职业正确" : "职业不同"));

  const subTd = cell(d.subProfession, d.subProfession.state === "exact" ? "cell-exact" : "cell-wrong",
    d.subProfession.state === "exact" ? "子职业正确" : (d.profession.state === "exact" ? "同职业，子职业不同" : "子职业不同"));
  tr.appendChild(subTd);

  const rarityTd = cell(d.rarity, d.rarity.state === "exact" ? "cell-exact" : "cell-tip",
    d.rarity.state === "exact" ? "星级正确" : hintTitle("星级", d.rarity.state));
  arrow(rarityTd, d.rarity.state);
  tr.appendChild(rarityTd);

  tr.appendChild(cell(d.position, d.position.state === "exact" ? "cell-exact" : "cell-wrong",
    d.position.state === "exact" ? "站位正确" : "站位不同"));

  const tagTd = document.createElement("td");
  tagTd.className = "tag-list";
  const sharedSet = new Set(d.tags.shared);
  d.tags.guess.forEach((t) => {
    const span = document.createElement("span");
    span.className = "tag" + (sharedSet.has(t) ? " shared" : "");
    span.textContent = t;
    tagTd.appendChild(span);
  });
  if (d.tags.shared.length) {
    const p = document.createElement("div");
    p.style.cssText = "color:#3fb950;font-size:12px;margin-top:2px;";
    p.textContent = "共同 Tag：" + d.tags.shared.join("、");
    tagTd.appendChild(p);
  }
  tr.appendChild(tagTd);

  tr.appendChild(cell(d.gender, d.gender.state === "exact" ? "cell-exact" : "cell-wrong",
    d.gender.state === "exact" ? "性别正确" : "性别不同"));

  const expTd = cell(d.exp, cellClass(d.exp.state),
    d.exp.state === "exact" ? "战斗经验一致" : (d.exp.state === "unknown" ? "情报未知" : hintTitle("战斗经验", d.exp.state)));
  arrow(expTd, d.exp.state);
  tr.appendChild(expTd);

  tr.appendChild(cell(d.origin, d.origin.state === "exact" ? "cell-exact" : (d.origin.state === "unknown" ? "cell-unknown" : "cell-wrong"),
    d.origin.state === "exact" ? "出身地正确" : (d.origin.state === "unknown" ? "情报未知" : "出身地不同")));

  const bdayTd = cell(d.birthday, d.birthday.state === "exact" ? "cell-exact" : (d.birthday.state === "unknown" ? "cell-unknown" : "cell-tip"),
    d.birthday.state === "exact" ? "生日正确" : (d.birthday.state === "unknown" ? "情报未知" : hintTitle("生日", d.birthday.state)));
  if (d.birthday.state === "after" || d.birthday.state === "before") {
    bdayTd.textContent = d.birthday.guessText + " " + (d.birthday.state === "after" ? "→更晚" : "←更早");
  }
  tr.appendChild(bdayTd);

  tr.appendChild(cell(d.race, d.race.state === "exact" ? "cell-exact" : "cell-wrong",
    d.race.state === "exact" ? "种族正确" : "种族不同"));

  const heightTd = cell(d.height, cellClass(d.height.state),
    d.height.state === "exact" ? "身高一致" : (d.height.state === "unknown" ? "情报未知" : hintTitle("身高", d.height.state)));
  arrow(heightTd, d.height.state);
  tr.appendChild(heightTd);

  tr.appendChild(cell(d.infected, d.infected.state === "exact" ? "cell-exact" : (d.infected.state === "unknown" ? "cell-unknown" : "cell-wrong"),
    d.infected.state === "exact" ? "感染情况一致" : (d.infected.state === "unknown" ? "情报未知" : "感染情况不同")));

  rowsEl.prepend(tr);
}

function cellClass(state) {
  if (state === "exact") return "cell-exact";
  if (state === "high" || state === "low" || state === "after" || state === "before") return "cell-tip";
  if (state === "unknown") return "cell-unknown";
  return "cell-wrong";
}

function arrow(td, state) {
  if (state === "high") td.textContent += " ↓";
  if (state === "low") td.textContent += " ↑";
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
  finishGame(false, "本局答案是 " + data.answerName + "，共猜了 " + attempts + " 次");
}

async function giveUpChoice() {
  choiceModal.classList.add("hidden");
  const data = await fetchJSON("/api/reveal?token=" + encodeURIComponent(token));
  if (!data.error) finishGame(false, "本局答案是 " + data.answerName + "，共猜了 " + attempts + " 次");
}

/* ---------- 模式切换 ---------- */

function showModeScreen() {
  gameScreen.classList.add("hidden");
  modeScreen.classList.remove("hidden");
}

function showGameScreen() {
  modeScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
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
document.getElementById("modeSudden").addEventListener("click", () => startSudden());
document.getElementById("modeEndless").addEventListener("click", () => startEndless());

async function startSudden() {
  localStorage.setItem("ak-mode", "sudden");
  showGameScreen();
  await startGame("sudden");
}

async function startEndless() {
  localStorage.setItem("ak-mode", "endless");
  showGameScreen();
  await startGame("endless");
}

/* ---------- 初始化 ---------- */

async function init() {
  const data = await fetchJSON("data/names.json");
  namesIndex = data;
  validNames = new Set(data.map((x) => x.n));
  const saved = localStorage.getItem("ak-mode");
  if (saved === "endless") {
    showGameScreen();
    await startGame("endless");
  } else {
    showModeScreen();
  }
}

init();
