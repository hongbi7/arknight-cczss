const MODE_LABELS = { sudden: "终局校验", endless: "全域检索" };
const DEFAULT_SUDDEN_ATTEMPTS = 6;
const SUDDEN_MIN = 1;
const SUDDEN_LIMIT = 20;

let token = null;
let namesIndex = [];
let validNames = new Set();
let currentMode = "sudden";
let attempts = 0;
let finished = false;
let suggestItems = [];
let activeIndex = -1;
let totalOperators = 0;
let suddenMax = DEFAULT_SUDDEN_ATTEMPTS;
let bubbleTimer = null;
let mobileBubbleDelayTimer = null;
let mobileBubbleHideTimer = null;
let finalFocusTimer = null;
let finalArchiveTimer = null;
let operatorArt = {};

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
const victoryEyebrow = document.getElementById("victoryEyebrow");
const restartBtn = document.getElementById("restartBtn");
const changeModeBtn = document.getElementById("changeModeBtn");
const ingameChangeModeBtn = document.getElementById("ingameChangeModeBtn");
const suggestEl = document.getElementById("suggest");
const livesPips = document.getElementById("livesPips");
const choiceModal = document.getElementById("choiceModal");
const choiceList = document.getElementById("choiceList");
const choiceGiveup = document.getElementById("choiceGiveup");
const hudTagL = document.getElementById("hudTagL");
const hudTagR = document.getElementById("hudTagR");
const modeStage = document.querySelector(".mode-stage");
const modeSuddenCard = document.getElementById("modeSuddenCard");
const modeEndlessBtn = document.getElementById("modeEndless");
const suddenModeDesc = document.getElementById("suddenModeDesc");
const suddenAttemptsMode = document.getElementById("suddenAttemptsMode");
const suddenGameConfig = document.getElementById("suddenGameConfig");
const suddenAttemptsGame = document.getElementById("suddenAttemptsGame");
const applySuddenAttempts = document.getElementById("applySuddenAttempts");
const endlessBubble = document.getElementById("endlessBubble");
const endlessBubbleText = document.getElementById("endlessBubbleText");
const endlessProgress = document.getElementById("endlessProgress");
const mobileEndlessBubble = document.getElementById("mobileEndlessBubble");
const mobileEndlessBubbleText = document.getElementById("mobileEndlessBubbleText");
const mobileEndlessProgress = document.getElementById("mobileEndlessProgress");
const choiceModalSub = document.getElementById("choiceModalSub");
const gameSidebarIndex = document.getElementById("gameSidebarIndex");
const gameSidebarTitle = document.getElementById("gameSidebarTitle");
const gameSidebarDesc = document.getElementById("gameSidebarDesc");
const revealModal = document.getElementById("revealModal");
const revealModalDesc = document.getElementById("revealModalDesc");
const revealAttemptText = document.getElementById("revealAttemptText");
const revealCancel = document.getElementById("revealCancel");
const revealConfirm = document.getElementById("revealConfirm");
const artPreview = document.getElementById("artPreview");
const artPreviewImage = document.getElementById("artPreviewImage");
const artPreviewTitle = document.getElementById("artPreviewTitle");
const artPreviewMeta = document.getElementById("artPreviewMeta");
const artPreviewClose = document.getElementById("artPreviewClose");
const boardEl = document.getElementById("board");
const gameMeta = document.querySelector(".game-meta");
const dossierHead = document.querySelector(".dossier-head");
const topbar = document.querySelector(".topbar");

let pendingRevealSource = null;
let revealReturnFocus = null;
let artPreviewReturnFocus = null;

function setStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.className = "status" + (isError ? " error" : "");
}

function openArtPreview(image, operatorName, artLabel, returnFocus) {
  const source = image && (image.currentSrc || image.src);
  if (!source) return;
  artPreviewReturnFocus = returnFocus || document.activeElement;
  artPreviewImage.src = source;
  artPreviewImage.alt = operatorName + " " + artLabel + "大图";
  artPreviewTitle.textContent = operatorName;
  artPreviewMeta.textContent = artLabel + " // FULL IMAGE ARCHIVE";
  artPreview.classList.remove("hidden");
  document.body.classList.add("art-preview-open");
  artPreviewClose.focus({ preventScroll: true });
}

function closeArtPreview(restoreFocus) {
  artPreview.classList.add("hidden");
  document.body.classList.remove("art-preview-open");
  artPreviewImage.removeAttribute("src");
  if (restoreFocus && artPreviewReturnFocus && typeof artPreviewReturnFocus.focus === "function") {
    artPreviewReturnFocus.focus({ preventScroll: true });
  }
  artPreviewReturnFocus = null;
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

function normalizeAttempts(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return suddenMax || DEFAULT_SUDDEN_ATTEMPTS;
  return Math.min(SUDDEN_LIMIT, Math.max(SUDDEN_MIN, parsed));
}

function syncSuddenControls(value) {
  suddenMax = normalizeAttempts(value);
  suddenAttemptsMode.value = suddenMax;
  suddenAttemptsGame.value = suddenMax;
  suddenModeDesc.innerHTML = "全干员池，限 " + suddenMax + " 次猜测<br>第 " + suddenMax + " 次后进入终局抉择，猜错即结束";
}

function updateAttemptConfigState() {
  applySuddenAttempts.textContent = attempts > 0 ? "应用并重开" : "应用本局";
}

function clearFinalSequence() {
  if (finalFocusTimer) window.clearTimeout(finalFocusTimer);
  if (finalArchiveTimer) window.clearTimeout(finalArchiveTimer);
  finalFocusTimer = null;
  finalArchiveTimer = null;
}

function isMobileLayout() {
  return window.matchMedia("(max-width: 760px)").matches;
}

function settleMobileKeyboard() {
  if (!isMobileLayout()) return Promise.resolve();
  input.blur();
  const viewport = window.visualViewport;
  const started = performance.now();
  let lastHeight = viewport ? viewport.height : window.innerHeight;
  let stableChecks = 0;
  return new Promise((resolve) => {
    const check = () => {
      const height = viewport ? viewport.height : window.innerHeight;
      if (Math.abs(height - lastHeight) < 1) stableChecks += 1;
      else stableChecks = 0;
      lastHeight = height;
      const elapsed = performance.now() - started;
      if ((elapsed >= 280 && stableChecks >= 2) || elapsed >= 520) {
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
        resolve();
        return;
      }
      window.setTimeout(check, 50);
    };
    window.setTimeout(check, 50);
  });
}

async function startGame(mode, requestedMax) {
  currentMode = mode;
  if (mode === "sudden") syncSuddenControls(requestedMax == null ? suddenMax : requestedMax);
  document.body.dataset.mode = mode;
  updateHudTags(mode);
  playWipe();
  token = null;
  attempts = 0;
  lastRemaining = null;
  finished = false;
  clearFinalSequence();
  gameScreen.classList.remove("has-guesses", "is-finished");
  document.body.classList.remove("mobile-record-active", "mobile-game-finished");
  rowsEl.innerHTML = "";
  boardEmpty.classList.remove("hidden");
  victoryEl.classList.add("hidden");
  victoryEl.classList.remove("fail");
  choiceModal.classList.add("hidden");
  hideSuggest();
  setInputEnabled(false);
  modeLabel.textContent = MODE_LABELS[mode];
  modeLabel.classList.toggle("hot", mode === "sudden");
  suddenGameConfig.classList.toggle("hidden", mode !== "sudden");
  updateAttemptConfigState();
  applySuddenAttempts.disabled = mode !== "sudden";
  setStatus("正在准备谜题……");
  const params = new URLSearchParams({ mode });
  if (mode === "sudden") params.set("attempts", suddenMax);
  const data = await fetchJSON("/api/new?" + params.toString());
  if (data.error) {
    setStatus("出错了：" + data.error, true);
    return;
  }
  token = data.token;
  totalOperators = data.total || 0;
  if (data.maxAttempts) syncSuddenControls(data.maxAttempts);
  updateEndlessBubble();
  hideEndlessBubble();
  updateAttemptLabel();
  setStatus("谜底已就绪（共 " + data.total + " 名干员）");
  setInputEnabled(true);
  applySuddenAttempts.disabled = false;
  if (!isMobileLayout()) input.focus();
}

function updateHudTags(mode) {
  if (mode === "endless") {
    hudTagL.textContent = "P.R.T.S. // RHODES ISLAND ARCHIVE";
    hudTagR.textContent = "R.I. — ENDLESS ARCHIVE SEARCH";
    gameSidebarIndex.textContent = "/ 02";
    gameSidebarTitle.innerHTML = "档案无界，<br>检索不止。";
    gameSidebarDesc.textContent = "不设猜测次数上限。持续比对 12 项档案线索，穷尽可能，直至确认目标。";
  } else {
    hudTagL.textContent = "PARADISE FULCRUM // FINAL VERIFICATION";
    hudTagR.textContent = "P.F.S. — LIMITED AUDIT PROTOCOL";
    gameSidebarIndex.textContent = "/ 01";
    gameSidebarTitle.innerHTML = "缩小范围，<br>锁定目标。";
    gameSidebarDesc.textContent = "每次提交都会解锁 12 项档案比对结果。利用颜色与方向提示，逐步排除不可能。";
  }
}

function updateAttemptLabel() {
  if (currentMode === "sudden") {
    const remaining = lastRemaining != null ? lastRemaining : suddenMax;
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
  for (let i = 0; i < suddenMax; i++) {
    const pip = document.createElement("i");
    if (i >= remaining) pip.className = "off";
    livesPips.appendChild(pip);
  }
}

function updateEndlessBubble() {
  const remaining = Math.max(0, totalOperators - attempts);
  const progress = totalOperators ? Math.min(1, attempts / totalOperators) : 0;
  [endlessBubbleText, mobileEndlessBubbleText].forEach((element) => {
    if (element) element.textContent = "离穷举完成还差 " + remaining;
  });
  [endlessProgress, mobileEndlessProgress].forEach((element) => {
    if (element) element.style.transform = "scaleX(" + progress + ")";
  });
}

function replayBubble(element) {
  if (!element) return;
  element.classList.remove("show");
  void element.offsetWidth;
  element.classList.add("show");
}

function clearMobileBubbleTimers() {
  if (mobileBubbleDelayTimer) window.clearTimeout(mobileBubbleDelayTimer);
  if (mobileBubbleHideTimer) window.clearTimeout(mobileBubbleHideTimer);
  mobileBubbleDelayTimer = null;
  mobileBubbleHideTimer = null;
}

function showEndlessBubble(won) {
  if (won) {
    [endlessBubbleText, mobileEndlessBubbleText].forEach((element) => {
      if (element) element.textContent = "穷举成功 · 目标已锁定";
    });
    [endlessProgress, mobileEndlessProgress].forEach((element) => {
      if (element) element.style.transform = "scaleX(1)";
    });
  } else {
    updateEndlessBubble();
  }
  if (bubbleTimer) clearTimeout(bubbleTimer);
  replayBubble(endlessBubble);
  bubbleTimer = setTimeout(() => {
    if (endlessBubble) endlessBubble.classList.remove("show");
    bubbleTimer = null;
  }, 4000);
  clearMobileBubbleTimers();
  if (mobileEndlessBubble) mobileEndlessBubble.classList.remove("show");
  if (isMobileLayout() && mobileEndlessBubble) {
    mobileBubbleDelayTimer = window.setTimeout(() => {
      replayBubble(mobileEndlessBubble);
      mobileBubbleDelayTimer = null;
      mobileBubbleHideTimer = window.setTimeout(() => {
        mobileEndlessBubble.classList.remove("show");
        mobileBubbleHideTimer = null;
      }, 4000);
    }, 620);
  }
}

function hideEndlessBubble() {
  [endlessBubble, mobileEndlessBubble].forEach((element) => {
    if (element) element.classList.remove("show");
  });
  if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null; }
  clearMobileBubbleTimers();
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
  const mobileViewportReady = settleMobileKeyboard();
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
    updateAttemptConfigState();
    token = data.token;
    lastRemaining = data.remaining;
    await mobileViewportReady;
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
  if (!isMobileLayout()) input.focus();
}

function finishGame(won, text) {
  finished = true;
  gameScreen.classList.add("is-finished");
  document.body.classList.add("mobile-game-finished");
  victoryEl.classList.remove("hidden");
  victoryEl.classList.toggle("fail", !won);
  victoryEyebrow.textContent = won ? "MISSION COMPLETE" : "MISSION FAILED";
  victoryText.textContent = text;
  setStatus("");
  setInputEnabled(false);
  if (!won) hideSuggest();
  requestAnimationFrame(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mobile = window.matchMedia("(max-width: 760px)").matches;
    if (mobile) {
      const board = gameScreen.querySelector(".board");
      board.scrollTo({ top: 0, behavior: "auto" });
      finalFocusTimer = window.setTimeout(() => {
        const finalCard = rowsEl.querySelector(".is-final-record");
        if (!finalCard || !gameScreen.classList.contains("is-finished")) return;
        finalCard.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
        finalFocusTimer = null;
        finalArchiveTimer = window.setTimeout(() => {
          if (!finalCard.isConnected || !gameScreen.classList.contains("is-finished")) return;
          finalCard.classList.add("mobile-final-revealing");
          finalArchiveTimer = window.setTimeout(() => {
            if (!finalCard.isConnected || !gameScreen.classList.contains("is-finished")) return;
            finalCard.dispatchEvent(new CustomEvent("mobile-show-record"));
            finalCard.classList.remove("mobile-final-revealing");
            finalArchiveTimer = null;
          }, 850);
        }, 420);
      }, 1350);
    } else {
      victoryEl.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    }
    restartBtn.focus({ preventScroll: true });
  });
}

/* ---------- 四选一（终局校验） ---------- */

async function showChoiceModal() {
  setStatus("常规核验结束，进入终局校验。");
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
    choiceModal.classList.remove("is-resolving");
    choiceList.dataset.count = data.options.length;
    choiceModalSub.textContent = suddenMax + " 次机会已用尽。从下面 " + data.options.length + " 名干员中选出谜底：";
    data.options.forEach((operator) => {
      const b = document.createElement("button");
      b.className = "choice-btn";
      const art = document.createElement("span");
      art.className = "choice-art";
      const image = document.createElement("img");
      image.src = artUrl(operator.id, false);
      image.alt = operator.name + " 精英一阶段立绘";
      image.loading = "lazy";
      image.addEventListener("error", () => art.classList.add("image-missing"));
      art.appendChild(image);
      art.title = "点击选择 " + operator.name;
      const preview = document.createElement("span");
      preview.className = "choice-preview-trigger";
      preview.textContent = "查看立绘 +";
      preview.title = "查看 " + operator.name + " 的立绘大图";
      preview.setAttribute("role", "button");
      preview.setAttribute("tabindex", "0");
      preview.setAttribute("aria-label", "查看 " + operator.name + " 的立绘大图");
      const openPreview = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!art.classList.contains("image-missing")) openArtPreview(image, operator.name, "精英一阶段立绘", preview);
      };
      preview.addEventListener("click", openPreview);
      preview.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") openPreview(e);
      });
      art.appendChild(preview);
      const info = document.createElement("span");
      info.className = "choice-info";
      const name = document.createElement("strong");
      name.textContent = operator.name;
      const meta = document.createElement("small");
      meta.textContent = operator.professionText + " · " + rarityText(operator.rarity);
      info.appendChild(name);
      info.appendChild(meta);
      b.appendChild(art);
      b.appendChild(info);
      b.addEventListener("click", () => onPick(operator.name, b));
      choiceList.appendChild(b);
    });
    choiceModal.querySelectorAll(".modal-note").forEach((n) => n.remove());
    if (data.relaxedCount > 0) {
      const note = document.createElement("p");
      note.className = "modal-sub modal-note";
      note.textContent = "完全符合的候选不足，已优先保留职业与性别条件；其中 " + data.fullMatches + " 项满足全部绿色线索。";
      choiceModal.querySelector(".modal-box").appendChild(note);
    }
    choiceModal.classList.remove("hidden");
  } catch (e) {
    setStatus("网络错误，请重试。", true);
  }
}

function playChoiceExit(selectedButton) {
  const buttons = Array.from(choiceList.querySelectorAll(".choice-btn"));
  const selectedIndex = buttons.indexOf(selectedButton);
  choiceModal.classList.add("is-resolving");
  buttons.forEach((button, index) => {
    if (button === selectedButton) {
      button.classList.add("choice-selected");
    } else {
      button.classList.add(index < selectedIndex ? "choice-exit-left" : "choice-exit-right");
    }
  });
  const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 30 : 760;
  return new Promise((resolve) => window.setTimeout(resolve, duration));
}

async function onPick(name, selectedButton) {
  const btns = choiceList.querySelectorAll(".choice-btn");
  btns.forEach((b) => (b.disabled = true));
  try {
    const request = fetchJSON("/api/pick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, pick: name }),
    });
    const [, data] = await Promise.all([playChoiceExit(selectedButton), request]);
    if (data.error) throw new Error(data.error);
    choiceModal.classList.add("hidden");
    choiceModal.classList.remove("is-resolving");
    if (data.dims) renderRow({ guessName: data.answerName, dims: data.dims, operator: data.operator, archive: data.archive, final: true });
    if (data.win) {
      finishGame(true, "终局校验通过！答案是 " + data.answerName + "，共用了 " + suddenMax + " 次猜测 + 1 次抉择");
    } else {
      finishGame(false, "猜错了……答案是 " + data.answerName);
    }
  } catch (e) {
    choiceModal.classList.remove("is-resolving");
    btns.forEach((b) => {
      b.disabled = false;
      b.classList.remove("choice-selected", "choice-exit-left", "choice-exit-right");
    });
    setStatus("终局校验失败，请重试。", true);
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
  if (config.metaText) {
    const metaEl = document.createElement("span");
    metaEl.className = "clue-meta";
    metaEl.textContent = config.metaText;
    clue.appendChild(metaEl);
  }
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

function rarityText(rarity) {
  return "★".repeat(Math.max(1, parseInt(rarity, 10) || 1));
}

function artUrl(operatorId, final) {
  const entry = operatorArt[operatorId];
  if (entry) return final ? entry.final : entry.e1;
  return "/img/operators/e1/" + encodeURIComponent(operatorId) + ".webp";
}

function archiveLine(label, value, options) {
  const opts = options || {};
  const line = document.createElement("div");
  line.className = "archive-line" + (opts.wide ? " archive-line-wide" : "") + (opts.branch ? " archive-line-branch" : "");
  const key = document.createElement("strong");
  key.textContent = "【" + label + "】";
  const content = document.createElement("span");
  content.textContent = value || "未公开";
  if (opts.branch) {
    const iconBox = document.createElement("i");
    iconBox.className = "subprofession-mark";
    const icon = document.createElement("img");
    icon.src = "/img/subprofession/" + encodeURIComponent(opts.branch) + ".webp";
    icon.alt = "";
    icon.addEventListener("error", () => iconBox.classList.add("image-missing"));
    iconBox.appendChild(icon);
    line.appendChild(iconBox);
  }
  line.appendChild(key);
  line.appendChild(content);
  return line;
}

function archiveSection(title, subtitle, lines) {
  const section = document.createElement("section");
  section.className = "archive-section";
  const head = document.createElement("header");
  const titleEl = document.createElement("strong");
  titleEl.textContent = title;
  const subtitleEl = document.createElement("span");
  subtitleEl.textContent = subtitle;
  head.appendChild(titleEl);
  head.appendChild(subtitleEl);
  const body = document.createElement("div");
  body.className = "archive-lines";
  lines.forEach((line) => body.appendChild(line));
  section.appendChild(head);
  section.appendChild(body);
  return section;
}

function parseArchiveLines(text) {
  const lines = [];
  const pattern = /【([^】]+)】\s*([\s\S]*?)(?=【[^】]+】|$)/g;
  let match;
  while ((match = pattern.exec(text || ""))) {
    lines.push(archiveLine(match[1].trim(), match[2].trim(), {
      wide: match[1].includes("感染情况"),
    }));
  }
  return lines;
}

function createNarrativeSection(section, index) {
  const narrative = document.createElement("section");
  narrative.className = "archive-narrative";
  const head = document.createElement("header");
  head.className = "archive-narrative-head";
  const number = document.createElement("span");
  number.textContent = String(index + 1).padStart(2, "0");
  const title = document.createElement("strong");
  title.textContent = section.title;
  const status = document.createElement("i");
  status.textContent = "ARCHIVE DATA";
  head.appendChild(number);
  head.appendChild(title);
  head.appendChild(status);
  const text = document.createElement("div");
  text.className = "archive-narrative-text";
  section.text.split(/\n{2,}/).forEach((paragraph) => {
    const p = document.createElement("p");
    p.textContent = paragraph;
    text.appendChild(p);
  });
  narrative.appendChild(head);
  narrative.appendChild(text);
  return narrative;
}

function createFinalArchive(operator, dims, archiveData) {
  const sheet = document.createElement("div");
  sheet.className = "final-archive-sheet";
  const heading = document.createElement("div");
  heading.className = "archive-sheet-heading";
  heading.innerHTML = "<span>RHODES ISLAND</span><strong>人员档案</strong><small>PERSONNEL FILE</small>";
  sheet.appendChild(heading);

  const tags = operator.tags && operator.tags.length ? operator.tags.join(" / ") : (dims.tags.guess || []).join(" / ");
  const classification = document.createElement("div");
  classification.className = "archive-classification";
  classification.appendChild(archiveLine("职业定位", operator.professionText || dimText(dims.profession)));
  classification.appendChild(archiveLine("职业分支", operator.subProfessionText || dimText(dims.subProfession), { branch: operator.subProfessionId }));
  classification.appendChild(archiveLine("稀有度", rarityText(operator.rarity || dims.rarity.guess)));
  classification.appendChild(archiveLine("部署位置", dimText(dims.position)));
  classification.appendChild(archiveLine("作战标签", tags, { wide: true }));
  sheet.appendChild(classification);

  const sections = Array.isArray(archiveData) ? archiveData : [];
  const content = document.createElement("div");
  content.className = "archive-content";
  if (sections.length) {
    let narrativeIndex = 0;
    sections.forEach((section) => {
      if (section.title === "基础档案" || section.title === "综合体检测试") {
        const subtitle = section.title === "基础档案" ? "BASIC FILE" : "COMPREHENSIVE TEST";
        content.appendChild(archiveSection(section.title, subtitle, parseArchiveLines(section.text)));
      } else {
        content.appendChild(createNarrativeSection(section, narrativeIndex));
        narrativeIndex += 1;
      }
    });
  } else {
    content.appendChild(archiveSection("基础档案", "BASIC FILE", [
      archiveLine("性别", operator.gender || dimText(dims.gender)),
      archiveLine("战斗经验", operator.expText || dimText(dims.exp)),
      archiveLine("出身地", operator.origin || dimText(dims.origin)),
      archiveLine("生日", operator.birthdayText || dimText(dims.birthday)),
      archiveLine("种族", operator.race || dimText(dims.race)),
      archiveLine("身高", operator.heightText || dimText(dims.height)),
      archiveLine("矿石病感染情况", operator.infectedText || dimText(dims.infected), { wide: true }),
    ]));
  }
  sheet.appendChild(content);

  const seal = document.createElement("span");
  seal.className = "archive-verified-seal";
  seal.textContent = "12 / 12 VERIFIED";
  sheet.appendChild(seal);
  return sheet;
}

function attachMobileRecordPager(card, layout, image, finalRecord) {
  const pager = document.createElement("nav");
  pager.className = "mobile-record-pager";
  pager.setAttribute("aria-label", "切换立绘和档案信息");
  const labels = ["立绘", finalRecord ? "完整档案" : "档案"];
  const buttons = labels.map((label, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = index === 0 ? "active" : "";
    button.setAttribute("aria-label", "显示" + label);
    button.innerHTML = "<i aria-hidden=\"true\"></i><span>" + label + "</span>";
    pager.appendChild(button);
    return button;
  });
  const swipe = document.createElement("em");
  swipe.textContent = "SWIPE ↔";
  pager.appendChild(swipe);

  let userNavigated = false;
  let gestureStart = null;
  let suppressClickUntil = 0;
  const setPage = (index) => {
    layout.classList.toggle("mobile-show-record", index === 1);
    buttons.forEach((button, buttonIndex) => button.classList.toggle("active", buttonIndex === index));
  };
  buttons.forEach((button, index) => button.addEventListener("click", () => {
    userNavigated = true;
    setPage(index);
  }));
  layout.addEventListener("pointerdown", (event) => {
    if (!window.matchMedia("(max-width: 760px)").matches || event.button !== 0) return;
    gestureStart = { x: event.clientX, y: event.clientY };
  }, { passive: true });
  layout.addEventListener("pointerup", (event) => {
    if (!gestureStart) return;
    const deltaX = event.clientX - gestureStart.x;
    const deltaY = event.clientY - gestureStart.y;
    gestureStart = null;
    if (Math.abs(deltaX) < 42 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    userNavigated = true;
    suppressClickUntil = Date.now() + 400;
    setPage(deltaX < 0 ? 1 : 0);
  }, { passive: true });
  layout.addEventListener("pointercancel", () => { gestureStart = null; }, { passive: true });
  layout.addEventListener("click", (event) => {
    if (Date.now() >= suppressClickUntil) return;
    event.preventDefault();
    event.stopPropagation();
  }, true);

  card.appendChild(pager);
  const imageReady = image.complete
    ? Promise.resolve()
    : new Promise((resolve) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", resolve, { once: true });
    });
  card.addEventListener("mobile-show-record", () => {
    imageReady.then(() => {
      if (userNavigated || !card.isConnected) return;
      setPage(1);
    });
  });
  if (!finalRecord) imageReady.then(() => {
    window.setTimeout(() => {
      if (!window.matchMedia("(max-width: 760px)").matches || userNavigated || !card.isConnected) return;
      setPage(1);
    }, 720);
  });
}

function renderRow(r) {
  const d = r.dims;
  const operator = r.operator || {};
  const finalRecord = !!(r.final || r.win);
  const artEntry = operatorArt[operator.id] || {};
  const card = document.createElement("article");
  card.className = "guess-card" + (finalRecord ? " is-final-record" : "");
  if (!finalRecord) {
    card.classList.add("card-entering");
    window.setTimeout(() => card.classList.remove("card-entering"), 1200);
  }

  const layout = document.createElement("div");
  layout.className = "operator-record-layout";
  const visual = document.createElement("aside");
  visual.className = "operator-visual";
  const visualScan = document.createElement("span");
  visualScan.className = "operator-visual-scan";
  const image = document.createElement("img");
  image.className = "operator-art";
  image.src = artUrl(operator.id, finalRecord);
  const artLabel = finalRecord
    ? (artEntry.finalKind === "skin" ? " 最新时装立绘" : " 最终档案立绘")
    : " 精英一阶段立绘";
  image.alt = r.guessName + artLabel;
  image.loading = finalRecord || window.matchMedia("(max-width: 760px)").matches ? "eager" : "lazy";
  image.decoding = "async";
  image.addEventListener("error", () => visual.classList.add("image-missing"));
  visual.classList.add("art-preview-trigger");
  visual.tabIndex = 0;
  visual.setAttribute("role", "button");
  visual.setAttribute("aria-label", "查看" + r.guessName + "立绘大图");
  const showLargeArt = () => {
    if (!visual.classList.contains("image-missing")) openArtPreview(image, r.guessName, artLabel.trim(), visual);
  };
  visual.addEventListener("click", showLargeArt);
  visual.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      showLargeArt();
    }
  });
  const artCaption = document.createElement("div");
  artCaption.className = "operator-art-caption";
  const captionEn = document.createElement("span");
  captionEn.textContent = finalRecord ? "FINAL ARCHIVE" : "ELITE 1 RECORD";
  const captionTitle = document.createElement("strong");
  captionTitle.textContent = finalRecord ? (artEntry.finalTitle || "最新形象") : "精英一阶段";
  artCaption.appendChild(captionEn);
  artCaption.appendChild(captionTitle);
  visual.appendChild(visualScan);
  visual.appendChild(image);
  visual.appendChild(artCaption);

  const record = document.createElement("div");
  record.className = "operator-record-data";

  const head = document.createElement("header");
  head.className = "guess-card-head";
  const identity = document.createElement("div");
  identity.className = "guess-identity";
  const number = document.createElement("span");
  number.className = "guess-number";
  number.textContent = String(rowsEl.children.length + 1).padStart(2, "0");
  const title = document.createElement("div");
  title.className = "guess-title";
  title.innerHTML = "<small>" + (finalRecord ? "PERSONNEL ARCHIVE / 人员档案" : "OPERATOR RECORD") + "</small>";
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
  add(createClue("星级", d.rarity, d.rarity.state === "exact" ? "星级吻合" : hintTitle("星级", d.rarity.state), {
    metaText: rarityText(operator.rarity || d.rarity.guess),
  }));
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
  record.appendChild(head);

  if (finalRecord) {
    record.appendChild(createFinalArchive(operator, d, r.archive));
  } else {
    record.appendChild(grid);
  }
  layout.appendChild(visual);
  layout.appendChild(record);
  card.appendChild(layout);
  attachMobileRecordPager(card, layout, image, finalRecord);
  gameScreen.classList.add("has-guesses");
  document.body.classList.add("mobile-record-active");
  boardEmpty.classList.add("hidden");
  rowsEl.prepend(card);
  rowsEl.scrollTop = 0;
}

/* ---------- 放弃 ---------- */

function openRevealConfirm(source) {
  if (finished || !token) return;
  pendingRevealSource = source;
  revealReturnFocus = document.activeElement;
  revealAttemptText.textContent = "已猜 " + attempts + " 次";
  revealModalDesc.textContent = source === "choice"
    ? "放弃终局校验后将立即公开目标干员完整档案，本局识别结果将判定为失败。"
    : "确认后将立即公开目标干员完整档案，本局识别结果将判定为失败。";
  revealModal.classList.remove("hidden", "is-resolving");
  revealCancel.disabled = false;
  revealConfirm.disabled = false;
  revealCancel.focus({ preventScroll: true });
}

function closeRevealConfirm(restoreFocus) {
  revealModal.classList.add("hidden");
  revealModal.classList.remove("is-resolving");
  pendingRevealSource = null;
  if (restoreFocus && revealReturnFocus && typeof revealReturnFocus.focus === "function") {
    revealReturnFocus.focus({ preventScroll: true });
  }
  revealReturnFocus = null;
}

async function confirmReveal() {
  if (!pendingRevealSource || finished || !token) return;
  const source = pendingRevealSource;
  revealModal.classList.add("is-resolving");
  revealCancel.disabled = true;
  revealConfirm.disabled = true;
  try {
    const data = await fetchJSON("/api/reveal?token=" + encodeURIComponent(token));
    if (data.error) throw new Error(data.error);
    closeRevealConfirm(false);
    if (source === "choice") choiceModal.classList.add("hidden");
    if (data.dims) renderRow({ guessName: data.answerName, dims: data.dims, operator: data.operator, archive: data.archive, final: true });
    finishGame(false, "本局答案是 " + data.answerName + "，共猜了 " + attempts + " 次");
  } catch (e) {
    revealModal.classList.remove("is-resolving");
    revealCancel.disabled = false;
    revealConfirm.disabled = false;
    revealModalDesc.textContent = "档案读取失败，请检查连接后重试，或返回继续检索。";
    revealCancel.focus({ preventScroll: true });
  }
}

function giveUp() {
  openRevealConfirm("game");
}

function giveUpChoice() {
  openRevealConfirm("choice");
}

/* ---------- 模式切换 ---------- */

function showModeScreen() {
  document.body.dataset.mode = "";
  clearFinalSequence();
  gameScreen.classList.remove("is-finished");
  document.body.classList.remove("mobile-record-active", "mobile-game-finished");
  victoryEl.classList.add("hidden");
  updateHudTags("");
  setModePreview("");
  syncSuddenControls(suddenMax);
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

function bindFinishedScrollProxy(element) {
  if (!element || !boardEl) return;
  let touchStartY = null;
  let scrollStart = 0;
  const enabled = () => document.body.classList.contains("mobile-game-finished")
    && window.matchMedia("(max-width: 760px)").matches;
  element.addEventListener("touchstart", (event) => {
    if (!enabled() || event.touches.length !== 1) return;
    touchStartY = event.touches[0].clientY;
    scrollStart = boardEl.scrollTop;
  }, { passive: true });
  element.addEventListener("touchmove", (event) => {
    if (touchStartY == null || !enabled() || event.touches.length !== 1) return;
    const delta = touchStartY - event.touches[0].clientY;
    if (Math.abs(delta) < 3) return;
    boardEl.scrollTop = scrollStart + delta;
    event.preventDefault();
  }, { passive: false });
  const endTouch = () => { touchStartY = null; };
  element.addEventListener("touchend", endTouch, { passive: true });
  element.addEventListener("touchcancel", endTouch, { passive: true });
  element.addEventListener("wheel", (event) => {
    if (!enabled() || !event.deltaY) return;
    boardEl.scrollTop += event.deltaY;
    event.preventDefault();
  }, { passive: false });
}

/* ---------- 事件绑定 ---------- */

[topbar, gameMeta, dossierHead].forEach(bindFinishedScrollProxy);

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
ingameChangeModeBtn.addEventListener("click", showModeScreen);
choiceGiveup.addEventListener("click", giveUpChoice);
revealCancel.addEventListener("click", () => closeRevealConfirm(true));
revealConfirm.addEventListener("click", confirmReveal);
revealModal.addEventListener("click", (e) => {
  if (e.target === revealModal && !revealModal.classList.contains("is-resolving")) closeRevealConfirm(true);
});
artPreviewClose.addEventListener("click", () => closeArtPreview(true));
artPreview.addEventListener("click", (e) => {
  if (e.target === artPreview) closeArtPreview(true);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !artPreview.classList.contains("hidden")) {
    closeArtPreview(true);
    return;
  }
  if (e.key === "Escape" && !revealModal.classList.contains("hidden") && !revealModal.classList.contains("is-resolving")) {
    closeRevealConfirm(true);
  }
});
modeEndlessBtn.addEventListener("click", () => startEndless());
applySuddenAttempts.addEventListener("click", () => startGame("sudden", suddenAttemptsGame.value));
suddenAttemptsMode.addEventListener("change", () => syncSuddenControls(suddenAttemptsMode.value));
suddenAttemptsMode.addEventListener("keydown", (e) => {
  if (e.key === "Enter") startSudden();
});
suddenAttemptsGame.addEventListener("keydown", (e) => {
  if (e.key === "Enter") startGame("sudden", suddenAttemptsGame.value);
});

modeSuddenCard.addEventListener("click", (e) => {
  if (e.target.closest(".attempt-control")) return;
  startSudden();
});

[modeSuddenCard, modeEndlessBtn].forEach((el) => {
  const mode = el === modeSuddenCard ? "sudden" : "endless";
  el.addEventListener("mouseenter", () => setModePreview(mode));
  el.addEventListener("focusin", () => setModePreview(mode));
  el.addEventListener("mouseleave", () => setModePreview(""));
  el.addEventListener("focusout", (e) => {
    if (!el.contains(e.relatedTarget)) setModePreview("");
  });
});

async function startSudden() {
  showGameScreen();
  await startGame("sudden", suddenAttemptsMode.value);
}

async function startEndless() {
  showGameScreen();
  await startGame("endless");
}

/* ---------- 初始化 ---------- */

async function init() {
  const [names, art] = await Promise.all([
    fetchJSON("data/names.json"),
    fetchJSON("data/operator-art.json").catch(() => ({})),
  ]);
  namesIndex = names;
  operatorArt = art;
  validNames = new Set(names.map((x) => x.n));
  showModeScreen();
}

init();
