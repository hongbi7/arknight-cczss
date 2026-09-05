const MODE_LABELS = { sudden: "终局校验", endless: "全域检索" };
const DEFAULT_SUDDEN_ATTEMPTS = 6;
const SUDDEN_MIN = 1;
const SUDDEN_LIMIT = 20;
const SUDDEN_VERSION = 3;
const DIRECTIVE_HISTORY_KEY = "operator-trace-directive-history-v2";
const DIRECTIVE_HISTORY_LIMIT = 40;
const FIRST_VISUAL_THEME_ID = "visual_brand_shan-hu-hai-an";
const CORAL_HISTORY_LIMIT = 3;
const DIRECTIVE_FIRST_CYCLE_MARKER = "__directive_first_family_cycle_complete__";
const DIRECTIVE_FAMILIES = ["skill", "battle", "identity", "logistics", "visual"];
const DEFAULT_ENDLESS_BUBBLE_MEDIA = "img/endfield-toad.png";

let token = null;
let namesIndex = [];
let validNames = new Set();
let operatorSearchEngine = null;
let endlessEasterEggs = null;
let lastEndlessInputTriggerKey = "";
let currentMode = "sudden";
let currentGameVersion = 1;
let attempts = 0;
let finished = false;
let suggestItems = [];
let activeIndex = -1;
let quickSuggestItems = [];
let quickActiveIndex = -1;
let quickVisibilityFrame = null;
let workspaceWheelFrame = null;
let workspaceWheelDistance = 0;
let totalOperators = 0;
let suddenMax = DEFAULT_SUDDEN_ATTEMPTS;
let bubbleTimer = null;
let mobileBubbleDelayTimer = null;
let mobileBubbleHideTimer = null;
let finalFocusTimer = null;
let finalArchiveTimer = null;
let pendingVisualIntelReveal = null;
let operatorArt = {};
let gameStartSequence = 0;
let wipeSequence = 0;
let directiveIntroTimer = null;
let roundContentTimer = null;
let modeFocusTimer = null;
let modeFocusFrame = null;
let modeIntroSequence = 0;

/* ---- 战术指令（V3）状态 ---- */
let directiveSnapshot = null;
let pendingClue = null;
let decodedIntel = [];
let clueDecoding = false;
let directiveCompletionPlayed = false;

const modeScreen = document.getElementById("modeScreen");
const gameScreen = document.getElementById("gameScreen");
const gameWorkspace = document.querySelector(".game-workspace");
const guessConsole = document.querySelector(".guess-console");
const modeLabel = document.getElementById("modeLabel");
const attemptLabel = document.getElementById("attemptLabel");
const input = document.getElementById("guessInput");
const btn = document.getElementById("guessBtn");
const quickInput = document.getElementById("quickGuessInput");
const quickBtn = document.getElementById("quickGuessBtn");
const quickSuggestEl = document.getElementById("quickSuggest");
const revealBtn = document.getElementById("revealBtn");
const statusEl = document.getElementById("status");
const rowsEl = document.getElementById("rows");
const boardEmpty = document.getElementById("boardEmpty");
const victoryEl = document.getElementById("victory");
const victoryText = document.getElementById("victoryText");
const victoryEyebrow = document.getElementById("victoryEyebrow");
const restartBtn = document.getElementById("restartBtn");
const changeModeBtn = document.getElementById("changeModeBtn");
const ingameRestartBtn = document.getElementById("ingameRestartBtn");
const ingameChangeModeBtn = document.getElementById("ingameChangeModeBtn");
const suggestEl = document.getElementById("suggest");
const livesPips = document.getElementById("livesPips");
const choiceModal = document.getElementById("choiceModal");
const choiceList = document.getElementById("choiceList");
const choiceGiveup = document.getElementById("choiceGiveup");
const hudTagL = document.getElementById("hudTagL");
const hudTagR = document.getElementById("hudTagR");
const modeStage = document.querySelector(".mode-stage");
const modeCards = document.querySelector(".mode-cards");
const modeSuddenCard = document.getElementById("modeSuddenCard");
const modeEndlessBtn = document.getElementById("modeEndless");
const modeAnomalyCard = document.getElementById("modeAnomalyCard");
const modeAnomalyGo = document.getElementById("modeAnomalyGo");
const suddenModeDesc = document.getElementById("suddenModeDesc");
const suddenAttemptsMode = document.getElementById("suddenAttemptsMode");
const suddenGameConfig = document.getElementById("suddenGameConfig");
const suddenAttemptsGame = document.getElementById("suddenAttemptsGame");
const applySuddenAttempts = document.getElementById("applySuddenAttempts");
const endlessBubble = document.getElementById("endlessBubble");
const endlessBubbleMedia = document.getElementById("endlessBubbleMedia");
const endlessBubbleText = document.getElementById("endlessBubbleText");
const endlessProgress = document.getElementById("endlessProgress");
const mobileEndlessBubble = document.getElementById("mobileEndlessBubble");
const mobileEndlessBubbleMedia = document.getElementById("mobileEndlessBubbleMedia");
const mobileEndlessBubbleText = document.getElementById("mobileEndlessBubbleText");
const mobileEndlessProgress = document.getElementById("mobileEndlessProgress");
const choiceModalSub = document.getElementById("choiceModalSub");
const gameSidebarIndex = document.getElementById("gameSidebarIndex");
const gameSidebarTitle = document.getElementById("gameSidebarTitle");
const gameSidebarDesc = document.getElementById("gameSidebarDesc");
const topbarContextEn = document.getElementById("topbarContextEn");
const topbarSubtitle = document.getElementById("topbarSubtitle");
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
const artPreviewCanvas = document.querySelector(".art-preview-canvas");
const mobileDataSheet = document.getElementById("mobileDataSheet");
const mobileDataSheetBackdrop = document.getElementById("mobileDataSheetBackdrop");
const mobileDataSheetClose = document.getElementById("mobileDataSheetClose");
const mobileDataSheetTitle = document.getElementById("mobileDataSheetTitle");
const mobileDataSheetBody = document.getElementById("mobileDataSheetBody");
const boardEl = document.getElementById("board");
const gameMeta = document.querySelector(".game-meta");
const dossierHead = document.querySelector(".dossier-head");
const topbar = document.querySelector(".topbar");

/* ---- 战术指令（V3）DOM ---- */
const directivePanel = document.getElementById("directivePanel");
const directiveMainView = document.getElementById("directiveMainView");
const directiveIntelView = document.getElementById("directiveIntelView");
const directiveState = document.getElementById("directiveState");
const directiveFamily = document.getElementById("directiveFamily");
const directiveTitle = document.getElementById("directiveTitle");
const directiveDesc = document.getElementById("directiveDesc");
const directiveNodes = document.getElementById("directiveNodes");
const directiveProgress = document.getElementById("directiveProgress");
const directiveNote = document.getElementById("directiveNote");
const directiveDecodeBtn = document.getElementById("directiveDecodeBtn");
const directiveAnnounce = document.getElementById("directiveAnnounce");
const mobileDirectiveDock = document.getElementById("mobileDirectiveDock");
const mobileDirectiveTitle = document.getElementById("mobileDirectiveTitle");
const mobileDirectiveProgress = document.getElementById("mobileDirectiveProgress");
const mobileDirectiveDecodeBtn = document.getElementById("mobileDirectiveDecodeBtn");
const mobileDirectiveDesc = document.getElementById("mobileDirectiveDesc");
const intelRail = document.getElementById("intelRail");

let pendingRevealSource = null;
let revealReturnFocus = null;
let artPreviewReturnFocus = null;
let artPreviewMetaBase = "";
let artPreviewScale = 1;
let artPreviewOriginX = 50;
let artPreviewOriginY = 50;
let mobileDataSheetReturnFocus = null;
let mobileGameViewportFrame = null;
let mobileGameViewportTimer = null;
let mobileGuessDockFrame = null;

function setStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.className = "status" + (isError ? " error" : "");
}

function updateArtPreviewZoom() {
  artPreviewImage.style.setProperty("--preview-scale", artPreviewScale.toFixed(3));
  artPreviewImage.style.setProperty("--preview-origin-x", artPreviewOriginX.toFixed(2) + "%");
  artPreviewImage.style.setProperty("--preview-origin-y", artPreviewOriginY.toFixed(2) + "%");
  artPreview.dataset.zoomed = artPreviewScale > 1.001 ? "true" : "false";
  artPreviewMeta.textContent = artPreviewMetaBase + " // " + (isMobileLayout()
    ? "双指缩放 · 点击图像返回"
    : Math.round(artPreviewScale * 100) + "% · 滚轮缩放");
}

function resetArtPreviewZoom() {
  artPreviewScale = 1;
  artPreviewOriginX = 50;
  artPreviewOriginY = 50;
  updateArtPreviewZoom();
}

function syncArtPreviewViewport() {
  if (!artPreview || artPreview.classList.contains("hidden")) return;
  if (!isMobileLayout()) {
    artPreview.removeAttribute("style");
    return;
  }
  const viewport = window.visualViewport;
  artPreview.style.left = (viewport ? viewport.offsetLeft : 0) + "px";
  artPreview.style.top = (viewport ? viewport.offsetTop : 0) + "px";
  artPreview.style.width = (viewport ? viewport.width : window.innerWidth) + "px";
  artPreview.style.height = (viewport ? viewport.height : window.innerHeight) + "px";
}

function openArtPreview(image, operatorName, artLabel, returnFocus, imageKind) {
  const source = image && (image.currentSrc || image.src);
  if (!source) return;
  artPreviewReturnFocus = returnFocus || document.activeElement;
  if (imageKind) artPreview.dataset.imageKind = imageKind;
  else delete artPreview.dataset.imageKind;
  artPreviewImage.src = source;
  artPreviewImage.alt = operatorName + " " + artLabel + "大图";
  artPreviewTitle.textContent = operatorName;
  artPreviewMetaBase = artLabel + " // FULL IMAGE ARCHIVE";
  resetArtPreviewZoom();
  artPreview.classList.remove("hidden");
  document.body.classList.add("art-preview-open");
  syncArtPreviewViewport();
  artPreviewClose.focus({ preventScroll: true });
}

function closeArtPreview(restoreFocus) {
  artPreview.classList.add("hidden");
  document.body.classList.remove("art-preview-open");
  delete artPreview.dataset.imageKind;
  delete artPreview.dataset.zoomed;
  artPreviewImage.removeAttribute("src");
  artPreviewImage.style.removeProperty("--preview-scale");
  artPreviewImage.style.removeProperty("--preview-origin-x");
  artPreviewImage.style.removeProperty("--preview-origin-y");
  artPreview.removeAttribute("style");
  artPreviewMetaBase = "";
  if (restoreFocus && artPreviewReturnFocus && typeof artPreviewReturnFocus.focus === "function") {
    artPreviewReturnFocus.focus({ preventScroll: true });
  }
  artPreviewReturnFocus = null;
}

function closeMobileArtPreviewFromCanvas() {
  if (!isMobileLayout() || artPreview.classList.contains("hidden")) return;
  /* 双指捏合刚结束时的残余点击不触发关闭，避免缩放后被误退出 */
  if (performance.now() - artPreviewPinchedAt < 320) return;
  const imageKind = artPreview.dataset.imageKind || "";
  const closeIntelSheet = imageKind === "silhouette" || imageKind === "artFragment";
  closeArtPreview(!closeIntelSheet);
  if (closeIntelSheet && mobileDataSheet && !mobileDataSheet.classList.contains("hidden")) {
    closeMobileDataSheet(false);
  }
}

function syncMobileDataSheetViewport() {
  if (!mobileDataSheet || mobileDataSheet.classList.contains("hidden")) return;
  const viewport = window.visualViewport;
  mobileDataSheet.style.left = (viewport ? viewport.offsetLeft : 0) + "px";
  mobileDataSheet.style.top = (viewport ? viewport.offsetTop : 0) + "px";
  mobileDataSheet.style.width = (viewport ? viewport.width : window.innerWidth) + "px";
  mobileDataSheet.style.height = (viewport ? viewport.height : window.innerHeight) + "px";
}

function openMobileDataSheet(title, kind, content, returnFocus) {
  if (!isMobileLayout() || !mobileDataSheet || !mobileDataSheetBody || !content) return;
  mobileDataSheetReturnFocus = returnFocus || document.activeElement;
  mobileDataSheetTitle.textContent = title || "档案详情";
  mobileDataSheet.dataset.kind = kind || "detail";
  mobileDataSheetBody.innerHTML = "";
  mobileDataSheetBody.appendChild(content);
  mobileDataSheet.classList.remove("hidden");
  document.body.classList.add("mobile-data-sheet-open");
  syncMobileDataSheetViewport();
  mobileDataSheetClose.focus({ preventScroll: true });
}

function closeMobileDataSheet(restoreFocus) {
  if (!mobileDataSheet) return;
  mobileDataSheet.classList.add("hidden");
  document.body.classList.remove("mobile-data-sheet-open");
  delete mobileDataSheet.dataset.kind;
  mobileDataSheet.removeAttribute("style");
  if (mobileDataSheetBody) mobileDataSheetBody.innerHTML = "";
  if (restoreFocus && mobileDataSheetReturnFocus && typeof mobileDataSheetReturnFocus.focus === "function") {
    mobileDataSheetReturnFocus.focus({ preventScroll: true });
  }
  mobileDataSheetReturnFocus = null;
}

async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  return res.json();
}

function playWipe() {
  const wipe = document.querySelector(".wipe");
  if (!wipe) return { covered: Promise.resolve(), finished: Promise.resolve() };
  const runId = ++wipeSequence;
  let coverResolve;
  const covered = new Promise((resolve) => { coverResolve = resolve; });
  wipe.classList.remove("play");
  void wipe.offsetWidth;
  wipe.classList.add("play");
  const finished = new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      wipe.removeEventListener("animationend", onAnimationEnd);
      if (runId === wipeSequence) wipe.classList.remove("play");
      resolve();
    };
    const onAnimationEnd = (event) => {
      if (event.target === wipe && event.animationName === "wipe-overlay") finish();
    };
    wipe.addEventListener("animationend", onAnimationEnd);
    window.setTimeout(finish, isReducedMotion() ? 40 : 940);
  });
  window.setTimeout(coverResolve, isReducedMotion() ? 0 : 210);
  return { covered, finished };
}

function stageDirectiveIntro(enabled) {
  if (!directivePanel) return;
  if (directiveIntroTimer) window.clearTimeout(directiveIntroTimer);
  directiveIntroTimer = null;
  directivePanel.classList.remove("directive-boot", "directive-flash", "directive-round-enter");
  directivePanel.classList.toggle("directive-awaiting", Boolean(enabled));
}

function releaseDirectiveIntro() {
  if (!directivePanel) return;
  directivePanel.classList.remove("directive-awaiting", "directive-round-enter");
}

function setModeLaunching(mode, launching) {
  modeSuddenCard.classList.toggle("is-launching", Boolean(launching && mode === "sudden"));
  modeEndlessBtn.classList.toggle("is-launching", Boolean(launching && mode === "endless"));
  modeAnomalyCard.classList.toggle("is-launching", Boolean(launching && mode === "anomaly"));
}

function resetRoundInterface(mode) {
  clearFinalSequence();
  resetDirectiveState();
  gameScreen.classList.remove("has-guesses", "has-single-record", "is-finished");
  document.body.classList.remove("mobile-record-active", "mobile-game-finished", "quick-guess-active");
  clearMobileGameViewport();
  input.value = "";
  quickInput.value = "";
  rowsEl.classList.remove("mobile-new-record-positioned");
  if (dossierHead && dossierHead.parentElement) {
    dossierHead.parentElement.style.removeProperty("translate");
    delete dossierHead.parentElement.dataset.mobileRecordShift;
  }
  rowsEl.innerHTML = "";
  boardEmpty.classList.remove("hidden");
  victoryEl.classList.add("hidden");
  victoryEl.classList.remove("fail");
  choiceModal.classList.add("hidden");
  hideSuggest();
  hideQuickSuggest();
  modeLabel.textContent = MODE_LABELS[mode];
  modeLabel.classList.toggle("hot", mode === "sudden");
  suddenGameConfig.classList.toggle("hidden", mode !== "sudden");
  updateAttemptConfigState();
  setStatus("正在准备谜题……");
}

function stageRoundContentExit() {
  if (roundContentTimer) window.clearTimeout(roundContentTimer);
  roundContentTimer = null;
  gameScreen.classList.remove("round-content-enter", "round-content-staged", "round-content-buffer-staged", "round-content-buffered");
  gameScreen.classList.add("round-content-exit");
}

function stageRoundContentEntry() {
  if (roundContentTimer) window.clearTimeout(roundContentTimer);
  roundContentTimer = null;
  gameScreen.classList.remove("round-content-enter", "round-content-exit");
  gameScreen.classList.add("round-content-buffered", "round-content-buffer-staged", "round-content-staged");
}

function playRoundContentEntry() {
  gameScreen.classList.remove("round-buffering");
  gameScreen.classList.add("round-content-enter");
  gameScreen.classList.remove("round-content-staged", "round-content-buffer-staged");
  roundContentTimer = window.setTimeout(() => {
    gameScreen.classList.remove("round-content-enter", "round-content-buffered");
    roundContentTimer = null;
  }, 980);
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
  if (document.body.dataset.mode === "sudden") updateSidebarModeCopy("sudden");
}

function directiveHistory() {
  try {
    const value = JSON.parse(localStorage.getItem(DIRECTIVE_HISTORY_KEY) || "[]");
    if (!Array.isArray(value)) return [];
    const valid = value.filter((themeId) => typeof themeId === "string");
    const firstCycleCompleted = valid.includes(DIRECTIVE_FIRST_CYCLE_MARKER);
    const coralCount = Math.min(
      CORAL_HISTORY_LIMIT,
      valid.filter((themeId) => themeId === FIRST_VISUAL_THEME_ID).length
    );
    const lastWasCoral = valid[0] === FIRST_VISUAL_THEME_ID;
    const rotationHistory = valid
      .filter((themeId) =>
        themeId !== FIRST_VISUAL_THEME_ID && themeId !== DIRECTIVE_FIRST_CYCLE_MARKER
      )
      .slice(0, DIRECTIVE_HISTORY_LIMIT);
    const normalized = lastWasCoral
      ? [FIRST_VISUAL_THEME_ID, ...rotationHistory]
      : rotationHistory;
    normalized.push(...Array(coralCount - (lastWasCoral ? 1 : 0)).fill(FIRST_VISUAL_THEME_ID));
    if (firstCycleCompleted) normalized.push(DIRECTIVE_FIRST_CYCLE_MARKER);
    return normalized;
  } catch (error) {
    return [];
  }
}

function clearDirectiveHistory() {
  try {
    localStorage.removeItem(DIRECTIVE_HISTORY_KEY);
  } catch (error) {
    /* 隐私模式或存储受限时无需额外处理。 */
  }
}

function rememberDirective(theme) {
  if (!theme || !theme.id) return;
  try {
    // 其他主题保留真实重复序列；珊瑚海岸累计前三次，并仅用首位记录“上一局是珊瑚海岸”。
    const recent = directiveHistory();
    const firstCycleCompleted = recent.includes(DIRECTIVE_FIRST_CYCLE_MARKER);
    const coralCount = Math.min(
      CORAL_HISTORY_LIMIT,
      recent.filter((themeId) => themeId === FIRST_VISUAL_THEME_ID).length
        + (theme.id === FIRST_VISUAL_THEME_ID ? 1 : 0)
    );
    const rotationHistory = recent.filter((themeId) =>
      themeId !== FIRST_VISUAL_THEME_ID && themeId !== DIRECTIVE_FIRST_CYCLE_MARKER
    );
    if (theme.id !== FIRST_VISUAL_THEME_ID) rotationHistory.unshift(theme.id);
    const next = theme.id === FIRST_VISUAL_THEME_ID
      ? [FIRST_VISUAL_THEME_ID, ...rotationHistory.slice(0, DIRECTIVE_HISTORY_LIMIT)]
      : rotationHistory.slice(0, DIRECTIVE_HISTORY_LIMIT);
    next.push(...Array(coralCount - (theme.id === FIRST_VISUAL_THEME_ID ? 1 : 0))
      .fill(FIRST_VISUAL_THEME_ID));
    const seenFamilies = new Set(next.map((themeId) => themeId.split("_", 1)[0]));
    if (firstCycleCompleted || DIRECTIVE_FAMILIES.every((family) => seenFamilies.has(family))) {
      next.push(DIRECTIVE_FIRST_CYCLE_MARKER);
    }
    localStorage.setItem(DIRECTIVE_HISTORY_KEY, JSON.stringify(next));
  } catch (error) {
    /* 隐私模式或存储受限时退化为无历史的服务端随机。 */
  }
}

function updateAttemptConfigState() {
  const configChanged = normalizeAttempts(suddenAttemptsGame.value) !== suddenMax;
  applySuddenAttempts.textContent = attempts > 0 || configChanged ? "应用并重开" : "应用本局";
}

function applySuddenAttemptConfig() {
  const requestedMax = normalizeAttempts(suddenAttemptsGame.value);
  const preserveDirectiveHistory = requestedMax === suddenMax;
  startGame("sudden", requestedMax, { preserveDirectiveHistory });
}

function clearFinalSequence() {
  if (finalFocusTimer) window.clearTimeout(finalFocusTimer);
  if (finalArchiveTimer) window.clearTimeout(finalArchiveTimer);
  finalFocusTimer = null;
  finalArchiveTimer = null;
  pendingVisualIntelReveal = null;
}

function isMobileLayout() {
  return window.matchMedia("(max-width: 760px)").matches;
}

function clearMobileGuessDock() {
  if (mobileGuessDockFrame != null) window.cancelAnimationFrame(mobileGuessDockFrame);
  mobileGuessDockFrame = null;
  document.body.classList.remove("mobile-guess-docked");
  guessConsole.style.removeProperty("left");
  guessConsole.style.removeProperty("top");
  guessConsole.style.removeProperty("width");
}

function shouldDockMobileGuessConsole() {
  return isMobileLayout()
    && gameScreen.classList.contains("has-guesses")
    && !gameScreen.classList.contains("hidden")
    && !gameScreen.classList.contains("is-finished");
}

/* 纯定位：仅按 visual viewport 当前几何写入固定控制台位置，不触碰档案锚点；锚点校正等同步路径复用它，避免与 positionMobileGuessDock 互相回调。 */
function applyMobileGuessDockPosition() {
  if (!shouldDockMobileGuessConsole()) return;
  const viewport = window.visualViewport;
  const viewportLeft = viewport ? viewport.offsetLeft : 0;
  const viewportTop = viewport ? viewport.offsetTop : 0;
  const viewportWidth = viewport ? viewport.width : window.innerWidth;
  const viewportHeight = viewport ? viewport.height : window.innerHeight;
  const workspaceWidth = gameWorkspace.getBoundingClientRect().width;
  const width = Math.max(0, Math.min(workspaceWidth, viewportWidth - 16));
  const height = guessConsole.getBoundingClientRect().height;
  guessConsole.style.left = Math.round(viewportLeft + (viewportWidth - width) / 2) + "px";
  guessConsole.style.top = Math.round(viewportTop + viewportHeight - height) + "px";
  guessConsole.style.width = Math.round(width) + "px";
}

function positionMobileGuessDock(realignAnchor) {
  if (!shouldDockMobileGuessConsole()) return;
  applyMobileGuessDockPosition();
  /* 纯视口平移（visualViewport scroll）时档案应随页面自然滚动，不重新贴合 */
  if (realignAnchor === false) return;
  const newestCard = rowsEl.firstElementChild;
  if (
    newestCard
    && newestCard.classList.contains("mobile-new-record-anchor")
  ) positionMobileNewRecordAnchor(newestCard);
}

function syncMobileGuessDock(options) {
  if (!shouldDockMobileGuessConsole()) {
    clearMobileGuessDock();
    return;
  }
  const realignAnchor = !options || options.realignAnchor !== false;
  const firstDockFrame = !document.body.classList.contains("mobile-guess-docked");
  gameScreen.classList.add("mobile-fixed-viewport-root");
  document.body.classList.add("mobile-guess-docked");
  if (firstDockFrame) positionMobileGuessDock(true);
  if (mobileGuessDockFrame != null) window.cancelAnimationFrame(mobileGuessDockFrame);
  mobileGuessDockFrame = window.requestAnimationFrame(() => {
    mobileGuessDockFrame = null;
    if (!shouldDockMobileGuessConsole()) {
      clearMobileGuessDock();
      return;
    }
    positionMobileGuessDock(realignAnchor);
  });
}

function clearMobileGameViewport() {
  if (mobileGameViewportFrame != null) window.cancelAnimationFrame(mobileGameViewportFrame);
  if (mobileGameViewportTimer != null) window.clearTimeout(mobileGameViewportTimer);
  mobileGameViewportFrame = null;
  mobileGameViewportTimer = null;
  document.documentElement.classList.remove("mobile-game-scroll-driving");
  document.documentElement.style.removeProperty("--mobile-game-viewport-height");
  document.body.classList.remove("mobile-compact-viewport");
  clearMobileGuessDock();
}

function syncMobileGameViewportHeight() {
  if (!isMobileLayout() || !document.body.classList.contains("mobile-record-active")) return;
  const viewport = window.visualViewport;
  const height = Math.max(320, Math.round(viewport ? viewport.height : window.innerHeight));
  document.documentElement.style.setProperty("--mobile-game-viewport-height", height + "px");
  /* 软键盘等紧凑视口下，单档案也回到视口约束布局，由 .guess-list 承担内部滚动。
     阈值 620 覆盖"档案卡+页头+固定控制台"的最小可行高度，避免卡片下沿被控制台永久遮挡。 */
  document.body.classList.toggle("mobile-compact-viewport", height < 620);
}

function alignMobileGameViewport() {
  if (!isMobileLayout() || !document.body.classList.contains("mobile-record-active")) return;
  if (mobileGameViewportFrame != null) window.cancelAnimationFrame(mobileGameViewportFrame);
  mobileGameViewportFrame = window.requestAnimationFrame(() => {
    mobileGameViewportFrame = window.requestAnimationFrame(() => {
      mobileGameViewportFrame = null;
      const layout = gameScreen.querySelector(".game-layout");
      if (!layout || gameScreen.classList.contains("hidden")) return;
      const viewport = window.visualViewport;
      const viewportTop = viewport ? viewport.offsetTop : 0;
      const viewportHeight = viewport ? viewport.height : window.innerHeight;
      const layoutRect = layout.getBoundingClientRect();
      const newestCard = rowsEl.firstElementChild;
      const shouldAlignNewest = newestCard
        && newestCard.classList.contains("mobile-new-record-anchor")
        && shouldDockMobileGuessConsole();
      /* 底部对齐保证档案区吃满可视区、固定控制台有容身余量。档案列表溢出（多条记录）时
         锚点位移为 0、档案区在自然槽位，此时若继续按底部对齐会把"档案比对"标题推出视口
         上沿，故改为不越过档案头顶部；列表未溢出时锚点位移负责让档案贴合控制台，保持
         底部对齐不变。 */
      const bottomTarget = window.scrollY + layoutRect.bottom - (viewportTop + viewportHeight);
      const rowsOverflowing = rowsEl.scrollHeight > rowsEl.clientHeight + 1;
      const dossierHeadEl = gameScreen.querySelector(".dossier-head");
      const headTarget = rowsOverflowing && dossierHeadEl
        ? window.scrollY + dossierHeadEl.getBoundingClientRect().top - viewportTop
        : bottomTarget;
      const target = Math.max(0, Math.min(bottomTarget, headTarget));
      document.documentElement.classList.add("mobile-game-scroll-driving");
      if (shouldAlignNewest) {
        rowsEl.scrollTop = 0;
        /* 提交猜测后外层页面尽量保持在顶部（仅移动端，桌面端由 focusNewRecord 走 scrollIntoView）：
           顶栏、元信息与指令条不被滚出视口，最新档案仍出现在档案列表顶部。
           紧凑视口（软键盘/小窗）下档案卡已无法完整落在固定控制台之上，仍按底部/档案头对齐下滚。 */
        const compact = document.body.classList.contains("mobile-compact-viewport");
        window.scrollTo({ top: compact ? Math.max(0, target) : 0, left: 0, behavior: "auto" });
      } else {
        layout.scrollIntoView({ behavior: "auto", block: "end", inline: "nearest" });
        window.scrollTo({ top: Math.max(0, target), left: 0, behavior: "auto" });
      }
      window.requestAnimationFrame(() => {
        document.documentElement.classList.remove("mobile-game-scroll-driving");
        if (shouldAlignNewest) positionMobileNewRecordAnchor(newestCard);
      });
    });
  });
}

function activateMobileRecordLayout() {
  document.body.classList.add("mobile-record-active");
  if (!isMobileLayout()) return;
  syncMobileGuessDock();
  syncMobileGameViewportHeight();
  alignMobileGameViewport();
  if (mobileGameViewportTimer != null) window.clearTimeout(mobileGameViewportTimer);
  mobileGameViewportTimer = window.setTimeout(() => {
    mobileGameViewportTimer = null;
    alignMobileGameViewport();
  }, 260);
}

function handleMobileGameViewportResize() {
  if (!isMobileLayout()) {
    clearMobileGameViewport();
    return;
  }
  syncMobileGameViewportHeight();
  /* 只同步视口高度变量与固定控制台/档案锚点位置，不重置滚动：
     URL 栏收放等 resize 期间用户可能正在下滑查看旧档案，
     重新对齐会把外层 scrollY 与内层 scrollTop 拽回顶部（跳顶）。 */
  syncMobileGuessDock();
}

function settleMobileKeyboard() {
  if (!isMobileLayout()) return Promise.resolve();
  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLElement && gameScreen.contains(activeElement)) activeElement.blur();
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
      if ((elapsed >= 180 && stableChecks >= 2) || elapsed >= 380) {
        syncMobileGameViewportHeight();
        syncMobileGuessDock();
        alignMobileGameViewport();
        resolve();
        return;
      }
      window.setTimeout(check, 50);
    };
    window.setTimeout(check, 50);
  });
}

async function startGame(mode, requestedMax, options = {}) {
  const startSequence = ++gameStartSequence;
  const firstEntry = gameScreen.classList.contains("hidden");
  if (mode === "sudden" && !options.preserveDirectiveHistory) clearDirectiveHistory();
  currentMode = mode;
  currentGameVersion = 1;
  if (mode === "sudden") syncSuddenControls(requestedMax == null ? suddenMax : requestedMax);
  token = null;
  attempts = 0;
  lastRemaining = null;
  finished = false;
  if (endlessEasterEggs) endlessEasterEggs.resetStreak();
  lastEndlessInputTriggerKey = "";
  hideEndlessBubble();
  setInputEnabled(false);
  applySuddenAttempts.disabled = mode !== "sudden";
  let transition = null;
  if (firstEntry) {
    setModeLaunching(mode, true);
    stageDirectiveIntro(mode === "sudden");
    resetRoundInterface(mode);
    document.body.dataset.mode = mode;
    updateHudTags(mode);
    transition = playWipe();
  } else {
    document.body.dataset.mode = mode;
    updateHudTags(mode);
    gameScreen.classList.add("round-buffering");
    stageRoundContentExit();
    transition = playWipe();
  }
  const params = new URLSearchParams({ mode });
  params.set("v", SUDDEN_VERSION);
  if (mode === "sudden") {
    params.set("attempts", suddenMax);
    const recentThemes = directiveHistory();
    if (recentThemes.length) params.set("themes", recentThemes.join(","));
  }
  const dataRequest = fetchJSON("/api/new?" + params.toString());
  await transition.covered;
  if (startSequence !== gameStartSequence) return;
  if (firstEntry) {
    showGameScreen();
  } else {
    stageDirectiveIntro(mode === "sudden");
    resetRoundInterface(mode);
  }
  stageRoundContentEntry();
  const data = await dataRequest;
  if (startSequence !== gameStartSequence) return;
  if (data.error) {
    if (transition) await transition.finished;
    setModeLaunching(mode, false);
    gameScreen.classList.remove("round-buffering");
    releaseDirectiveIntro();
    setStatus("出错了：" + data.error, true);
    playRoundContentEntry();
    return;
  }
  token = data.token;
  totalOperators = data.total || 0;
  updateSidebarModeCopy(mode);
  currentGameVersion = Number(data.version) === SUDDEN_VERSION ? SUDDEN_VERSION : 1;
  if (data.maxAttempts) syncSuddenControls(data.maxAttempts);
  updateEndlessBubble();
  hideEndlessBubble();
  updateAttemptLabel();
  if (isSuddenV3()) {
    rememberDirective(data.theme);
    updateDirectivePanel(data.theme);
  } else {
    releaseDirectiveIntro();
  }
  setStatus("谜底已就绪（共 " + data.total + " 名干员）");
  if (transition) await transition.finished;
  if (startSequence !== gameStartSequence) return;
  setModeLaunching(mode, false);
  playRoundContentEntry();
  if (isSuddenV3()) initDirective(data.theme, true);
  setInputEnabled(true);
  applySuddenAttempts.disabled = false;
  focusGuessEntry();
}

function isSuddenV3() {
  return currentMode === "sudden" && currentGameVersion === SUDDEN_VERSION;
}

function isComparisonV3() {
  return currentGameVersion === SUDDEN_VERSION;
}

function resetDirectiveState() {
  closeMobileDataSheet(false);
  directiveSnapshot = null;
  pendingClue = null;
  decodedIntel = [];
  clueDecoding = false;
  directiveCompletionPlayed = false;
  renderIntelRail();
  updateDirectivePanel(null);
}

function updateSidebarModeCopy(mode) {
  if (mode === "endless") {
    gameSidebarIndex.textContent = "/ 02";
    gameSidebarTitle.innerHTML = "不设终点，<br>持续逼近。";
    gameSidebarDesc.textContent = "每轮比对都会保留已知结果。没有次数压力，沿着确认特征把候选逐步压缩到唯一答案。";
    topbarContextEn.textContent = "ENDLESS ARCHIVE SEARCH";
    topbarSubtitle.textContent = "罗德岛人员档案 · 全域检索终端";
  } else if (mode === "sudden") {
    gameSidebarIndex.textContent = "/ 01";
    gameSidebarTitle.innerHTML = "有限校验，<br>终局定案。";
    gameSidebarDesc.textContent = "在有限回合内压缩候选；按战术指令完成校验必定解锁一条情报，次数耗尽后进入最终抉择。";
    topbarContextEn.textContent = "FINAL VERIFICATION PROTOCOL";
    topbarSubtitle.textContent = "罗德岛人员档案 · 终局校验终端";
  } else if (mode === "anomaly") {
    gameSidebarIndex.textContent = "/ 03";
    gameSidebarTitle.innerHTML = "四份档案，<br>一个异类。";
    gameSidebarDesc.textContent = "十题审查协议：高难综合审查初始提供两次共性扫描，每三连对奖励一次；单域审查会公开题库大类。";
    topbarContextEn.textContent = "RHINE LAB // ANOMALY AUDIT";
    topbarSubtitle.textContent = "莱茵生命生态科 · 异类审查终端";
  } else {
    topbarContextEn.textContent = "OPERATOR INTELLIGENCE NETWORK";
    topbarSubtitle.textContent = "罗德岛人员档案 · 干员身份识别终端";
  }
}

function updateHudTags(mode) {
  updateSidebarModeCopy(mode);
  if (mode === "endless") {
    hudTagL.textContent = "P.R.T.S. // RHODES ISLAND ARCHIVE";
    hudTagR.textContent = "R.I. — ENDLESS ARCHIVE SEARCH";
  } else if (mode === "sudden") {
    hudTagL.textContent = "PARADISE FULCRUM // FINAL VERIFICATION";
    hudTagR.textContent = "P.F.S. — LIMITED AUDIT PROTOCOL";
  } else if (mode === "anomaly") {
    hudTagL.textContent = "RHINE LAB // ANOMALY AUDIT";
    hudTagR.textContent = "M.L.S.S. — AUDIT GUIDE ONLINE";
  } else {
    /* 模式选择页：使用中性标识，不显示任一模式的名称 */
    hudTagL.textContent = "OPERATOR TRACE // IDENTIFICATION PROTOCOL";
    hudTagR.textContent = "P.R.T.S. — OPERATOR TRACE SYSTEM";
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

function setEndlessBubbleMediaSource(element, source) {
  if (!element) return;
  if (element.getAttribute("src") === source) {
    element.removeAttribute("src");
    void element.offsetWidth;
  }
  element.src = source;
}

function setEndlessBubblePresentation(presentation) {
  const mediaSource = presentation && presentation.type === "media" ? presentation.value : "";
  const specialText = presentation && presentation.type === "text";
  document.body.classList.toggle("endless-bubble-media-active", Boolean(mediaSource));
  [endlessBubble, mobileEndlessBubble].forEach((element) => {
    if (element) element.classList.toggle("is-media", Boolean(mediaSource));
    if (element) element.classList.toggle("is-special-text", Boolean(specialText));
  });
  if (mediaSource) {
    setEndlessBubbleMediaSource(endlessBubbleMedia, mediaSource);
    setEndlessBubbleMediaSource(mobileEndlessBubbleMedia, mediaSource);
  } else {
    if (endlessBubbleMedia) endlessBubbleMedia.removeAttribute("src");
    if (mobileEndlessBubbleMedia && mobileEndlessBubbleMedia.getAttribute("src") !== DEFAULT_ENDLESS_BUBBLE_MEDIA) {
      mobileEndlessBubbleMedia.src = DEFAULT_ENDLESS_BUBBLE_MEDIA;
    }
  }
  if (presentation && presentation.type === "text") {
    [endlessBubbleText, mobileEndlessBubbleText].forEach((element) => {
      if (element) element.textContent = presentation.value;
    });
  }
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

function showEndlessBubble(won, presentation = null, options = {}) {
  setEndlessBubblePresentation(presentation);
  [endlessBubble, mobileEndlessBubble].forEach((element) => {
    if (element) element.classList.toggle("input-triggered", Boolean(options.inputTriggered));
  });
  if (presentation) {
    const progress = totalOperators ? Math.min(1, attempts / totalOperators) : 0;
    [endlessProgress, mobileEndlessProgress].forEach((element) => {
      if (element) element.style.transform = "scaleX(" + progress + ")";
    });
  } else if (won) {
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
    if (endlessBubble) endlessBubble.classList.remove("show", "input-triggered");
    document.body.classList.remove("endless-bubble-media-active");
    bubbleTimer = null;
  }, 4000);
  clearMobileBubbleTimers();
  if (mobileEndlessBubble) mobileEndlessBubble.classList.remove("show");
  if (isMobileLayout() && mobileEndlessBubble) {
    mobileBubbleDelayTimer = window.setTimeout(() => {
      replayBubble(mobileEndlessBubble);
      mobileBubbleDelayTimer = null;
      mobileBubbleHideTimer = window.setTimeout(() => {
        mobileEndlessBubble.classList.remove("show", "input-triggered");
        mobileBubbleHideTimer = null;
      }, 4000);
    }, 620);
  }
}

function hideEndlessBubble() {
  [endlessBubble, mobileEndlessBubble].forEach((element) => {
    if (element) element.classList.remove("show", "input-triggered");
  });
  setEndlessBubblePresentation(null);
  if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null; }
  clearMobileBubbleTimers();
}

function handleEndlessInputEasterEgg(value) {
  if (currentMode !== "endless" || !endlessEasterEggs) {
    lastEndlessInputTriggerKey = "";
    return;
  }
  const presentation = EndlessEasterEggs.classifyInput(value);
  if (!presentation) {
    lastEndlessInputTriggerKey = "";
    return;
  }
  const triggerKey = presentation.type + ":" + presentation.value;
  if (triggerKey === lastEndlessInputTriggerKey) return;
  lastEndlessInputTriggerKey = triggerKey;
  showEndlessBubble(false, presentation, { inputTriggered: true });
}

let lastRemaining = null;

function setInputEnabled(on) {
  input.disabled = !on;
  btn.disabled = !on;
  quickInput.disabled = !on;
  quickBtn.disabled = !on;
  revealBtn.disabled = !on;
  if (!on) {
    hideSuggest();
    hideQuickSuggest();
  }
}

/* ---------- 拼音、绰号与身份名搜索 ---------- */

function searchNames(query) {
  return operatorSearchEngine ? operatorSearchEngine.search(query, 8) : [];
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
  const displayItems = results.map((r, idx) => ({ r, idx }));
  if (isMobileLayout()) displayItems.reverse();
  displayItems.forEach(({ r, idx }) => {
    const d = document.createElement("div");
    d.className = "suggest-item" + (idx === activeIndex ? " active" : "");
    d.dataset.resultIndex = String(idx);
    const name = document.createElement("span");
    name.textContent = r.op.n;
    const py = document.createElement("span");
    py.className = "py";
    py.textContent = r.op.p;
    d.appendChild(name);
    d.appendChild(py);
    d.addEventListener("mousedown", (e) => { e.preventDefault(); chooseSuggestion(idx); });
    d.addEventListener("mouseenter", () => { setActive(idx); });
    suggestEl.appendChild(d);
  });
  suggestEl.classList.remove("hidden");
  if (isMobileLayout()) suggestEl.scrollTop = suggestEl.scrollHeight;
}

function setActive(idx) {
  activeIndex = idx;
  const items = suggestEl.querySelectorAll(".suggest-item");
  items.forEach((el) => el.classList.toggle("active", Number(el.dataset.resultIndex) === idx));
}

function chooseSuggestion(idx) {
  if (idx < 0 || idx >= suggestItems.length) return;
  input.value = suggestItems[idx].op.n;
  quickInput.value = input.value;
  hideSuggest();
}

function hideSuggest() {
  suggestEl.classList.add("hidden");
  suggestItems = [];
  activeIndex = -1;
}

function renderQuickSuggest(results) {
  quickSuggestEl.innerHTML = "";
  quickSuggestItems = results;
  quickActiveIndex = results.length ? 0 : -1;
  if (!results.length) {
    const empty = document.createElement("div");
    empty.className = "suggest-empty";
    empty.textContent = "没有匹配的干员";
    quickSuggestEl.appendChild(empty);
    quickSuggestEl.classList.remove("hidden");
    return;
  }
  results.forEach((result, index) => {
    const item = document.createElement("div");
    item.className = "suggest-item" + (index === quickActiveIndex ? " active" : "");
    const name = document.createElement("span");
    name.textContent = result.op.n;
    const py = document.createElement("span");
    py.className = "py";
    py.textContent = result.op.p;
    item.appendChild(name);
    item.appendChild(py);
    item.addEventListener("mousedown", (event) => {
      event.preventDefault();
      chooseQuickSuggestion(index);
    });
    item.addEventListener("mouseenter", () => setQuickActive(index));
    quickSuggestEl.appendChild(item);
  });
  quickSuggestEl.classList.remove("hidden");
}

function setQuickActive(index) {
  quickActiveIndex = index;
  quickSuggestEl.querySelectorAll(".suggest-item").forEach((item, itemIndex) => {
    item.classList.toggle("active", itemIndex === index);
  });
}

function chooseQuickSuggestion(index) {
  if (index < 0 || index >= quickSuggestItems.length) return;
  quickInput.value = quickSuggestItems[index].op.n;
  input.value = quickInput.value;
  hideQuickSuggest();
}

function hideQuickSuggest() {
  quickSuggestEl.classList.add("hidden");
  quickSuggestItems = [];
  quickActiveIndex = -1;
}

function isOriginalGuessVisible() {
  if (!gameWorkspace || !guessConsole) return true;
  const workspaceRect = gameWorkspace.getBoundingClientRect();
  const consoleRect = guessConsole.getBoundingClientRect();
  const visibleHeight = Math.max(0, Math.min(consoleRect.bottom, workspaceRect.bottom) - Math.max(consoleRect.top, workspaceRect.top));
  return visibleHeight >= Math.min(consoleRect.height * .45, 54);
}

function syncQuickGuessVisibility() {
  quickVisibilityFrame = null;
  const canUseQuick = !isMobileLayout() && gameScreen.classList.contains("has-guesses") && !gameScreen.classList.contains("is-finished");
  const shouldUseQuick = canUseQuick && !isOriginalGuessVisible();
  const wasUsingQuick = document.body.classList.contains("quick-guess-active");
  if (shouldUseQuick === wasUsingQuick) return;

  document.body.classList.toggle("quick-guess-active", shouldUseQuick);
  if (shouldUseQuick) {
    quickInput.value = input.value;
    if (document.activeElement === input) quickInput.focus({ preventScroll: true });
  } else {
    input.value = quickInput.value;
    hideQuickSuggest();
    if (!isMobileLayout() && document.activeElement === quickInput) input.focus({ preventScroll: true });
  }
}

function requestQuickGuessVisibilitySync() {
  if (quickVisibilityFrame != null) return;
  quickVisibilityFrame = requestAnimationFrame(syncQuickGuessVisibility);
}

function focusGuessEntry() {
  if (isMobileLayout()) return;
  const useQuick = gameScreen.classList.contains("has-guesses") && !gameScreen.classList.contains("is-finished") && !isOriginalGuessVisible();
  document.body.classList.toggle("quick-guess-active", useQuick);
  const target = useQuick ? quickInput : input;
  target.focus({ preventScroll: true });
}

async function submitQuickGuess() {
  if (finished || quickInput.disabled) return;
  const raw = quickInput.value.trim();
  if (!raw) return;
  if (!validNames.has(raw)) {
    if (!quickSuggestItems.length) {
      setStatus("“" + raw + "”不在可猜干员名单中，请从下拉提示中选择。", true);
      return;
    }
    chooseQuickSuggestion(quickActiveIndex >= 0 ? quickActiveIndex : 0);
  }
  input.value = quickInput.value;
  await submitGuess();
  quickInput.value = input.value;
  if (!finished && !quickInput.disabled) focusGuessEntry();
}

/* ---------- 猜测 ---------- */

const SUDDEN_ERROR_TEXT = {
  duplicate_guess: "该干员本局已经提交过，请选择其他干员。",
  attempts_exhausted: "本局猜测次数已用尽，进入终局校验。",
  invalid_phase: "当前状态无法执行该操作。",
  unknown_operator: "未找到该干员，请从下拉提示中选择。",
  invalid_clue: "该情报无效或已被使用。",
  clue_unavailable: "情报暂时不可用，请稍后重试。",
  bad_request: "请求格式有误，请重试。",
};

function suddenErrorText(code) {
  return SUDDEN_ERROR_TEXT[code] || ("出错了：" + code);
}

async function submitGuess() {
  if (finished || !token || clueDecoding) return;
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
      setStatus(isComparisonV3() ? suddenErrorText(data.error) : ("出错了：" + data.error), true);
      setInputEnabled(true);
      return;
    }
    attempts += 1;
    const endlessGuessPresentation = currentMode === "endless" && endlessEasterEggs
      ? endlessEasterEggs.recordGuess(guessName)
      : null;
    updateAttemptConfigState();
    token = data.token;
    lastRemaining = data.remaining;
    await mobileViewportReady;
    if (isComparisonV3() && Number(data.version) === SUDDEN_VERSION) {
      if (currentMode === "endless") {
        input.value = "";
        if (data.win) {
          renderComparisonFinalRecord(data);
          showEndlessBubble(true, endlessGuessPresentation);
          finishGame(true, "猜中了！答案是 " + data.answerName + "，共用 " + attempts + " 次");
          return;
        }
        renderSuddenV3Row(data);
        showEndlessBubble(false, endlessGuessPresentation);
        updateAttemptLabel();
        setStatus("已猜 " + attempts + " 次");
        setInputEnabled(true);
        focusGuessEntry();
        return;
      }
      const open = await handleSuddenV3Guess(data);
      input.value = "";
      if (open) {
        setStatus("已猜 " + attempts + " 次");
        setInputEnabled(true);
        focusGuessEntry();
      }
      return;
    }
    renderRow(data);
    if (data.win) {
      input.value = "";
      if (currentMode === "endless") showEndlessBubble(true, endlessGuessPresentation);
      finishGame(true, "猜中了！答案是 " + data.answerName + "，共用 " + attempts + " 次");
      return;
    }
    if (currentMode === "endless") showEndlessBubble(false, endlessGuessPresentation);
    updateAttemptLabel();
    if (data.remaining === 0) {
      input.value = "";
      await showChoiceModal();
      return;
    }
    input.value = "";
    setStatus("已猜 " + attempts + " 次");
    setInputEnabled(true);
  } catch (e) {
    setStatus("网络错误，请重试。", true);
    setInputEnabled(true);
  }
  focusGuessEntry();
}

/* 返回 true 表示仍在常规猜测阶段（恢复输入）；false 表示已获胜或进入终局 */
async function handleSuddenV3Guess(data) {
  const themeResult = data.themeResult || null;
  const clue = Array.isArray(data.pendingClues) && data.pendingClues.length ? data.pendingClues[0] : null;
  if (clue) pendingClue = clue;
  updateDirectivePanel(data.theme, themeResult, { deferCompletionFlash: true });
  updateAttemptLabel();
  if (data.win) {
    if (data.archive) renderComparisonFinalRecord(data);
    else renderSuddenV3Row(data);
    finishGame(true, "终局校验通过！答案是 " + data.answerName + "，共用 " + attempts + " 次");
    return false;
  }
  const renderedRecord = renderSuddenV3Row(data);
  if (themeResult && themeResult.newlyCompleted) {
    /* 指令校验完成动效与情报解锁都等档案卡片完全加载完再开始（移动端）：
       先等新卡立绘解码 + 入场动画落定，再播指令完成动效、再读情报。 */
    if (isMobileLayout() && renderedRecord) {
      await waitForRecordReady(renderedRecord.card, renderedRecord.image);
    }
    playDirectiveCompletion();
    if (clue) {
      setStatus("战术指令条件达成，正在确认情报权限……");
      await waitForDirectiveConfirmation();
      setStatus("情报权限已开放，正在读取情报……");
      await requestClueReveal();
    }
  }
  if (data.remaining === 0) {
    await continueToFinalChoices(data);
    return false;
  }
  return true;
}

/* 最后一猜：若此前自动读取失败，则再尝试一次后进入四选一 */
async function continueToFinalChoices() {
  if (pendingClue) {
    setStatus("常规核验结束，正在读取战术指令情报……");
    await requestClueReveal();
  }
  await showChoiceModal();
}

function waitForFinalFocusSettle(finalCard, reducedMotion) {
  if (!finalCard) return Promise.resolve();
  return new Promise((resolve) => {
    const started = performance.now();
    const minimumSettleTime = reducedMotion ? 0 : 700;
    const requiredStableFrames = reducedMotion ? 2 : 10;
    let stableFrames = 0;
    let previous = null;
    const check = () => {
      if (!finalCard.isConnected || !gameScreen.classList.contains("is-finished")) {
        resolve();
        return;
      }
      const current = [
        window.scrollX,
        window.scrollY,
        rowsEl.scrollTop,
        finalCard.getBoundingClientRect().top,
      ];
      const stable = previous && current.every((value, index) => Math.abs(value - previous[index]) < 0.5);
      stableFrames = stable ? stableFrames + 1 : 0;
      previous = current;
      const elapsed = performance.now() - started;
      if ((stableFrames >= requiredStableFrames && elapsed >= minimumSettleTime) || elapsed >= 2000) {
        resolve();
        return;
      }
      window.requestAnimationFrame(check);
    };
    window.requestAnimationFrame(check);
  });
}

async function focusFinalRecordAndReveal(finalCard, reducedMotion) {
  const pending = pendingVisualIntelReveal;
  if (pending && pending.finalRecord === finalCard) await pending.finalReady;
  if (!finalCard.isConnected || !gameScreen.classList.contains("is-finished")) return;
  const mobile = isMobileLayout();
  /* 移动端按整张卡片的下沿对齐，确保立绘下方的卡片边框也完整露出。 */
  finalCard.scrollIntoView({
    behavior: reducedMotion ? "auto" : "smooth",
    block: mobile ? "end" : "start",
  });
  await waitForFinalFocusSettle(finalCard, reducedMotion);
  if (!finalCard.isConnected || !gameScreen.classList.contains("is-finished")) return;
  if (!pending || pending !== pendingVisualIntelReveal || pending.finalRecord !== finalCard) return;
  pendingVisualIntelReveal = null;
  revealVisualIntel(pending.operator, pending.answerName, pending.finalRecord);
}

function finishGame(won, text) {
  finished = true;
  gameScreen.classList.add("is-finished");
  clearMobileGuessDock();
  document.body.classList.add("mobile-game-finished");
  document.body.classList.remove("quick-guess-active");
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
        finalFocusTimer = null;
        focusFinalRecordAndReveal(finalCard, reduced);
      // Let the final dossier finish its entrance before moving focus, while
      // keeping the compact mobile result prompt from lingering too long.
      }, reduced ? 80 : 900);
    } else {
      victoryEl.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
      finalFocusTimer = window.setTimeout(() => {
        const finalCard = rowsEl.querySelector(".is-final-record");
        if (!finalCard || !gameScreen.classList.contains("is-finished")) return;
        finalFocusTimer = null;
        focusFinalRecordAndReveal(finalCard, reduced);
      }, reduced ? 80 : 1050);
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
      const usesSilhouette = data.choicePresentation === "silhouette" && Boolean(operator.choiceImageUrl);
      if (usesSilhouette) art.classList.add("choice-silhouette");
      image.src = usesSilhouette ? operator.choiceImageUrl : artUrl(operator.id, false);
      image.alt = operator.name + (usesSilhouette ? " 剪影" : " 精英一阶段立绘");
      image.loading = "lazy";
      image.addEventListener("error", () => art.classList.add("image-missing"));
      art.appendChild(image);
      art.title = "点击选择 " + operator.name;
      const preview = document.createElement("span");
      preview.className = "choice-preview-trigger";
      preview.textContent = usesSilhouette ? "查看剪影 +" : "查看立绘 +";
      preview.title = "查看 " + operator.name + (usesSilhouette ? " 的剪影大图" : " 的立绘大图");
      preview.setAttribute("role", "button");
      preview.setAttribute("tabindex", "0");
      preview.setAttribute("aria-label", "查看 " + operator.name + (usesSilhouette ? " 的剪影大图" : " 的立绘大图"));
      const openPreview = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!art.classList.contains("image-missing")) {
          openArtPreview(
            image,
            operator.name,
            usesSilhouette ? "候选干员剪影" : "精英一阶段立绘",
            preview,
            usesSilhouette ? "silhouette" : null
          );
        }
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
      info.appendChild(name);
      b.appendChild(art);
      b.appendChild(info);
      b.addEventListener("click", () => onPick(operator.name, b));
      choiceList.appendChild(b);
    });
    choiceModal.querySelectorAll(".modal-note").forEach((n) => n.remove());
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
    if (isSuddenV3() && Number(data.version) === SUDDEN_VERSION) {
      if (!data.win && data.pickRecord) {
        setStatus("终局抉择未通过，正在读取谜底终局档案……");
        renderWrongChoiceRecord(data.pickRecord);
      }
      renderComparisonFinalRecord(data);
    } else if (data.dims) {
      renderRow({ guessName: data.answerName, dims: data.dims, operator: data.operator, archive: data.archive, final: true });
    }
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

/* ---------- sudden 终局校验 V3：12 维比对卡（渲染助手沿用 V2 命名） ---------- */

/* 统一的 12 格展示顺序：作战维 → 档案维 → 势力/范围 → 费用/轮换情报 */
const V2_DIM_ORDER = [
  "profession", "subProfession", "rarity", "position",
  "tags", "gender", "origin", "race",
  "power", "deploymentTemplate", "deploymentCost", "rotatingIntel",
];

const V2_DIM_LABELS = {
  profession: "职业",
  subProfession: "分支",
  rarity: "星级",
  position: "部署位",
  tags: "标签",
  gender: "性别",
  origin: "出身地",
  race: "种族",
  power: "势力",
  deploymentTemplate: "技能范围",
  deploymentCost: "标准费用",
};

const V2_ROTATING_HINTS = {
  birthday: { high: "谜底生日更晚", low: "谜底生日更早", close: "谜底生日在 2 个月内" },
  height: { high: "谜底身高更矮", low: "谜底身高更高", close: "与谜底相差 15cm 以内" },
  exp: { high: "谜底战斗经验更少", low: "谜底战斗经验更多", close: "" },
  infected: { high: "", low: "", close: "" },
};

const V2_MECHANIC_TEXT = {
  activation: { manual: "手动触发", auto: "自动触发", passive: "被动技能", unknown: "未知" },
  spRecovery: { time: "自动回复", attack: "攻击回复", damaged: "受击回复", none: "无技力", unknown: "未知" },
};

function isReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/* V2 状态 → 视觉颜色：related/close 走“接近”黄，higher/lower 走“不符”红 */
function v2VisualState(state, close) {
  if (state === "exact") return "exact";
  if (state === "related" || close) return "tip";
  if (state === "unknown") return "unknown";
  return "wrong";
}

function v2StateLabel(visual) {
  if (visual === "exact") return "吻合";
  if (visual === "tip") return "接近";
  if (visual === "unknown") return "未知";
  return "不符";
}

/* V2 方向：higher→↓(谜底更低) lower→↑(谜底更高) before→→(谜底更晚) after→←(谜底更早) */
function v2DirectionMark(state) {
  if (state === "higher") return "↓";
  if (state === "lower") return "↑";
  if (state === "before") return "→";
  if (state === "after") return "←";
  return "";
}

function v2HintTitle(what, state) {
  if (state === "higher") return "谜底" + what + "更低/更少";
  if (state === "lower") return "谜底" + what + "更高/更多";
  if (state === "before") return "谜底生日更晚";
  if (state === "after") return "谜底生日更早";
  return "";
}

function v2DimValueText(dim) {
  if (dim == null) return "?";
  if (dim.guessText != null && dim.guessText !== "") return dim.guessText;
  if (dim.guessValue != null) return String(dim.guessValue);
  if (typeof dim.guess === "boolean") return dim.guess ? "是" : "否";
  return "?";
}

function createV2Clue(label, state, options) {
  const config = options || {};
  const visual = v2VisualState(state, config.close);
  const clue = document.createElement("div");
  clue.className = "clue cell-" + visual
    + (config.special ? " cell-special" : "")
    + (config.className ? " " + config.className : "");
  if (config.title) clue.title = config.title;

  const labelEl = document.createElement("span");
  labelEl.className = "clue-label";
  labelEl.textContent = label;
  const stateEl = document.createElement("i");
  stateEl.className = "clue-state";
  stateEl.textContent = v2StateLabel(visual);
  labelEl.appendChild(stateEl);

  const valueEl = document.createElement("strong");
  valueEl.className = "clue-value";
  valueEl.textContent = config.valueText != null ? config.valueText : "?";
  const mark = v2DirectionMark(state);
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
  if (config.hint && visual !== "exact") {
    const hintEl = document.createElement("span");
    hintEl.className = "clue-hint";
    hintEl.textContent = config.hint;
    clue.appendChild(hintEl);
  }
  return { clue, visual };
}

function renderV2TagDimension(tags) {
  const safe = tags || { state: "unknown", guess: [], shared: [] };
  const visual = v2VisualState(safe.state, false);
  const clue = document.createElement("div");
  clue.className = "clue clue-tags cell-" + visual;

  const labelEl = document.createElement("span");
  labelEl.className = "clue-label";
  labelEl.textContent = "标签 TAG";
  const stateEl = document.createElement("i");
  stateEl.className = "clue-state";
  stateEl.textContent = v2StateLabel(visual);
  labelEl.appendChild(stateEl);

  const pills = document.createElement("div");
  pills.className = "tag-pills";
  const sharedSet = new Set(safe.shared || []);
  (safe.guess || []).forEach((tag) => {
    const pill = document.createElement("span");
    pill.className = "tag" + (sharedSet.has(tag) ? " shared" : "");
    pill.textContent = tag;
    pills.appendChild(pill);
  });

  clue.appendChild(labelEl);
  clue.appendChild(pills);
  if (sharedSet.size) {
    const hint = document.createElement("span");
    hint.className = "clue-hint";
    hint.textContent = "共同标签：" + (safe.shared || []).join("、");
    clue.appendChild(hint);
  }
  return { clue, visual };
}

function renderPowerDimension(power) {
  const safe = power || { state: "unknown", guess: {} };
  const guess = safe.guess || {};
  const visual = v2VisualState(safe.state, false);
  const clue = document.createElement("div");
  clue.className = "clue power-clue cell-" + visual;
  /* 分层级提示：related（黄）= 顶层势力相同、具体所属不同；wrong（红）= 顶层已不同 */
  const topName = guess.parentName || guess.name || "未知";
  const levelHint = safe.state === "related"
    ? "同属顶层势力「" + topName + "」· 具体所属势力不同"
    : safe.state === "exact" ? "顶层势力与所属势力均吻合"
    : safe.state === "unknown" ? "势力情报未知"
    : "顶层势力即不同 · 所属势力也不同";
  clue.title = levelHint;

  const labelEl = document.createElement("span");
  labelEl.className = "clue-label";
  labelEl.textContent = "势力 FACTION";
  const stateEl = document.createElement("i");
  stateEl.className = "clue-state";
  stateEl.textContent = v2StateLabel(visual);
  labelEl.appendChild(stateEl);

  const valueEl = document.createElement("strong");
  valueEl.className = "clue-value";
  const logo = document.createElement("span");
  logo.className = "power-logo";
  if (guess.logoUrl) {
    const img = document.createElement("img");
    img.src = guess.logoUrl;
    img.alt = "";
    img.loading = "lazy";
    img.addEventListener("error", () => logo.classList.add("logo-missing"));
    logo.appendChild(img);
  } else {
    logo.classList.add("logo-missing");
  }
  const idBox = document.createElement("span");
  idBox.className = "power-id";
  const nameEl = document.createElement("span");
  nameEl.className = "power-name";
  nameEl.textContent = guess.name || "未知";
  idBox.appendChild(nameEl);
  if (guess.parentName) {
    const parentEl = document.createElement("span");
    parentEl.className = "power-parent";
    const parentText = document.createElement("i");
    parentText.textContent = "上级 · " + guess.parentName;
    parentEl.appendChild(parentText);
    idBox.appendChild(parentEl);
  }
  valueEl.appendChild(logo);
  valueEl.appendChild(idBox);
  clue.appendChild(labelEl);
  clue.appendChild(valueEl);
  if (safe.state !== "exact") {
    const levelEl = document.createElement("span");
    levelEl.className = "clue-hint";
    levelEl.textContent = levelHint;
    clue.appendChild(levelEl);
  }
  return { clue, visual };
}

function buildRangeGrid(cells) {
  const safeCells = Array.isArray(cells) ? cells : [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  safeCells.forEach((c) => {
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.y > maxY) maxY = c.y;
  });
  if (!safeCells.length) { minX = maxX = minY = maxY = 0; }
  /* 保证原点在网格内且朝向统一（攻击方向向右 = x 递增） */
  minX = Math.min(minX, 0); maxX = Math.max(maxX, 0);
  minY = Math.min(minY, 0); maxY = Math.max(maxY, 0);
  const cols = maxX - minX + 1;
  const rows = maxY - minY + 1;
  const grid = document.createElement("div");
  grid.className = "range-grid";
  grid.style.gridTemplateColumns = "repeat(" + cols + ", auto)";
  const byCoord = new Map();
  safeCells.forEach((c) => byCoord.set(c.x + "," + c.y, c.state));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const cell = document.createElement("span");
      const state = byCoord.get(x + "," + y);
      cell.className = "rcell" + (state ? " rcell-" + state : "");
      grid.appendChild(cell);
    }
  }
  return { grid, cols, rows };
}

function skillMechanicSummary(mechanic) {
  if (!mechanic) return "";
  const parts = [
    V2_MECHANIC_TEXT.activation[mechanic.activation] || "触发未知",
    V2_MECHANIC_TEXT.spRecovery[mechanic.spRecovery] || "技力未知",
  ];
  if (mechanic.chargeable) parts.push("可充能×" + (mechanic.maxChargeTime || 1));
  if (mechanic.ammo) parts.push("弹药");
  return parts.join(" · ");
}

function renderRangeOverlap(template) {
  const safe = template || { state: "unknown", cells: [], overlapCount: 0, guessCellCount: 0 };
  const visual = v2VisualState(safe.state, false);
  const clue = document.createElement("div");
  clue.className = "clue range-clue cell-" + visual;
  clue.title = "逐技能范围交集：每个技能与谜底的同槽位技能一一比较（S1–S3 对应）";

  const labelEl = document.createElement("span");
  labelEl.className = "clue-label";
  labelEl.textContent = "技能范围 RANGE";
  const stateEl = document.createElement("i");
  stateEl.className = "clue-state";
  stateEl.textContent = v2StateLabel(visual);
  labelEl.appendChild(stateEl);

  const valueEl = document.createElement("strong");
  valueEl.className = "clue-value";
  const wrap = document.createElement("span");
  wrap.className = "range-wrap";
  const slots = Array.isArray(safe.slots) && safe.slots.length
    ? safe.slots
    : [{
      slot: "BASE",
      state: safe.state,
      cells: safe.cells || [],
      overlapCount: safe.overlapCount || 0,
      guessCellCount: safe.guessCellCount || 0,
      inherited: true,
    }];
  const list = document.createElement("span");
  list.className = "skill-range-list";
  const mobileSummary = document.createElement("span");
  mobileSummary.className = "mobile-range-summary";
  const slotLabel = slots.map((slot) => slot.slot || "技能").join(" / ");
  slots.forEach((slot) => {
    const slotVisual = v2VisualState(slot.state, false);
    const item = document.createElement("span");
    item.className = "skill-range-item slot-" + slotVisual;
    const head = document.createElement("span");
    head.className = "skill-range-head";
    head.title = slot.inherited ? "该技能沿用基础攻击范围" : "该技能使用独立攻击范围";
    const slotName = document.createElement("b");
    slotName.textContent = slot.slot || "技能";
    const slotState = document.createElement("i");
    slotState.textContent = v2StateLabel(slotVisual);
    head.appendChild(slotName);
    head.appendChild(slotState);
    const built = buildRangeGrid(slot.cells || []);
    built.grid.classList.add("skill-range-grid");
    const count = document.createElement("span");
    count.className = "skill-range-count";
    count.textContent = (slot.overlapCount || 0) + "/" + (slot.guessCellCount || 0);
    count.title = "与谜底同槽位技能的重叠格数";
    item.appendChild(head);
    item.appendChild(built.grid);
    item.appendChild(count);
    if (directiveSnapshot && directiveSnapshot.family === "skill") {
      const mechanicText = skillMechanicSummary(slot.mechanic);
      if (mechanicText) {
        const mechanic = document.createElement("span");
        mechanic.className = "skill-range-mechanic";
        mechanic.textContent = mechanicText;
        mechanic.title = mechanicText;
        item.appendChild(mechanic);
      }
    }
    list.appendChild(item);
    const summaryItem = document.createElement("span");
    summaryItem.textContent = (slot.slot || "技能") + " " + (slot.overlapCount || 0) + "/" + (slot.guessCellCount || 0);
    mobileSummary.appendChild(summaryItem);
  });
  wrap.appendChild(list);
  if (safe.state === "unknown") {
    const sub = document.createElement("span");
    sub.className = "range-sub";
    sub.textContent = "技能范围资料不足";
    wrap.appendChild(sub);
  }
  valueEl.appendChild(wrap);
  clue.appendChild(labelEl);
  clue.appendChild(valueEl);
  clue.appendChild(mobileSummary);
  const mobileOpen = document.createElement("button");
  mobileOpen.type = "button";
  mobileOpen.className = "mobile-range-open";
  mobileOpen.textContent = "展开完整范围";
  mobileOpen.setAttribute("aria-label", "展开全部技能范围详情");
  mobileOpen.addEventListener("click", (event) => {
    event.stopPropagation();
    const detail = wrap.cloneNode(true);
    detail.classList.add("mobile-range-detail");
    openMobileDataSheet("技能范围 · " + slotLabel, "range", detail, mobileOpen);
  });
  clue.appendChild(mobileOpen);
  return { clue, visual };
}

function renderRotatingIntel(rotating) {
  const safe = rotating || { key: "", label: "轮换情报", result: { state: "unknown" } };
  const result = safe.result || { state: "unknown" };
  const state = result.state || "unknown";
  const visual = v2VisualState(state, result.close);
  const hints = V2_ROTATING_HINTS[safe.key] || { high: "", low: "", close: "" };
  const clue = document.createElement("div");
  clue.className = "clue rotating-clue cell-" + visual + (result.special ? " cell-special" : "");
  const titleText = state === "exact"
    ? (safe.label + "吻合")
    : state === "unknown"
      ? "情报未知"
      : (result.close && hints.close ? hints.close : v2HintTitle(safe.label, state));
  clue.title = titleText;

  const tag = document.createElement("span");
  tag.className = "rotating-tag";
  tag.textContent = "ROTATING";

  const labelEl = document.createElement("span");
  labelEl.className = "clue-label";
  labelEl.textContent = safe.label || "轮换情报";
  const stateEl = document.createElement("i");
  stateEl.className = "clue-state";
  stateEl.textContent = v2StateLabel(visual);
  labelEl.appendChild(stateEl);

  const valueEl = document.createElement("strong");
  valueEl.className = "clue-value";
  valueEl.textContent = result.guessText != null && result.guessText !== "" ? result.guessText : "?";
  const mark = v2DirectionMark(state);
  if (mark) {
    const directionEl = document.createElement("b");
    directionEl.className = "clue-direction";
    directionEl.textContent = mark;
    valueEl.appendChild(directionEl);
  }

  const hintEl = document.createElement("span");
  hintEl.className = "clue-hint";
  hintEl.textContent = "本轮轮换情报 · " + titleText;

  clue.appendChild(tag);
  clue.appendChild(labelEl);
  clue.appendChild(valueEl);
  clue.appendChild(hintEl);
  return { clue, visual };
}

function waitForRecordImage(image) {
  if (!image) return Promise.resolve();
  const loaded = image.complete
    ? Promise.resolve()
    : new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        resolve();
      };
      const timeout = window.setTimeout(finish, 2200);
      image.addEventListener("load", finish, { once: true });
      image.addEventListener("error", finish, { once: true });
    });
  return loaded.then(() => {
    if (typeof image.decode !== "function" || !image.naturalWidth) return null;
    return Promise.race([
      image.decode().catch(() => null),
      new Promise((resolve) => window.setTimeout(resolve, 900)),
    ]);
  });
}

function prepareGuessCardHover(card, entering) {
  if (!card) return;
  const armHover = () => {
    if (!card.classList.contains("card-entering")) card.classList.add("hover-armed");
  };
  card.addEventListener("pointerenter", armHover);
  if (!entering) card.classList.add("hover-armed");
}

/* 等档案卡片加载完：入场动画结束（card-entering 移除）+ 立绘解码完成。
   用于情报解锁动效的前置等待，避免新卡还在进场/立绘未出就弹出情报层。 */
function waitForRecordReady(card, image) {
  const waits = [waitForRecordImage(image)];
  if (card && !isReducedMotion()) {
    waits.push(new Promise((resolve) => {
      const started = performance.now();
      const tick = () => {
        if (!card.isConnected || !card.classList.contains("card-entering") || performance.now() - started > 1800) resolve();
        else window.setTimeout(tick, 50);
      };
      tick();
    }));
  }
  return Promise.all(waits);
}

function finishGuessCardEntry(card) {
  if (!card || !card.isConnected) return;
  card.classList.remove("card-entering");
  if (card.classList.contains("mobile-new-record-anchor")) positionMobileNewRecordAnchor(card);
  if (!card.matches(":hover")) card.classList.add("hover-armed");
}

function positionMobileNewRecordAnchor(card) {
  if (
    !card
    || !card.isConnected
    || rowsEl.firstElementChild !== card
    || !shouldDockMobileGuessConsole()
  ) return;
  const dossierSection = dossierHead && dossierHead.parentElement;
  if (!dossierSection) return;
  rowsEl.classList.add("mobile-new-record-positioned");
  // Keep the card content-driven.  Shifting the whole dossier (including its
  // heading) avoids manufacturing a blank strip above the newest record.
  // Older records remain directly below it in the existing scroll container.
  // Refresh the dock synchronously so the anchor never targets a stale
  // console position (e.g. one measured while the soft keyboard was closing).
  applyMobileGuessDockPosition();
  // Measure with any previously applied shift neutralized.  The correction is
  // absolute rather than feedback-based, so repeated calls (entry animation,
  // image load, viewport timers) converge to the same value and never drift.
  const appliedShift = dossierSection.style.translate;
  if (appliedShift) dossierSection.style.translate = "0px 0px";
  /* shift 只允许 >= 0（向下贴合）；空间不足时保持档案区在自然槽位，由 .guess-list 内部滚动，避免负向平移盖住上方指令面板。 */
  /* 记录列表已溢出可滚动区域（多条记录/紧凑视口）时同样不得贴合：此时向下平移会把档案头推离视口顶部，在档案上方留出大片空白。 */
  const listOverflows = rowsEl.scrollHeight > rowsEl.clientHeight + 1;
  const nextShift = listOverflows ? 0 : Math.max(0, Math.round(guessConsole.getBoundingClientRect().top - card.getBoundingClientRect().bottom));
  const prevShift = Number.parseFloat(dossierSection.dataset.mobileRecordShift || "0") || 0;
  dossierSection.dataset.mobileRecordShift = String(nextShift);
  dossierSection.style.translate = "0 " + nextShift + "px";
  delete card.dataset.mobileRecordShift;
  card.style.removeProperty("translate");
  card.style.marginTop = "0px";
  /* 位移值未变化时不动滚动位置：320ms/1320ms/立绘加载后的延迟校正若重复重置 scrollTop，
     会把用户正在进行的列表滑动强行拽回顶部（真机与 e2e 中均表现为滑动偶发失效）。
     新档案入列时的回顶由 alignMobileNewRecordToGuessConsole 负责，这里不重复承担。 */
  if (nextShift !== prevShift) rowsEl.scrollTop = 0;
}

function alignMobileNewRecordToGuessConsole(card, image) {
  if (!card || !card.isConnected || !isMobileLayout()) return;
  rowsEl.querySelectorAll(":scope > .mobile-new-record-anchor").forEach((item) => {
    if (item === card) return;
    item.classList.remove("mobile-new-record-anchor");
    item.style.removeProperty("margin-top");
    item.style.removeProperty("translate");
    delete item.dataset.mobileRecordShift;
  });
  card.classList.add("mobile-new-record-anchor");
  card.style.marginTop = "0px";
  card.style.translate = "0 0";
  card.dataset.mobileRecordShift = "0";
  rowsEl.scrollTop = 0;
  alignMobileGameViewport();
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => positionMobileNewRecordAnchor(card)));
  window.setTimeout(() => positionMobileNewRecordAnchor(card), 320);
  window.setTimeout(() => positionMobileNewRecordAnchor(card), 1320);
  // 立绘慢加载可能晚于入场定时器；校正本身幂等，图片落定后再次对齐是安全的。
  if (image) waitForRecordImage(image).then(() => positionMobileNewRecordAnchor(card));
}

/* 提交猜测后：移动端让最新档案下沿贴住固定输入框；桌面端保持顶部聚焦。 */
function focusNewRecord(card, delay, image) {
  if (!card) return;
  if (isMobileLayout()) {
    alignMobileNewRecordToGuessConsole(card, image);
    return;
  }
  const reduced = isReducedMotion();
  const bringIntoView = () => requestAnimationFrame(() => {
    if (!card.isConnected) return;
    try {
      card.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    } catch (e) { /* noop */ }
  });
  const startFocus = () => {
    if (delay && !reduced) window.setTimeout(bringIntoView, delay);
    else bringIntoView();
  };
  if (image) waitForRecordImage(image).then(startFocus);
  else startFocus();
}

function syncGuessRecordCountState() {
  const cards = rowsEl.querySelectorAll(":scope > .guess-card");
  const singleRegularRecord = cards.length === 1 && !cards[0].classList.contains("is-final-record");
  const dossierSection = dossierHead && dossierHead.parentElement;
  gameScreen.classList.toggle("has-single-record", singleRegularRecord);
  if (!cards[0] || !cards[0].classList.contains("mobile-new-record-anchor")) {
    if (dossierSection) {
      dossierSection.style.removeProperty("translate");
      delete dossierSection.dataset.mobileRecordShift;
    }
    rowsEl.classList.remove("mobile-new-record-positioned");
    cards.forEach((card) => {
      card.classList.remove("mobile-new-record-anchor");
      card.style.removeProperty("margin-top");
      card.style.removeProperty("translate");
      delete card.dataset.mobileRecordShift;
    });
  }
  if (isMobileLayout()) alignMobileGameViewport();
}

/* 已有档案的下移与新卡 0.94 → 1 的缩放收尾共用同一时间轴，避免末段二次下抖。 */
function prependGuessCard(card, animateExisting) {
  const existingCards = Array.from(rowsEl.querySelectorAll(":scope > .guess-card"));
  const previousTops = new Map(existingCards.map((item) => [item, item.getBoundingClientRect().top]));
  rowsEl.prepend(card);
  syncGuessRecordCountState();
  /* 原有卡片的下滑让位动效与 web 端一致：移动端同样执行 FLIP 位移（delay 仅桌面端用于聚焦，移动端忽略）。 */
  const canAnimate = animateExisting && !isReducedMotion()
    && existingCards.length && typeof existingCards[0].animate === "function";
  if (!canAnimate) return 0;
  const cardHeight = card.offsetHeight;
  if (cardHeight < 2) return 0;
  const scaleCompensation = -cardHeight * .06;
  const duration = 1180;
  existingCards.forEach((item) => {
    const startDelta = previousTops.get(item) - item.getBoundingClientRect().top;
    if (Math.abs(startDelta) < 1) return;
    const animation = item.animate([
      { translate: "0 " + startDelta + "px", offset: 0, easing: "cubic-bezier(.24,.58,.24,1)" },
      { translate: "0 " + scaleCompensation + "px", offset: .46, easing: "linear" },
      { translate: "0 " + scaleCompensation + "px", offset: .78, easing: "cubic-bezier(.16,.78,.18,1)" },
      { translate: "0 0", offset: 1 },
    ], {
      duration,
      fill: "both",
    });
    const release = () => animation.cancel();
    animation.finished.then(release, release);
  });
  return duration;
}

function bindMobileScrollBoundaryHandoff(scroller) {
  if (!scroller || scroller.dataset.mobileBoundaryHandoff === "true") return;
  scroller.dataset.mobileBoundaryHandoff = "true";
  let lastTouchY = null;
  let handoffOuter = null;
  let handoffSnapTimer = null;
  const enabled = () => isMobileLayout() && gameScreen.classList.contains("has-guesses");
  const outerScroller = () => document.body.classList.contains("mobile-game-finished") ? boardEl : rowsEl;
  scroller.addEventListener("touchstart", (event) => {
    if (!enabled() || event.touches.length !== 1) return;
    lastTouchY = event.touches[0].clientY;
  }, { passive: true });
  /* 边界转交需 preventDefault 拦截内层原生滚动，此 touchmove 必须保持 passive:false（passive listener 中 preventDefault 无效且触发 Chrome intervention）。 */
  scroller.addEventListener("touchmove", (event) => {
    if (lastTouchY == null || !enabled() || event.touches.length !== 1) return;
    const currentY = event.touches[0].clientY;
    const deltaY = lastTouchY - currentY;
    lastTouchY = currentY;
    if (Math.abs(deltaY) < 1) return;
    const atTop = scroller.scrollTop <= 1;
    const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
    if (!(deltaY < 0 && atTop) && !(deltaY > 0 && atBottom)) return;
    const candidates = [outerScroller(), document.scrollingElement];
    for (const outer of candidates) {
      if (!outer || outer === scroller) continue;
      const maxScroll = Math.max(0, outer.scrollHeight - outer.clientHeight);
      const previous = outer.scrollTop;
      const next = Math.max(0, Math.min(maxScroll, previous + deltaY));
      if (Math.abs(next - previous) <= .5) continue;
      if (handoffSnapTimer != null) window.clearTimeout(handoffSnapTimer);
      if (handoffOuter && handoffOuter !== outer) handoffOuter.classList.remove("mobile-boundary-handoff-active");
      handoffOuter = outer;
      handoffOuter.classList.add("mobile-boundary-handoff-active");
      outer.scrollTop = next;
      event.preventDefault();
      event.stopPropagation();
      break;
    }
  }, { passive: false });
  const resetTouch = () => {
    lastTouchY = null;
    if (!handoffOuter) return;
    if (handoffSnapTimer != null) window.clearTimeout(handoffSnapTimer);
    handoffSnapTimer = window.setTimeout(() => {
      if (handoffOuter) handoffOuter.classList.remove("mobile-boundary-handoff-active");
      handoffOuter = null;
      handoffSnapTimer = null;
    }, 900);
  };
  scroller.addEventListener("touchend", resetTouch, { passive: true });
  scroller.addEventListener("touchcancel", resetTouch, { passive: true });
}

function renderSuddenV3Row(r) {
  const d = r.dims || {};
  const operator = r.operator || {};
  const artEntry = operatorArt[operator.id] || {};
  const firstRecord = !rowsEl.querySelector(".guess-card");
  const animateEntry = !r.suppressEntryAnimation;
  const card = document.createElement("article");
  card.className = "guess-card v2-guess-card" + (animateEntry ? " card-entering" : "");
  if (firstRecord && animateEntry) card.classList.add("is-first-record");
  prepareGuessCardHover(card, animateEntry);
  if (animateEntry) window.setTimeout(() => finishGuessCardEntry(card), 1280);

  const layout = document.createElement("div");
  layout.className = "operator-record-layout";
  const visual = document.createElement("aside");
  visual.className = "operator-visual";
  const visualScan = document.createElement("span");
  visualScan.className = "operator-visual-scan";
  const image = document.createElement("img");
  image.className = "operator-art";
  const themeArtUrl = operator.themeArtUrl || "";
  const themeArtSkinName = operator.themeArtSkinName || "";
  image.alt = r.guessName + (themeArtUrl ? ` ${themeArtSkinName || "品牌"}时装立绘` : " 精英一阶段立绘");
  image.loading = firstRecord || window.matchMedia("(max-width: 760px)").matches ? "eager" : "lazy";
  image.decoding = "async";
  image.src = themeArtUrl || artUrl(operator.id, false);
  image.addEventListener("error", () => visual.classList.add("image-missing"));
  visual.classList.add("art-preview-trigger");
  visual.tabIndex = 0;
  visual.setAttribute("role", "button");
  visual.setAttribute("aria-label", "查看" + r.guessName + "立绘大图");
  const showLargeArt = () => {
    if (!visual.classList.contains("image-missing")) openArtPreview(image, r.guessName, themeArtUrl ? (themeArtSkinName || "时装") + "立绘" : "精英一阶段立绘", visual);
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
  captionEn.textContent = themeArtUrl ? "THEME COSTUME RECORD" : "ELITE 1 RECORD";
  const captionTitle = document.createElement("strong");
  captionTitle.textContent = themeArtUrl ? (themeArtSkinName || "时装") : "精英一阶段";
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
  title.innerHTML = "<small>OPERATOR RECORD</small>";
  const name = document.createElement("h3");
  name.textContent = r.guessName;
  title.appendChild(name);
  identity.appendChild(number);
  identity.appendChild(title);

  let exactCount = 0;
  const grid = document.createElement("div");
  grid.className = "v2-clue-grid";
  V2_DIM_ORDER.forEach((key) => {
    let result = null;
    if (key === "tags") result = renderV2TagDimension(d.tags);
    else if (key === "power") result = renderPowerDimension(d.power);
    else if (key === "deploymentTemplate") result = renderRangeOverlap(d.deploymentTemplate);
    else if (key === "rotatingIntel") result = renderRotatingIntel(r.rotatingIntel);
    else if (key === "rarity") {
      const dim = d.rarity || { state: "unknown" };
      result = createV2Clue(V2_DIM_LABELS.rarity, dim.state, {
        valueText: v2DimValueText(dim),
        metaText: rarityText(operator.rarity != null ? operator.rarity : dim.guessValue),
        hint: v2HintTitle("星级", dim.state),
        title: dim.state === "exact" ? "星级吻合" : v2HintTitle("星级", dim.state),
      });
    } else if (key === "deploymentCost") {
      const dim = d.deploymentCost || { state: "unknown" };
      result = createV2Clue(V2_DIM_LABELS.deploymentCost, dim.state, {
        valueText: v2DimValueText(dim),
        hint: "最高可用精英阶段、潜能一的基础部署费用",
        title: "最高可用精英阶段、潜能一的基础部署费用",
      });
    } else {
      const dim = d[key] || { state: "unknown" };
      const label = V2_DIM_LABELS[key];
      const hintText = dim.state === "exact" ? label + "吻合"
        : dim.state === "unknown" ? "情报未知"
        : label + "不同";
      result = createV2Clue(label, dim.state, {
        valueText: v2DimValueText(dim),
        special: dim.special,
        hint: hintText,
        title: hintText,
      });
    }
    if (result.visual === "exact") exactCount += 1;
    grid.appendChild(result.clue);
  });

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
  if (r.themeResult) record.appendChild(buildDirectiveMatchMark(r.themeResult));
  record.appendChild(grid);

  layout.appendChild(visual);
  layout.appendChild(record);
  card.appendChild(layout);
  attachMobileRecordPager(card, layout, image, false);
  gameScreen.classList.add("has-guesses");
  activateMobileRecordLayout();
  boardEmpty.classList.add("hidden");
  const shiftDuration = prependGuessCard(card, animateEntry);
  rowsEl.scrollTop = 0;
  if (!r.suppressFocus) {
    focusNewRecord(card, firstRecord ? 480 : shiftDuration, firstRecord ? image : null);
  }
  requestQuickGuessVisibilitySync();
  return { card, image };
}

function renderWrongChoiceRecord(record) {
  return renderSuddenV3Row({
    ...record,
    suppressFocus: true,
    suppressEntryAnimation: true,
  });
}

/* ---------- sudden V3 结算档案 ---------- */

function renderComparisonFinalRecord(r) {
  const operator = r.operator || {};
  const artEntry = operatorArt[operator.id] || {};
  const themeArtUrl = operator.themeArtUrl || "";
  const themeArtSkinName = operator.themeArtSkinName || "";
  const card = document.createElement("article");
  card.className = "guess-card is-final-record v2-final-record";
  prepareGuessCardHover(card, false);

  const layout = document.createElement("div");
  layout.className = "operator-record-layout";
  const visual = document.createElement("aside");
  visual.className = "operator-visual";
  const visualScan = document.createElement("span");
  visualScan.className = "operator-visual-scan";
  const image = document.createElement("img");
  image.className = "operator-art";
  image.src = themeArtUrl || artUrl(operator.id, true);
  const artLabel = themeArtUrl
    ? ` ${themeArtSkinName || "品牌"}时装立绘`
    : (artEntry.finalKind === "skin" ? " 最新时装立绘" : " 最终档案立绘");
  image.alt = r.answerName + artLabel;
  image.loading = "eager";
  image.decoding = "async";
  image.addEventListener("error", () => visual.classList.add("image-missing"));
  visual.classList.add("art-preview-trigger");
  visual.tabIndex = 0;
  visual.setAttribute("role", "button");
  visual.setAttribute("aria-label", "查看" + r.answerName + "立绘大图");
  const showLargeArt = () => {
    if (!visual.classList.contains("image-missing")) openArtPreview(image, r.answerName, artLabel.trim(), visual);
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
  captionEn.textContent = themeArtUrl ? "THEME COSTUME RECORD" : "FINAL ARCHIVE";
  const captionTitle = document.createElement("strong");
  captionTitle.textContent = themeArtUrl
    ? (themeArtSkinName || "时装")
    : (artEntry.finalTitle || "最新形象");
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
  title.innerHTML = "<small>PERSONNEL ARCHIVE / 人员档案</small>";
  const name = document.createElement("h3");
  name.textContent = r.answerName;
  title.appendChild(name);
  identity.appendChild(number);
  identity.appendChild(title);
  const summary = document.createElement("div");
  summary.className = "guess-summary";
  const summaryNumber = document.createElement("strong");
  summaryNumber.textContent = "12/12";
  const summaryLabel = document.createElement("span");
  summaryLabel.textContent = "线索吻合";
  summary.appendChild(summaryNumber);
  summary.appendChild(summaryLabel);
  head.appendChild(identity);
  head.appendChild(summary);
  record.appendChild(head);
  record.appendChild(renderFinalArchiveSheet(operator, r.archive));
  layout.appendChild(visual);
  layout.appendChild(record);
  card.appendChild(layout);
  attachMobileRecordPager(card, layout, image, true);
  gameScreen.classList.add("has-guesses");
  activateMobileRecordLayout();
  boardEmpty.classList.add("hidden");
  prependGuessCard(card, false);
  rowsEl.scrollTop = 0;
  pendingVisualIntelReveal = {
    operator,
    answerName: r.answerName,
    finalRecord: card,
    finalReady: Promise.all([
      waitForImageDecode(image),
      waitForNamedAnimation(card, "final-archive-in", 1050),
    ]),
  };
}

function renderFinalArchiveSheet(operator, archiveData) {
  const sheet = document.createElement("div");
  sheet.className = "final-archive-sheet";
  const heading = document.createElement("div");
  heading.className = "archive-sheet-heading";
  heading.innerHTML = "<span>RHODES ISLAND</span><strong>人员档案</strong><small>PERSONNEL FILE</small>";
  sheet.appendChild(heading);

  const classification = document.createElement("div");
  classification.className = "archive-classification";
  classification.appendChild(archiveLine("职业定位", operator.professionText || "未公开"));
  classification.appendChild(archiveLine("稀有度", rarityText(operator.rarity)));
  classification.appendChild(archiveLine("部署位置", operator.position === "RANGED" ? "远程" : "近战"));
  classification.appendChild(archiveLine("标准费用", operator.deploymentCost != null ? String(operator.deploymentCost) : "未公开"));
  const branchLine = archiveLine("职业分支", operator.subProfessionText || "未公开", { branch: operator.subProfessionId });
  branchLine.classList.add("archive-identity-card");
  classification.appendChild(branchLine);

  const powerLine = document.createElement("div");
  powerLine.className = "archive-line archive-identity-card archive-line-power";
  const power = operator.power || {};
  const pLogo = document.createElement("span");
  pLogo.className = "power-logo";
  if (power.logoUrl) {
    const pImg = document.createElement("img");
    pImg.src = power.logoUrl;
    pImg.alt = "";
    pImg.addEventListener("error", () => pLogo.classList.add("logo-missing"));
    pLogo.appendChild(pImg);
  } else {
    pLogo.classList.add("logo-missing");
  }
  const pLabel = document.createElement("strong");
  pLabel.textContent = "【所属势力】";
  const pId = document.createElement("span");
  pId.className = "power-id";
  const pName = document.createElement("span");
  pName.className = "power-name";
  pName.textContent = power.name || "未公开";
  pId.appendChild(pName);
  if (power.parentName) {
    const pParent = document.createElement("span");
    pParent.className = "power-parent";
    pParent.textContent = power.parentName;
    pId.appendChild(pParent);
  }
  powerLine.appendChild(pLogo);
  powerLine.appendChild(pLabel);
  powerLine.appendChild(pId);
  classification.appendChild(powerLine);

  const rangeLine = archiveLine("技能范围", "", { wide: true });
  const rangeValue = rangeLine.querySelector("span");
  rangeValue.textContent = "";
  const rangeWrap = document.createElement("span");
  rangeWrap.className = "v2-archive-range";
  const archiveRanges = Array.isArray(operator.skillRanges) ? operator.skillRanges : [];
  archiveRanges.forEach((skillRange) => {
    const item = document.createElement("span");
    item.className = "v2-archive-range-item";
    const label = document.createElement("b");
    label.textContent = skillRange.slot || "技能";
    if (!skillRange.rangeOverridden) label.title = "该技能沿用基础攻击范围";
    const fullCells = (skillRange.rangeCells || []).map((cell) => ({
      x: cell.x,
      y: cell.y,
      state: cell.x === 0 && cell.y === 0 ? "origin" : "overlap",
    }));
    const builtRange = buildRangeGrid(fullCells);
    builtRange.grid.classList.add("skill-range-grid");
    item.appendChild(label);
    item.appendChild(builtRange.grid);
    rangeWrap.appendChild(item);
  });
  if (!archiveRanges.length) {
    const unavailable = document.createElement("span");
    unavailable.className = "range-sub";
    unavailable.textContent = "无可用技能范围资料";
    rangeWrap.appendChild(unavailable);
  }
  rangeValue.appendChild(rangeWrap);
  classification.appendChild(rangeLine);

  const tags = operator.tags && operator.tags.length ? operator.tags.join(" / ") : "未公开";
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
      archiveLine("性别", operator.gender || "未公开"),
      archiveLine("战斗经验", operator.expText || "未公开"),
      archiveLine("出身地", operator.origin || "未公开"),
      archiveLine("生日", operator.birthdayText || "未公开"),
      archiveLine("种族", operator.race || "未公开"),
      archiveLine("身高", operator.heightText || "未公开"),
      archiveLine("矿石病感染情况", operator.infectedText || "未公开", { wide: true }),
    ]));
  }
  sheet.appendChild(content);

  const seal = document.createElement("span");
  seal.className = "archive-verified-seal";
  seal.textContent = "12 / 12 VERIFIED";
  sheet.appendChild(seal);
  bindMobileScrollBoundaryHandoff(sheet);
  return sheet;
}

/* ---------- 战术指令系统（V3） ---------- */

const DIRECTIVE_STATE_TEXT = {
  active: "ACTIVE",
  complete: "COMPLETE",
  revealed: "DECODED",
};

/* 开局：按服务端 theme 渲染指令与 goal 个进度节点，并播放一次接入动画 */
function initDirective(theme, roundEntry) {
  updateDirectivePanel(theme);
  if (!directivePanel || !theme) return;
  if (directiveIntroTimer) window.clearTimeout(directiveIntroTimer);
  directiveIntroTimer = null;
  directivePanel.classList.remove("directive-boot", "directive-round-enter");
  void directivePanel.offsetWidth;
  if (roundEntry) {
    directivePanel.classList.remove("directive-awaiting");
    directivePanel.classList.add("directive-round-enter");
    directiveIntroTimer = window.setTimeout(() => {
      directivePanel.classList.remove("directive-round-enter");
      directiveIntroTimer = null;
    }, gameScreen.classList.contains("round-content-enter") ? 960 : 760);
  } else {
    directivePanel.classList.remove("directive-awaiting");
    directivePanel.classList.add("directive-boot");
  }
  announceDirective("已接收战术指令：" + (theme.title || "") + "。使用符合指令的干员完成 " + (Number(theme.goal) || 0) + " 次吻合，即可解锁一条情报。");
}

function buildDirectiveNodes(goal) {
  directiveNodes.innerHTML = "";
  for (let i = 0; i < goal; i++) {
    const node = document.createElement("span");
    node.className = "directive-node";
    directiveNodes.appendChild(node);
  }
}

function announceDirective(text) {
  if (!directiveAnnounce) return;
  directiveAnnounce.textContent = "";
  window.setTimeout(() => { directiveAnnounce.textContent = text; }, 30);
}

/* 指令完成的一次性反馈：面板扫描 + 状态闪烁（prefers-reduced-motion 时由全局 CSS 压平） */
function playDirectiveCompletion() {
  directiveCompletionPlayed = true;
  if (!directivePanel) return;
  directivePanel.classList.remove("directive-flash");
  void directivePanel.offsetWidth;
  directivePanel.classList.add("directive-flash");
  mobileDirectiveDock.classList.remove("directive-flash");
  void mobileDirectiveDock.offsetWidth;
  mobileDirectiveDock.classList.add("directive-flash");
  window.setTimeout(() => {
    directivePanel.classList.remove("directive-flash");
    mobileDirectiveDock.classList.remove("directive-flash");
  }, 1120);
  announceDirective("战术指令校验完成，情报访问权限开放。");
}

function waitForDirectiveConfirmation() {
  const duration = isReducedMotion() ? 80 : 1180;
  return new Promise((resolve) => window.setTimeout(resolve, duration));
}

/* 以服务端 theme 为唯一事实来源更新面板；themeResult.newlyCompleted 触发一次完成反馈 */
function updateDirectivePanel(theme, themeResult, options) {
  if (!directivePanel) return;
  const prev = directiveSnapshot;
  directiveSnapshot = theme || null;
  if (!theme) {
    clearDirectiveIntel();
    directivePanel.dataset.status = "idle";
    directivePanel.dataset.family = "";
    directivePanel.classList.remove("directive-boot", "directive-flash");
    directiveState.textContent = "STANDBY";
    directiveFamily.textContent = "战术指令";
    directiveTitle.textContent = "等待指令下发";
    directiveDesc.textContent = "识别协议启动后，将在此公开本局战术指令与校验目标。";
    directiveNodes.innerHTML = "";
    directiveProgress.textContent = "--";
    directiveNote.textContent = "";
    directiveDecodeBtn.classList.add("hidden");
    mobileDirectiveDock.dataset.status = "idle";
    mobileDirectiveTitle.textContent = "等待指令下发";
    mobileDirectiveDesc.textContent = "";
    mobileDirectiveProgress.textContent = "--";
    mobileDirectiveDecodeBtn.textContent = "解码情报";
    mobileDirectiveDecodeBtn.classList.add("hidden");
    return;
  }
  const goal = Math.max(1, Number(theme.goal) || 1);
  const progress = Math.max(0, Math.min(goal, Number(theme.progress) || 0));
  const sameTheme = !!(prev && prev.id === theme.id);
  const prevProgress = sameTheme ? Math.max(0, Math.min(goal, Number(prev.progress) || 0)) : progress;
  const status = theme.status || "active";
  directivePanel.dataset.status = status;
  directivePanel.dataset.family = theme.family || "";
  directiveState.textContent = DIRECTIVE_STATE_TEXT[status] || "ACTIVE";
  directiveFamily.textContent = theme.familyLabel || "战术指令";
  directiveTitle.textContent = theme.title || "未命名指令";
  directiveDesc.textContent = theme.description || "";
  if (directiveNodes.children.length !== goal) buildDirectiveNodes(goal);
  const nodes = directiveNodes.children;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const lit = i < progress;
    node.classList.remove("just-lit");
    node.classList.toggle("lit", lit);
    /* 只点亮新增节点并播放落锁动画；未命中或进度不变时不做任何闪烁 */
    if (lit && sameTheme && i >= prevProgress) {
      void node.offsetWidth;
      node.classList.add("just-lit");
    }
  }
  directiveProgress.textContent = progress + "/" + goal;
  mobileDirectiveDock.dataset.status = status;
  mobileDirectiveTitle.textContent = theme.title || "未命名指令";
  mobileDirectiveDesc.textContent = theme.description || "";
  mobileDirectiveProgress.textContent = progress + "/" + goal;
  if (status === "revealed") directiveNote.textContent = "本局情报已解码";
  else if (status === "complete") directiveNote.textContent = pendingClue ? "指令已确认 · 准备读取情报" : "指令已确认";
  else directiveNote.textContent = "";
  directiveDecodeBtn.classList.add("hidden");
  mobileDirectiveDecodeBtn.classList.add("hidden");
  if (status === "revealed" && decodedIntel.length && isMobileLayout()) {
    mobileDirectiveDecodeBtn.textContent = "查看情报";
    mobileDirectiveDecodeBtn.classList.remove("hidden");
  }
  /* deferCompletionFlash：指令完成动效由调用方在档案卡片加载完后手动触发（handleSuddenV3Guess），此处不自动播放 */
  const deferFlash = Boolean(options && options.deferCompletionFlash);
  if (themeResult && themeResult.newlyCompleted && !directiveCompletionPlayed && !deferFlash) playDirectiveCompletion();
}

/* 每条猜测记录上的指令吻合标记：不是第 13 个比较维度，仅反映 themeResult.matched */
function buildDirectiveMatchMark(themeResult) {
  const matched = !!(themeResult && themeResult.matched);
  const mark = document.createElement("div");
  mark.className = "directive-match " + (matched ? "is-match" : "is-miss");
  mark.setAttribute("role", "status");
  const sigil = document.createElement("i");
  sigil.className = "dm-sigil";
  sigil.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  text.className = "dm-text";
  text.appendChild(document.createTextNode(matched ? "指令吻合" : "未吻合"));
  const en = document.createElement("b");
  en.textContent = matched ? "DIRECTIVE MATCH" : "NO MATCH";
  text.appendChild(en);
  const side = document.createElement("span");
  side.className = "dm-side";
  side.textContent = matched
    ? "进度 " + (themeResult.progress != null ? themeResult.progress : "?") + "/" + (themeResult.goal != null ? themeResult.goal : "?")
    : "进度不变";
  mark.appendChild(sigil);
  mark.appendChild(text);
  mark.appendChild(side);
  return mark;
}

/* ---------- 战术指令内联情报 ---------- */

function clearDirectiveIntel() {
  if (!directivePanel || !directiveIntelView) return;
  directivePanel.classList.remove("show-intel", "is-decoding");
  directiveIntelView.innerHTML = "";
  directiveIntelView.scrollTop = 0;
  directiveIntelView.setAttribute("aria-hidden", "true");
  directiveMainView.setAttribute("aria-hidden", "false");
}

function showDirectiveIntel(clue) {
  if (!directivePanel || !directiveIntelView || !clue) return;
  directiveIntelView.innerHTML = "";
  directiveIntelView.scrollTop = 0;
  directiveIntelView.appendChild(buildIntelCard(clue, false));
  directiveIntelView.setAttribute("aria-hidden", "false");
  directiveMainView.setAttribute("aria-hidden", "true");
  mobileDirectiveTitle.textContent = clue.title || "已解码情报";
  mobileDirectiveDesc.textContent = "情报已解码 · 图像情报支持点击放大";
  mobileDirectiveProgress.textContent = "DECODED";
  if (isMobileLayout()) {
    mobileDirectiveDecodeBtn.textContent = "查看情报";
    mobileDirectiveDecodeBtn.classList.remove("hidden");
    openMobileDataSheet(clue.title || "已解码情报", "intel", buildIntelCard(clue, false), mobileDirectiveDecodeBtn);
  }
  requestAnimationFrame(() => directivePanel.classList.add("show-intel"));
}

async function requestClueReveal() {
  if (clueDecoding || !pendingClue || !token) return null;
  const restoreInput = !finished && !input.disabled;
  if (restoreInput) setInputEnabled(false);
  clueDecoding = true;
  directivePanel.classList.add("is-decoding");
  directiveNote.textContent = "正在读取授权情报……";
  directiveDecodeBtn.classList.add("hidden");
  mobileDirectiveDecodeBtn.classList.add("hidden");
  try {
    const data = await fetchJSON("/api/clue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, clueId: pendingClue.id }),
    });
    if (data.error === "invalid_session") {
      setStatus("会话失效，重新开始……");
      await startGame(currentMode);
      return null;
    }
    if (data.error) {
      directiveNote.textContent = suddenErrorText(data.error) + " · 可点击重试";
      directiveDecodeBtn.classList.remove("hidden");
      mobileDirectiveDecodeBtn.classList.remove("hidden");
      return null;
    }
    token = data.token;
    pendingClue = null;
    updateDirectivePanel(data.theme);
    if (data.clue) {
      decodedIntel = [data.clue];
      renderIntelRail();
      showDirectiveIntel(data.clue);
      announceDirective("本局情报已解码并载入战术终端。");
      setStatus("情报已解码，继续缩小候选范围。");
      if (!isReducedMotion()) {
        await new Promise((resolve) => window.setTimeout(resolve, 460));
      }
    }
    return data.clue || null;
  } catch (e) {
    directiveNote.textContent = "情报读取失败 · 可点击重试";
    directiveDecodeBtn.classList.remove("hidden");
    mobileDirectiveDecodeBtn.classList.remove("hidden");
    setStatus("情报读取失败，可从战术指令卡重试。", true);
    return null;
  } finally {
    clueDecoding = false;
    directivePanel.classList.remove("is-decoding");
    if (restoreInput && !finished) {
      setInputEnabled(true);
      focusGuessEntry();
    }
  }
}

/* ---------- 已解码情报（持久展示） ---------- */

function renderIntelRail() {
  if (!intelRail) return;
  intelRail.classList.toggle("v3-inline-intel", isSuddenV3());
  intelRail.innerHTML = "";
  if (isSuddenV3() && isMobileLayout()) {
    intelRail.classList.add("hidden");
    return;
  }
  if (!decodedIntel.length) {
    intelRail.classList.add("hidden");
    return;
  }
  decodedIntel.forEach((clue) => intelRail.appendChild(buildIntelCard(clue, false)));
  intelRail.classList.remove("hidden");
}

function appendIntelMechanicChips(chips, mechanic) {
  const mech = mechanic || {};
  const items = [
    ["触发", V2_MECHANIC_TEXT.activation[mech.activation] || "未知"],
    ["技力", V2_MECHANIC_TEXT.spRecovery[mech.spRecovery] || "未知"],
  ];
  items.forEach(([key, value]) => {
    const chip = document.createElement("span");
    chip.className = "intel-mech-chip";
    const label = document.createElement("b");
    label.textContent = key + " ";
    chip.appendChild(label);
    chip.appendChild(document.createTextNode(value));
    chips.appendChild(chip);
  });
  if (mech.chargeable) {
    const chip = document.createElement("span");
    chip.className = "intel-mech-chip charge";
    chip.textContent = "可储存 " + (mech.maxChargeTime || 1) + " 次";
    chips.appendChild(chip);
  }
  if (mech.ammo) {
    const chip = document.createElement("span");
    chip.className = "intel-mech-chip charge";
    chip.textContent = "弹药技能";
    chips.appendChild(chip);
  }
}

function buildIntelCard(clue, inModal) {
  const kind = clue.kind || "quote";
  const card = document.createElement("article");
  card.className = "intel-card intel-" + kind;
  const mediaKinds = { silhouette: 1, artFragment: 1, skillIcon: 1 };
  const skillBundleItems = kind === "skillBundle" && Array.isArray(clue.skills) ? clue.skills : [];
  const skillBundleFields = kind === "skillBundle" && Array.isArray(clue.skillFields) ? clue.skillFields : [];
  const skillIconItems = kind === "skillIcon" && Array.isArray(clue.skills)
    ? clue.skills
    : skillBundleFields.includes("icon") ? skillBundleItems : [];
  const mechanicSkillItems = kind === "skillMechanic" && Array.isArray(clue.skills) ? clue.skills : [];
  const hasImage = mediaKinds[kind] && clue.imageUrl;
  if (skillBundleItems.length || skillIconItems.length || mechanicSkillItems.length) {
    card.classList.add("intel-multi-skill");
  }

  if (skillIconItems.length) {
    const media = document.createElement("div");
    media.className = "intel-media intel-media-icon intel-skill-icons";
    skillIconItems.forEach((skill) => {
      const iconButton = document.createElement("button");
      iconButton.className = "intel-skill-icon";
      iconButton.type = "button";
      iconButton.setAttribute("aria-label", "查看" + (skill.slot || "技能") + "图标大图");
      const img = document.createElement("img");
      img.src = skill.imageUrl || "";
      img.alt = skill.imageAlt || ((skill.slot || "技能") + "图标");
      img.loading = "lazy";
      img.addEventListener("error", () => iconButton.classList.add("image-missing"));
      const slot = document.createElement("b");
      slot.textContent = skill.slot || "SKILL";
      iconButton.appendChild(img);
      iconButton.appendChild(slot);
      if (skillBundleFields.includes("name") && skill.name) {
        const name = document.createElement("span");
        name.className = "intel-skill-icon-name";
        name.textContent = skill.name;
        iconButton.appendChild(name);
      }
      iconButton.addEventListener("click", () => {
        if (!iconButton.classList.contains("image-missing")) {
          openArtPreview(
            img,
            (skill.name || clue.title || "全技能图标") + " " + (skill.slot || ""),
            "SKILL ICON",
            iconButton,
            kind
          );
        }
      });
      media.appendChild(iconButton);
    });
    card.appendChild(media);
  } else if (hasImage) {
    const media = document.createElement("div");
    media.className = "intel-media" + (kind === "skillIcon" ? " intel-media-icon" : "");
    const img = document.createElement("img");
    img.src = clue.imageUrl;
    img.alt = clue.imageAlt || "已解码情报图像";
    img.loading = "lazy";
    img.addEventListener("error", () => media.classList.add("intel-media-missing"));
    media.appendChild(img);
    /* 完整剪影 + 局部显影：点击查看大图，始终 object-fit:contain 不裁剪 */
    const artLabel = {
      silhouette: "TARGET SILHOUETTE",
      artFragment: "PARTIAL REVEAL",
      skillIcon: "SKILL ICON",
    }[kind] || "AUX INTEL";
    media.dataset.previewTitle = clue.title || "战术情报";
    media.dataset.previewLabel = artLabel;
    media.dataset.previewKind = kind;
    media.classList.add("intel-media-zoom");
    media.tabIndex = 0;
    media.setAttribute("role", "button");
    media.setAttribute("aria-label", "查看" + (clue.title || "战术情报") + "大图");
    const showLarge = () => {
      if (!media.classList.contains("intel-media-missing")) {
        openArtPreview(
          img,
          media.dataset.previewTitle || clue.title || "战术情报",
          media.dataset.previewLabel || artLabel,
          media,
          media.dataset.previewKind || null
        );
      }
    };
    media.addEventListener("click", showLarge);
    media.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        showLarge();
      }
    });
    card.appendChild(media);
  } else {
    card.classList.add("intel-no-media");
  }
  if (clue.slot) {
    const slot = document.createElement("span");
    slot.className = "intel-slot intel-slot-inline";
    slot.textContent = clue.slot;
    card.appendChild(slot);
  }

  const body = document.createElement("div");
  body.className = "intel-body";
  const kindRow = document.createElement("div");
  kindRow.className = "intel-kind";
  const kindText = document.createElement("span");
  kindText.className = "intel-kind-label";
  kindText.textContent = {
    silhouette: "TARGET SILHOUETTE",
    artFragment: "PARTIAL REVEAL",
    skillIcon: skillIconItems.length ? "SKILL ICON SET" : "SKILL ICON",
    skillName: "SKILL CODENAME",
    quote: "COMMS RECORD",
    skillMechanic: "MECHANIC CHIP",
    skillBundle: "SKILL DATA LINK",
  }[kind] || "AUX INTEL";
  const kindEn = document.createElement("i");
  kindEn.textContent = "DECODED";
  kindRow.appendChild(kindText);
  kindRow.appendChild(kindEn);
  body.appendChild(kindRow);

  const title = document.createElement("h4");
  title.className = "intel-title";
  title.textContent = clue.title || "战术情报";
  body.appendChild(title);

  if (kind === "silhouette") {
    const note = document.createElement("p");
    note.className = "intel-silhouette-note";
    note.textContent = "目标轮廓已比对：留意发型、武器与整体身形。";
    body.appendChild(note);
  } else if (kind === "artFragment") {
    const note = document.createElement("p");
    note.className = "intel-silhouette-note";
    note.textContent = "局部显影完成：结合完整轮廓、配色与材质继续推理。";
    body.appendChild(note);
  } else if (kind === "skillBundle") {
    const fieldLabels = { icon: "图标", name: "名称", mechanic: "机制" };
    const summary = document.createElement("p");
    summary.className = "intel-skill-summary";
    summary.textContent = "已同步全部 " + skillBundleItems.length + " 项技能 · "
      + skillBundleFields.map((field) => fieldLabels[field] || field).join(" + ");
    body.appendChild(summary);
    if (skillBundleFields.includes("mechanic") || !skillBundleFields.includes("icon")) {
      const list = document.createElement("div");
      list.className = "intel-mech-list intel-skill-bundle-list";
      skillBundleItems.forEach((skill) => {
        const row = document.createElement("section");
        row.className = "intel-mech-skill";
        const slot = document.createElement("strong");
        slot.className = "intel-mech-slot";
        slot.textContent = skill.slot || "技能";
        const details = document.createElement("div");
        details.className = "intel-skill-details";
        if (skillBundleFields.includes("name")) {
          const name = document.createElement("p");
          name.className = "intel-skill-name";
          name.textContent = skill.name || "未知技能";
          details.appendChild(name);
        }
        if (skillBundleFields.includes("mechanic")) {
          const chips = document.createElement("div");
          chips.className = "intel-mech";
          appendIntelMechanicChips(chips, skill.mechanic);
          details.appendChild(chips);
        }
        row.appendChild(slot);
        row.appendChild(details);
        list.appendChild(row);
      });
      body.appendChild(list);
    }
  } else if (kind === "skillIcon" && skillIconItems.length) {
    const note = document.createElement("p");
    note.className = "intel-skill-summary";
    note.textContent = "已同步全部 " + skillIconItems.length + " 项技能图标 · "
      + skillIconItems.map((skill) => skill.slot).join(" / ");
    body.appendChild(note);
  } else if (kind === "skillName") {
    const text = document.createElement("p");
    text.className = "intel-text";
    text.textContent = (clue.slot ? clue.slot + " · " : "") + (clue.text || "");
    body.appendChild(text);
  } else if (kind === "quote") {
    const quote = document.createElement("blockquote");
    quote.className = "intel-quote";
    quote.textContent = clue.text || "";
    body.appendChild(quote);
  } else if (kind === "skillMechanic") {
    const mechanicSkills = Array.isArray(clue.skills) && clue.skills.length
      ? clue.skills
      : [{ slot: (clue.mechanic || {}).slot || "技能", mechanic: clue.mechanic || {} }];
    const summary = document.createElement("p");
    summary.className = "intel-skill-summary";
    summary.textContent = Array.isArray(clue.skills)
      ? "已同步全部 " + mechanicSkills.length + " 项技能机制 · "
        + mechanicSkills.map((skill) => skill.slot || "技能").join(" / ")
      : "已同步 1 项技能机制";
    body.appendChild(summary);
    const list = document.createElement("div");
    list.className = "intel-mech-list";
    mechanicSkills.forEach((skill) => {
      const row = document.createElement("section");
      row.className = "intel-mech-skill";
      const slot = document.createElement("strong");
      slot.className = "intel-mech-slot";
      slot.textContent = skill.slot || "技能";
      const chips = document.createElement("div");
      chips.className = "intel-mech";
      appendIntelMechanicChips(chips, skill.mechanic);
      row.appendChild(slot);
      row.appendChild(chips);
      list.appendChild(row);
    });
    body.appendChild(list);
  }
  card.appendChild(body);
  return card;
}

async function waitForImageDecode(image) {
  if (!image) return;
  try {
    if (typeof image.decode === "function") {
      await image.decode();
    } else if (!image.complete) {
      await new Promise((resolve) => {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", resolve, { once: true });
      });
    }
  } catch (error) {
    /* 图片错误状态由所属卡片处理，不阻塞后续界面。 */
  }
}

function waitForNamedAnimation(element, animationName, fallbackDuration) {
  if (!element || isReducedMotion()) return Promise.resolve();
  const names = window.getComputedStyle(element).animationName.split(",").map((name) => name.trim());
  if (!names.includes(animationName)) return Promise.resolve();
  return new Promise((resolve) => {
    let timer = null;
    const finish = () => {
      element.removeEventListener("animationend", onAnimationEnd);
      if (timer !== null) window.clearTimeout(timer);
      resolve();
    };
    const onAnimationEnd = (event) => {
      if (event.target === element && event.animationName === animationName) finish();
    };
    element.addEventListener("animationend", onAnimationEnd);
    timer = window.setTimeout(finish, fallbackDuration);
  });
}

async function revealVisualIntel(operator, answerName, finalRecord) {
  const visualKinds = new Set(["silhouette", "artFragment"]);
  if (!operator || !operator.id || !decodedIntel.some((clue) => visualKinds.has(clue.kind))) return;
  if (finalRecord && !finalRecord.isConnected) return;
  if (!decodedIntel.some((clue) => visualKinds.has(clue.kind))) return;

  const imageUrl = artUrl(operator.id, false);
  const artLabel = "剪影原始立绘";
  const cards = [...document.querySelectorAll(".intel-card:is(.intel-silhouette,.intel-artFragment)")];
  if (!cards.length) return;

  /* 终局档案完成加载、入场与滚动聚焦后，才读取剪影原始立绘并在屏幕外解码。 */
  const preloadedImage = new Image();
  preloadedImage.decoding = "async";
  preloadedImage.src = imageUrl;
  await waitForImageDecode(preloadedImage);

  let revealedCount = 0;
  const revealTargets = [];
  cards.forEach((card) => {
    if (!card.isConnected) return;
    const media = card.querySelector(".intel-media");
    const image = media && media.querySelector("img");
    if (!media || !image) return;
    card.classList.remove("intel-answer-revealing");
    media.classList.remove("intel-media-missing");
    media.classList.add("intel-answer-revealed");
    media.dataset.previewTitle = answerName || "目标干员";
    media.dataset.previewLabel = artLabel;
    media.dataset.previewKind = "";
    image.loading = "eager";
    image.decoding = "async";
    image.src = imageUrl;
    image.alt = (answerName || "目标干员") + " " + artLabel;
    const kindLabel = card.querySelector(".intel-kind-label");
    const title = card.querySelector(".intel-title");
    const note = card.querySelector(".intel-silhouette-note");
    if (kindLabel) kindLabel.textContent = "TARGET IDENTIFIED";
    if (title) title.textContent = "身份确认 · " + (answerName || "目标干员");
    if (note) note.textContent = "轮廓比对完成，生成该剪影的原始立绘已同步至战术终端。";
    image.style.animation = "none";
    revealTargets.push({ card, image });
    revealedCount += 1;
  });
  if (revealTargets.length) {
    void revealTargets[0].image.offsetWidth;
    revealTargets.forEach(({ card, image }) => {
      if (!card.isConnected) return;
      image.style.animation = "";
      card.classList.add("intel-answer-revealing");
    });
  }
  if (revealedCount) {
    mobileDirectiveTitle.textContent = "身份确认 · " + (answerName || "目标干员");
    mobileDirectiveDesc.textContent = "剪影原始立绘已同步 · 图像支持点击放大";
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
  bindMobileScrollBoundaryHandoff(sheet);
  return sheet;
}

function attachMobileRecordPager(card, layout, image, finalRecord) {
  /* finalRecord=true 的语义：终局档案刻意不渲染分页器、不自动翻页（终局揭晓有独立编排，且 e2e 固定了最终卡无 .mobile-record-pager 的约定）；第二面档案通过下方与普通卡完全一致的横滑手势（pointer 滑动切换 mobile-show-record）访问。 */
  const pager = finalRecord ? null : document.createElement("nav");
  const buttons = [];
  if (pager) {
    pager.className = "mobile-record-pager";
    pager.setAttribute("aria-label", "切换立绘和档案信息");
    ["立绘", "档案"].forEach((label, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = index === 0 ? "active" : "";
      button.setAttribute("aria-label", "显示" + label);
      button.innerHTML = "<i aria-hidden=\"true\"></i><span>" + label + "</span>";
      pager.appendChild(button);
      buttons.push(button);
    });
    const swipe = document.createElement("em");
    swipe.textContent = "SWIPE ↔";
    pager.appendChild(swipe);
  }

  let userNavigated = false;
  let gestureStart = null;
  let suppressClickUntil = 0;
  const setPage = (index) => {
    layout.classList.toggle("mobile-show-record", index === 1);
    buttons.forEach((button, buttonIndex) => button.classList.toggle("active", buttonIndex === index));
    if (index === 1 && isMobileLayout()) alignMobileGameViewport();
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

  if (pager) card.appendChild(pager);
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
  if (!finalRecord) Promise.all([
    imageReady,
    !isMobileLayout() && card.classList.contains("is-first-record")
      ? new Promise((resolve) => window.setTimeout(resolve, 1320))
      : Promise.resolve(),
  ]).then(() => {
    window.setTimeout(() => {
      if (!window.matchMedia("(max-width: 760px)").matches || userNavigated || !card.isConnected) return;
      setPage(1);
    }, isMobileLayout() ? 1100 : (card.classList.contains("is-first-record") ? 80 : 1100));
  });
}

function renderRow(r) {
  const d = r.dims;
  const operator = r.operator || {};
  const finalRecord = !!(r.final || r.win);
  const artEntry = operatorArt[operator.id] || {};
  const firstRecord = !rowsEl.querySelector(".guess-card");
  const card = document.createElement("article");
  card.className = "guess-card" + (finalRecord ? " is-final-record" : "");
  prepareGuessCardHover(card, !finalRecord);
  if (!finalRecord) {
    card.classList.add("card-entering");
    if (firstRecord) card.classList.add("is-first-record");
    window.setTimeout(() => finishGuessCardEntry(card), 1280);
  }

  const layout = document.createElement("div");
  layout.className = "operator-record-layout";
  const visual = document.createElement("aside");
  visual.className = "operator-visual";
  const visualScan = document.createElement("span");
  visualScan.className = "operator-visual-scan";
  const image = document.createElement("img");
  image.className = "operator-art";
  const artLabel = finalRecord
    ? (artEntry.finalKind === "skin" ? " 最新时装立绘" : " 最终档案立绘")
    : " 精英一阶段立绘";
  image.alt = r.guessName + artLabel;
  image.loading = finalRecord || firstRecord || window.matchMedia("(max-width: 760px)").matches ? "eager" : "lazy";
  image.decoding = "async";
  image.src = artUrl(operator.id, finalRecord);
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
  activateMobileRecordLayout();
  boardEmpty.classList.add("hidden");
  const shiftDuration = prependGuessCard(card, !finalRecord);
  rowsEl.scrollTop = 0;
  if (!finalRecord) {
    focusNewRecord(card, firstRecord ? 480 : shiftDuration, firstRecord ? image : null);
    requestQuickGuessVisibilitySync();
  }
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
    if (isComparisonV3() && Number(data.version) === SUDDEN_VERSION) {
      renderComparisonFinalRecord(data);
    } else if (data.dims) {
      renderRow({ guessName: data.answerName, dims: data.dims, operator: data.operator, archive: data.archive, final: true });
    }
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
  closeMobileDataSheet(false);
  if (endlessEasterEggs) endlessEasterEggs.resetStreak();
  lastEndlessInputTriggerKey = "";
  hideEndlessBubble();
  gameStartSequence++;
  releaseDirectiveIntro();
  document.body.dataset.mode = "";
  document.body.classList.remove("game-scroll-lock", "anomaly-scroll-lock");
  clearFinalSequence();
  gameScreen.classList.remove("is-finished");
  document.body.classList.remove("mobile-record-active", "mobile-game-finished", "quick-guess-active");
  clearMobileGameViewport();
  victoryEl.classList.add("hidden");
  updateHudTags("");
  anomalyScreen.classList.add("hidden");
  anomalyScreen.classList.remove("is-theme-selecting");
  resetAnomalyState();
  setModeLaunching("", false);
  setModePreview("");
  syncSuddenControls(suddenMax);
  gameScreen.classList.add("hidden");
  gameScreen.classList.remove("mobile-fixed-viewport-root");
  modeScreen.classList.remove("hidden");
  window.scrollTo(0, 0);
  scheduleModeScreenFocus();
}

function showGameScreen() {
  cancelModeScreenFocus();
  modeScreen.classList.add("hidden");
  gameScreen.classList.remove("mobile-fixed-viewport-root");
  gameScreen.classList.remove("hidden");
  document.body.classList.remove("anomaly-scroll-lock");
  document.body.classList.add("game-scroll-lock");
  window.scrollTo(0, 0);
}

function cancelModeScreenFocus() {
  modeIntroSequence++;
  document.documentElement.classList.remove("mode-scroll-driving");
  if (modeFocusTimer !== null) {
    window.clearTimeout(modeFocusTimer);
    modeFocusTimer = null;
  }
  if (modeFocusFrame !== null) {
    window.cancelAnimationFrame(modeFocusFrame);
    modeFocusFrame = null;
  }
  modeScreen.classList.remove("is-mode-sequencing", "is-chessmaster-loading", "is-mode-cards-revealing");
  modeCards.querySelectorAll(".mode-card").forEach((card) => card.classList.remove("mode-hover-armed"));
}

function scheduleModeScreenFocus() {
  cancelModeScreenFocus();
  if (!modeCards) return;
  const sequence = modeIntroSequence;
  modeScreen.classList.add("is-mode-sequencing", "is-chessmaster-loading");
  void modeScreen.offsetWidth;
  if (!window.matchMedia("(min-width: 1041px)").matches || isReducedMotion()) {
    modeScreen.classList.remove("is-chessmaster-loading");
    if (window.matchMedia("(min-width: 1041px)").matches) {
      const cardsTop = window.scrollY + modeCards.getBoundingClientRect().top;
      window.scrollTo(0, Math.max(0, cardsTop - window.innerHeight * 0.48));
    }
    revealModeCards(sequence);
    return;
  }
  modeFocusTimer = window.setTimeout(() => {
    modeFocusTimer = null;
    if (modeScreen.classList.contains("hidden")) return;
    modeScreen.classList.remove("is-chessmaster-loading");
    const cardsTop = window.scrollY + modeCards.getBoundingClientRect().top;
    const targetTop = Math.max(0, cardsTop - window.innerHeight * 0.48);
    animateModeScreenScroll(targetTop, sequence);
  }, 1450);
}

function animateModeScreenScroll(targetTop, sequence) {
  const startTop = window.scrollY;
  const distance = targetTop - startTop;
  const startedAt = performance.now();
  const duration = 880;
  document.documentElement.classList.add("mode-scroll-driving");
  const step = (now) => {
    if (sequence !== modeIntroSequence || modeScreen.classList.contains("hidden")) {
      document.documentElement.classList.remove("mode-scroll-driving");
      modeFocusFrame = null;
      return;
    }
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = progress < 0.5
      ? 4 * progress * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 3) / 2;
    window.scrollTo(0, startTop + distance * eased);
    if (progress < 1) {
      modeFocusFrame = window.requestAnimationFrame(step);
      return;
    }
    document.documentElement.classList.remove("mode-scroll-driving");
    modeFocusFrame = null;
    revealModeCards(sequence);
  };
  modeFocusFrame = window.requestAnimationFrame(step);
}

function revealModeCards(sequence) {
  if (sequence !== modeIntroSequence || modeScreen.classList.contains("hidden")) return;
  modeScreen.classList.remove("is-mode-sequencing");
  modeScreen.classList.add("is-mode-cards-revealing");
  modeCards.querySelectorAll(".mode-card").forEach((card) => card.classList.remove("mode-hover-armed"));
  modeFocusTimer = window.setTimeout(() => {
    modeFocusTimer = null;
    if (sequence !== modeIntroSequence) return;
    modeScreen.classList.remove("is-mode-cards-revealing");
    modeCards.querySelectorAll(".mode-card").forEach((card) => {
      // 入场期间已经停在卡片上的指针必须先移出再进入，避免动画终态瞬间跳成 hover 放大态。
      if (!card.matches(":hover")) card.classList.add("mode-hover-armed");
    });
  }, 650);
}

function setModePreview(mode) {
  modeStage.classList.toggle("preview-sudden", mode === "sudden");
  modeStage.classList.toggle("preview-endless", mode === "endless");
  modeStage.classList.toggle("preview-anomaly", mode === "anomaly");
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

function canConsumeWheel(element, deltaY) {
  let current = element instanceof Element ? element : null;
  while (current && current !== document.body) {
    const overflowY = window.getComputedStyle(current).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && current.scrollHeight > current.clientHeight + 1) {
      const canScrollUp = deltaY < 0 && current.scrollTop > 0;
      const canScrollDown = deltaY > 0 && current.scrollTop + current.clientHeight < current.scrollHeight - 1;
      if (canScrollUp || canScrollDown) return true;
    }
    current = current.parentElement;
  }
  return false;
}

function animateWorkspaceWheel() {
  workspaceWheelFrame = null;
  if (!gameWorkspace || !document.body.classList.contains("game-scroll-lock")
    || isMobileLayout() || Math.abs(workspaceWheelDistance) < .35) {
    workspaceWheelDistance = 0;
    return;
  }

  const maxScroll = gameWorkspace.scrollHeight - gameWorkspace.clientHeight;
  const step = Math.abs(workspaceWheelDistance) < 1
    ? workspaceWheelDistance
    : workspaceWheelDistance * .34;
  const previousScroll = gameWorkspace.scrollTop;
  gameWorkspace.scrollTop = Math.max(0, Math.min(maxScroll, previousScroll + step));
  const applied = gameWorkspace.scrollTop - previousScroll;
  workspaceWheelDistance -= applied;

  if (Math.abs(applied) < .01) {
    workspaceWheelDistance = 0;
    return;
  }
  workspaceWheelFrame = requestAnimationFrame(animateWorkspaceWheel);
}

function queueWorkspaceWheel(event) {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? gameWorkspace.clientHeight : 1;
  const pixelDelta = Math.max(-180, Math.min(180, event.deltaY * unit));
  const scale = Math.abs(pixelDelta) < 40 ? .9 : .72;
  const addition = pixelDelta * scale;
  if (workspaceWheelDistance && Math.sign(workspaceWheelDistance) !== Math.sign(addition)) {
    workspaceWheelDistance = 0;
  }
  workspaceWheelDistance = Math.max(-420, Math.min(420, workspaceWheelDistance + addition));
  if (workspaceWheelFrame == null) {
    workspaceWheelFrame = requestAnimationFrame(animateWorkspaceWheel);
  }
}

/* 桌面游戏锁定页面滚动时，鼠标无需悬停右侧框也能滚动档案区。 */
function proxyDesktopWorkspaceWheel(event) {
  if (!gameWorkspace || !document.body.classList.contains("game-scroll-lock")
    || isMobileLayout() || gameScreen.classList.contains("hidden") || !event.deltaY
    || Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.ctrlKey) return;
  const target = event.target instanceof Element ? event.target : null;
  if (target && gameWorkspace.contains(target)) return;
  if (target && target.closest(".modal:not(.hidden), .art-preview:not(.hidden)")) return;
  if (canConsumeWheel(target, event.deltaY)) return;

  const maxScroll = gameWorkspace.scrollHeight - gameWorkspace.clientHeight;
  const canMove = event.deltaY < 0 ? gameWorkspace.scrollTop > 0 : gameWorkspace.scrollTop < maxScroll - 1;
  if (!canMove) return;
  queueWorkspaceWheel(event);
  event.preventDefault();
}

/* ---------- 事件绑定 ---------- */

[topbar, gameMeta, dossierHead].forEach(bindFinishedScrollProxy);
document.addEventListener("wheel", proxyDesktopWorkspaceWheel, { passive: false });
gameWorkspace.addEventListener("scroll", requestQuickGuessVisibilitySync, { passive: true });
window.addEventListener("resize", requestQuickGuessVisibilitySync, { passive: true });
window.addEventListener("resize", syncMobileDataSheetViewport, { passive: true });
window.addEventListener("resize", syncArtPreviewViewport, { passive: true });
window.addEventListener("resize", handleMobileGameViewportResize, { passive: true });
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", syncMobileDataSheetViewport, { passive: true });
  window.visualViewport.addEventListener("scroll", syncMobileDataSheetViewport, { passive: true });
  window.visualViewport.addEventListener("resize", syncArtPreviewViewport, { passive: true });
  window.visualViewport.addEventListener("scroll", syncArtPreviewViewport, { passive: true });
  window.visualViewport.addEventListener("resize", handleMobileGameViewportResize, { passive: true });
  window.visualViewport.addEventListener("scroll", () => syncMobileGuessDock({ realignAnchor: false }), { passive: true });
}
window.addEventListener("scroll", () => syncMobileGuessDock({ realignAnchor: false }), { passive: true });

input.addEventListener("focus", syncMobileGuessDock);

input.addEventListener("input", () => {
  quickInput.value = input.value;
  handleEndlessInputEasterEgg(input.value);
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

quickInput.addEventListener("input", () => {
  input.value = quickInput.value;
  handleEndlessInputEasterEgg(quickInput.value);
  const results = searchNames(quickInput.value);
  if (quickInput.value.trim()) renderQuickSuggest(results);
  else hideQuickSuggest();
});

quickInput.addEventListener("keydown", (e) => {
  if (e.isComposing) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (quickSuggestItems.length) setQuickActive((quickActiveIndex + 1) % quickSuggestItems.length);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (quickSuggestItems.length) setQuickActive((quickActiveIndex - 1 + quickSuggestItems.length) % quickSuggestItems.length);
  } else if (e.key === "Enter") {
    e.preventDefault();
    submitQuickGuess();
  } else if (e.key === "Escape") {
    hideQuickSuggest();
  }
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".input-wrap")) hideSuggest();
  if (!e.target.closest(".topbar-quick-field")) hideQuickSuggest();
});

btn.addEventListener("click", submitGuess);
quickBtn.addEventListener("click", submitQuickGuess);
revealBtn.addEventListener("click", giveUp);
restartBtn.addEventListener("click", () => startGame(currentMode, undefined, { preserveDirectiveHistory: true }));
changeModeBtn.addEventListener("click", showModeScreen);
ingameRestartBtn.addEventListener("click", () => startGame("endless"));
ingameChangeModeBtn.addEventListener("click", showModeScreen);
choiceGiveup.addEventListener("click", giveUpChoice);
revealCancel.addEventListener("click", () => closeRevealConfirm(true));
revealConfirm.addEventListener("click", confirmReveal);
revealModal.addEventListener("click", (e) => {
  if (e.target === revealModal && !revealModal.classList.contains("is-resolving")) closeRevealConfirm(true);
});
directiveDecodeBtn.addEventListener("click", requestClueReveal);
mobileDirectiveDecodeBtn.addEventListener("click", () => {
  if (decodedIntel.length && isMobileLayout()) {
    const clue = decodedIntel[0];
    openMobileDataSheet(clue.title || "已解码情报", "intel", buildIntelCard(clue, false), mobileDirectiveDecodeBtn);
    return;
  }
  requestClueReveal();
});
mobileDataSheetClose.addEventListener("click", () => closeMobileDataSheet(true));
mobileDataSheetBackdrop.addEventListener("click", () => closeMobileDataSheet(true));
artPreviewClose.addEventListener("click", () => closeArtPreview(true));
artPreviewCanvas.addEventListener("wheel", (e) => {
  if (isMobileLayout() || artPreview.classList.contains("hidden") || e.deltaY === 0) return;
  e.preventDefault();
  const bounds = artPreviewCanvas.getBoundingClientRect();
  const cursorX = bounds.width ? ((e.clientX - bounds.left) / bounds.width) * 100 : 50;
  const cursorY = bounds.height ? ((e.clientY - bounds.top) / bounds.height) * 100 : 50;
  const wheelDelta = Math.max(-100, Math.min(100, e.deltaY));
  artPreviewScale = Math.max(1, Math.min(5, artPreviewScale * Math.exp(-wheelDelta * 0.0025)));
  if (artPreviewScale > 1.001) {
    artPreviewOriginX = Math.max(0, Math.min(100, cursorX));
    artPreviewOriginY = Math.max(0, Math.min(100, cursorY));
  } else {
    artPreviewOriginX = 50;
    artPreviewOriginY = 50;
  }
  updateArtPreviewZoom();
}, { passive: false });
artPreviewCanvas.addEventListener("click", closeMobileArtPreviewFromCanvas);
/* 移动端立绘/剪影预览：双指捏合缩放（touch-action:none 已阻止整页缩放，这里手动驱动图像变换）。
   捏合中心作为缩放原点，松手后一次点击仍可关闭预览。 */
let artPreviewPinch = null;
let artPreviewPinchedAt = 0;
artPreviewCanvas.addEventListener("touchstart", (e) => {
  if (!isMobileLayout() || artPreview.classList.contains("hidden")) return;
  if (e.touches.length === 2) {
    const [a, b] = [e.touches[0], e.touches[1]];
    artPreviewPinch = { startDist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), startScale: artPreviewScale };
  }
}, { passive: true });
artPreviewCanvas.addEventListener("touchmove", (e) => {
  if (!isMobileLayout() || artPreview.classList.contains("hidden")) return;
  if (e.touches.length === 2 && artPreviewPinch && artPreviewPinch.startDist > 0) {
    e.preventDefault();
    const [a, b] = [e.touches[0], e.touches[1]];
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    artPreviewScale = Math.max(1, Math.min(5, artPreviewPinch.startScale * (dist / artPreviewPinch.startDist)));
    if (artPreviewScale > 1.001) {
      const bounds = artPreviewCanvas.getBoundingClientRect();
      const cx = (a.clientX + b.clientX) / 2;
      const cy = (a.clientY + b.clientY) / 2;
      artPreviewOriginX = Math.max(0, Math.min(100, bounds.width ? ((cx - bounds.left) / bounds.width) * 100 : 50));
      artPreviewOriginY = Math.max(0, Math.min(100, bounds.height ? ((cy - bounds.top) / bounds.height) * 100 : 50));
    } else {
      artPreviewOriginX = 50;
      artPreviewOriginY = 50;
    }
    artPreviewPinchedAt = performance.now();
    updateArtPreviewZoom();
  }
}, { passive: false });
const endArtPreviewPinch = (e) => { if (e.touches.length < 2) artPreviewPinch = null; };
artPreviewCanvas.addEventListener("touchend", endArtPreviewPinch, { passive: true });
artPreviewCanvas.addEventListener("touchcancel", endArtPreviewPinch, { passive: true });
artPreviewCanvas.addEventListener("dblclick", () => {
  if (!isMobileLayout()) resetArtPreviewZoom();
});
artPreview.addEventListener("click", (e) => {
  if (e.target === artPreview) closeArtPreview(true);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && mobileDataSheet && !mobileDataSheet.classList.contains("hidden")) {
    closeMobileDataSheet(true);
    return;
  }
  if (e.key === "Escape" && !artPreview.classList.contains("hidden")) {
    closeArtPreview(true);
    return;
  }
  if (e.key === "Escape" && !revealModal.classList.contains("hidden") && !revealModal.classList.contains("is-resolving")) {
    closeRevealConfirm(true);
  }
});
modeEndlessBtn.addEventListener("click", () => startEndless());
applySuddenAttempts.addEventListener("click", applySuddenAttemptConfig);
suddenAttemptsMode.addEventListener("change", () => syncSuddenControls(suddenAttemptsMode.value));
suddenAttemptsMode.addEventListener("keydown", (e) => {
  if (e.key === "Enter") startSudden();
});
suddenAttemptsGame.addEventListener("keydown", (e) => {
  if (e.key === "Enter") applySuddenAttemptConfig();
});
suddenAttemptsGame.addEventListener("input", updateAttemptConfigState);

modeSuddenCard.addEventListener("click", (e) => {
  if (e.target.closest(".attempt-control")) return;
  startSudden();
});

[modeSuddenCard, modeEndlessBtn, modeAnomalyCard].forEach((el) => {
  const mode = el === modeSuddenCard ? "sudden" : el === modeEndlessBtn ? "endless" : "anomaly";
  const modeHoverReady = () => !modeScreen.classList.contains("is-mode-sequencing")
    && !modeScreen.classList.contains("is-mode-cards-revealing");
  const resetCardMotion = () => {
    el.style.setProperty("--art-shift-x", "0px");
    el.style.setProperty("--art-shift-y", "0px");
    el.style.setProperty("--glow-x", "50%");
    el.style.setProperty("--glow-y", "38%");
  };
  el.addEventListener("mouseenter", () => {
    if (!modeHoverReady()) return;
    el.classList.add("mode-hover-armed");
    setModePreview(mode);
  });
  el.addEventListener("pointermove", (e) => {
    if (modeHoverReady() && !el.classList.contains("mode-hover-armed")) {
      // 入场期间停在卡片上的指针，在动画结束后发生真实移动时即可激活；静止时仍不会瞬间放大。
      el.classList.add("mode-hover-armed");
      setModePreview(mode);
    }
    if (
      !el.classList.contains("mode-hover-armed")
      || isReducedMotion()
      || !window.matchMedia("(hover: hover) and (pointer: fine)").matches
    ) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    el.style.setProperty("--art-shift-x", ((x - .5) * 12).toFixed(2) + "px");
    el.style.setProperty("--art-shift-y", ((y - .5) * 8).toFixed(2) + "px");
    el.style.setProperty("--glow-x", (x * 100).toFixed(1) + "%");
    el.style.setProperty("--glow-y", (y * 100).toFixed(1) + "%");
  });
  el.addEventListener("focusin", () => {
    if (modeHoverReady()) setModePreview(mode);
  });
  el.addEventListener("mouseleave", () => {
    setModePreview("");
    resetCardMotion();
    el.classList.remove("mode-hover-armed");
  });
  el.addEventListener("focusout", (e) => {
    if (!el.contains(e.relatedTarget)) {
      setModePreview("");
      resetCardMotion();
    }
  });
});

async function startSudden() {
  await startGame("sudden", suddenAttemptsMode.value);
}

async function startEndless() {
  await startGame("endless");
}

/* ==================== 异类审查 ANOMALY AUDIT ==================== */

const ANOMALY_DOMAINS = [
  { id: "mixed", label: "综合审查", labelEn: "FULL AUDIT" },
  { id: "roster", label: "作战编制", labelEn: "ROSTER REVIEW" },
  { id: "identity", label: "身份归属", labelEn: "IDENTITY TRACE" },
  { id: "skill", label: "技能协议", labelEn: "SKILL PROTOCOL" },
  { id: "battle", label: "战术特性", labelEn: "TACTICAL TRAIT" },
  { id: "logistics", label: "后勤履历", labelEn: "LOGISTICS RECORD" },
  { id: "visual", label: "形象档案", labelEn: "VISUAL ARCHIVE" },
];
const ANOMALY_OPTION_LETTERS = ["A", "B", "C", "D"];
const ANOMALY_RATING_TEXT = { S: "完美洞察", A: "精准研判", B: "合格结案", C: "仍需复训" };
const ANOMALY_DIFFICULTIES = {
  trainee: { id: "trainee", label: "基础审查", labelEn: "TRAINEE", scoreMultiplier: 1 },
  standard: { id: "standard", label: "标准审查", labelEn: "STANDARD", scoreMultiplier: 1.5 },
  hazard: { id: "hazard", label: "危机审查", labelEn: "HAZARD", scoreMultiplier: 2.2 },
};
const ANOMALY_ERROR_TEXT = {
  invalid_domain: "审查域配置无效，请重新选择。",
  invalid_session: "审查会话已失效。",
  invalid_phase: "当前状态无法执行该操作。",
  invalid_pick: "该选项不在本题档案中，请重新标记。",
  scan_unavailable: "当前题无法使用扫描器；仅综合审查支持，每题至多一次，初始两次且每三连对奖励一次。",
  question_bank_unavailable: "审查题库暂时不可用，请稍后重试。",
  question_unavailable: "题目数据不可用，请重试。",
  bad_request: "请求格式有误，请重试。",
  request_too_large: "请求体过大，请重试。",
  method_not_allowed: "请求方式不被允许。",
  network: "网络错误，请检查连接后重试。",
};

const anomalyScreen = document.getElementById("anomalyScreen");
const anomalyThemeSelect = document.getElementById("anomalyThemeSelect");
const anomalyThemeGrid = document.getElementById("anomalyThemeGrid");
const anomalyThemeDetails = document.getElementById("anomalyThemeDetails");
const anomalyThemeStatus = document.getElementById("anomalyThemeStatus");
const anomalyThemeStart = document.getElementById("anomalyThemeStart");
const anomalyConsole = document.getElementById("anomalyConsole");
const anomalyOptions = document.getElementById("anomalyOptions");
const anomalyReview = document.getElementById("anomalyReview");
const anomalySummary = document.getElementById("anomalySummary");
const anomalyHint = document.getElementById("anomalyHint");
const anomalyHintTitle = document.getElementById("anomalyHintTitle");
const anomalyHintDesc = document.getElementById("anomalyHintDesc");
const anomalyStatus = document.getElementById("anomalyStatus");
const anomalyAnnounce = document.getElementById("anomalyAnnounce");
const anomalyScanBtn = document.getElementById("anomalyScanBtn");
const anomalyScanState = document.getElementById("anomalyScanState");
const anomalyConfirmBtn = document.getElementById("anomalyConfirmBtn");
const anomalyRestartBtn = document.getElementById("anomalyRestartBtn");
const anomalyChangeModeBtn = document.getElementById("anomalyChangeModeBtn");
const anomalyRetryBtn = document.getElementById("anomalyRetryBtn");
const anomalyErrorHomeBtn = document.getElementById("anomalyErrorHomeBtn");
const anomalyErrorPanel = document.getElementById("anomalyErrorPanel");
const anomalyErrorText = document.getElementById("anomalyErrorText");
const anomalyRound = document.getElementById("anomalyRound");
const anomalyRoundIndex = document.getElementById("anomalyRoundIndex");
const anomalyDomainLabel = document.getElementById("anomalyDomainLabel");
const anomalyDomainEn = document.getElementById("anomalyDomainEn");
const anomalyTimer = document.getElementById("anomalyTimer");
const anomalyMetaConfig = document.getElementById("anomalyMetaConfig");
const anomalyMetaStats = document.getElementById("anomalyMetaStats");
const anomalyScope = document.getElementById("anomalyScope");
const anomalyScopeTheme = document.getElementById("anomalyScopeTheme");
const anomalyScopeItems = document.getElementById("anomalyScopeItems");
const anomalySideScore = document.getElementById("anomalySideScore");
const anomalySideStreak = document.getElementById("anomalySideStreak");
const anomalySideScanner = document.getElementById("anomalySideScanner");
const anomalyDifficultyBadge = document.getElementById("anomalyDifficultyBadge");
const anomaly = {
  token: null,
  config: { domain: "mixed", totalRounds: 10, scannerLimit: 2, scannerRewardEvery: 3 },
  themes: [],
  selectedTheme: "mixed",
  question: null,
  score: 0,
  correctCount: 0,
  streak: 0,
  difficulty: ANOMALY_DIFFICULTIES.standard,
  difficultyProgress: { correct: 0, wrong: 0, correctRequired: 3, wrongRequired: 2 },
  selectedId: null,
  phase: "idle", /* idle | loading | question | submitting | answered | finished */
  busy: false,
  scannerAvailable: true,
  scansRemaining: 2,
  hint: null,
  result: null,
  summary: null,
};
let anomalyTimerInterval = null;
let anomalyTimerStart = 0;
let anomalyWorkspaceIntroTimer = null;

function anomalyErrorMessage(code) {
  return ANOMALY_ERROR_TEXT[code] || ("出错了：" + code);
}

function setAnomalyStatus(msg, isError) {
  anomalyStatus.textContent = msg;
  anomalyStatus.className = "status anomaly-status" + (isError ? " error" : "");
}

function announceAnomaly(text) {
  anomalyAnnounce.textContent = "";
  window.setTimeout(() => { anomalyAnnounce.textContent = text; }, 30);
}

function anomalyDomainName(id) {
  const found = ANOMALY_DOMAINS.find((d) => d.id === id);
  return found ? found.label : id;
}

function stageAnomalyWorkspaceEntry() {
  if (anomalyWorkspaceIntroTimer) window.clearTimeout(anomalyWorkspaceIntroTimer);
  anomalyWorkspaceIntroTimer = null;
  anomalyScreen.classList.remove("is-workspace-entering");
  anomalyScreen.classList.add("is-workspace-staged");
}

function playAnomalyWorkspaceEntry() {
  if (anomalyWorkspaceIntroTimer) window.clearTimeout(anomalyWorkspaceIntroTimer);
  anomalyScreen.classList.remove("is-workspace-entering");
  void anomalyScreen.offsetWidth;
  anomalyScreen.classList.remove("is-workspace-staged");
  anomalyScreen.classList.add("is-workspace-entering");
  anomalyWorkspaceIntroTimer = window.setTimeout(() => {
    anomalyScreen.classList.remove("is-workspace-entering");
    anomalyWorkspaceIntroTimer = null;
  }, 980);
}

function updateAnomalyScope() {
  const theme = anomaly.themes.find((entry) => entry.id === anomaly.config.domain);
  const groups = theme ? (theme.groups || theme.items || []) : [];
  const visible = anomaly.phase !== "idle" && groups.length > 0;
  anomalyScope.classList.toggle("hidden", !visible);
  if (!visible) {
    delete anomalyScope.dataset.key;
    anomalyScopeItems.innerHTML = "";
    return;
  }

  anomalyScopeTheme.textContent = theme.label + (theme.tag ? " · " + theme.tag : "") + " · " + groups.length + " 类";
  const key = theme.id + ":" + groups.map((group) => group.title).join("|");
  if (anomalyScope.dataset.key === key) return;
  anomalyScope.dataset.key = key;
  anomalyScopeItems.innerHTML = "";
  groups.forEach((group, index) => {
    const item = document.createElement("span");
    item.style.setProperty("--d", (index * 45) + "ms");
    item.textContent = group.title;
    anomalyScopeItems.appendChild(item);
  });
}

function stopAnomalyTimer() {
  if (anomalyTimerInterval) window.clearInterval(anomalyTimerInterval);
  anomalyTimerInterval = null;
}

function resetAnomalyState() {
  stopAnomalyTimer();
  anomaly.token = null;
  anomaly.question = null;
  anomaly.score = 0;
  anomaly.correctCount = 0;
  anomaly.streak = 0;
  anomaly.difficulty = ANOMALY_DIFFICULTIES.standard;
  anomaly.difficultyProgress = { correct: 0, wrong: 0, correctRequired: 3, wrongRequired: 2 };
  anomaly.selectedId = null;
  anomaly.phase = "idle";
  anomaly.busy = false;
  anomaly.scannerAvailable = false;
  anomaly.scansRemaining = 0;
  anomaly.hint = null;
  anomaly.result = null;
  anomaly.summary = null;
}

/* 客户端计时仅作展示；计分以服务端 token 内的 startedAt 为准 */
function startAnomalyTimer() {
  stopAnomalyTimer();
  anomalyTimerStart = performance.now();
  anomalyTimer.textContent = "T+00.0s";
  anomalyTimerInterval = window.setInterval(() => {
    const elapsed = Math.min(9999, (performance.now() - anomalyTimerStart) / 1000);
    anomalyTimer.textContent = "T+" + (elapsed < 10 ? "0" : "") + elapsed.toFixed(1) + "s";
  }, 100);
}

/* 同步分数 / 连胜 / 扫描器 / 回合数到侧栏、顶栏与操作按钮 */
function updateAnomalyChrome() {
  anomalySideScore.textContent = String(anomaly.score);
  anomalySideStreak.textContent = "×" + anomaly.streak;
  const mixed = anomaly.config.domain === "mixed";
  const scansRemaining = mixed ? Math.max(0, Number(anomaly.scansRemaining) || 0) : 0;
  anomalySideScanner.textContent = mixed ? "×" + scansRemaining : "N/A";
  anomalySideScanner.classList.toggle("is-used", !mixed || scansRemaining === 0);
  anomalyMetaStats.textContent = "总分 " + anomaly.score + " · 连胜 ×" + anomaly.streak;
  const shownDifficulty = anomaly.question && anomaly.question.difficulty
    ? anomaly.question.difficulty
    : anomaly.difficulty;
  const difficulty = shownDifficulty || ANOMALY_DIFFICULTIES.standard;
  const progress = anomaly.difficultyProgress || {};
  const progressText = Number(progress.wrong) > 0
    ? "↓" + progress.wrong + "/" + (progress.wrongRequired || 2)
    : "↑" + (progress.correct || 0) + "/" + (progress.correctRequired || 3);
  anomalyDifficultyBadge.dataset.level = difficulty.id || "standard";
  anomalyDifficultyBadge.textContent = (difficulty.label || "标准审查") + " // ×" + Number(difficulty.scoreMultiplier || 1.5).toFixed(2) + " · " + progressText;
  anomalyDifficultyBadge.title = "连续答对 " + (progress.correctRequired || 3) + " 次升级，连续答错 " + (progress.wrongRequired || 2) + " 次降级";
  const total = anomaly.config.totalRounds || 10;
  const round = anomaly.question ? anomaly.question.round : 0;
  anomalyRound.textContent = "FILE " + (round ? String(round).padStart(2, "0") : "--") + "/" + total;
  anomalyRoundIndex.textContent = String(round || 1).padStart(2, "0");
  anomalyMetaConfig.textContent = anomaly.phase === "idle"
    ? "请选择审查主题"
    : anomalyDomainName(anomaly.config.domain) + (mixed ? " · 高难" : "");
  anomalyScanBtn.disabled = !(anomaly.scannerAvailable && anomaly.phase === "question" && !anomaly.busy);
  anomalyScanBtn.classList.toggle("is-used", !mixed || scansRemaining === 0);
  if (!mixed) anomalyScanState.textContent = "单域审查 · 不支持";
  else if (anomaly.scannerAvailable) anomalyScanState.textContent = "可用 " + scansRemaining + " 次 · READY";
  else if (anomaly.phase === "question" && scansRemaining > 0) anomalyScanState.textContent = "本题已用 · 库存 " + scansRemaining + " 次";
  else anomalyScanState.textContent = "库存 " + scansRemaining + " 次 · 三连对 +1";
  anomalyConfirmBtn.disabled = !(anomaly.phase === "question" && !anomaly.busy && anomaly.selectedId);
  updateAnomalyScope();
}

function setAnomalyOptionsBusy(busy) {
  anomalyOptions.querySelectorAll(".anomaly-option").forEach((card) => { card.disabled = busy; });
  anomaly.busy = busy;
  updateAnomalyChrome();
}

function renderAnomalyLoading() {
  anomaly.phase = "loading";
  anomalyConsole.classList.remove("hidden");
  anomalyReview.classList.add("hidden");
  anomalyReview.innerHTML = "";
  anomalySummary.classList.add("hidden");
  anomalyErrorPanel.classList.add("hidden");
  anomalyHint.classList.add("hidden");
  anomalyDomainLabel.textContent = "档案装载中";
  anomalyDomainEn.textContent = "ARCHIVE LOADING";
  anomalyOptions.classList.remove("is-resolving", "is-reviewed");
  anomalyOptions.innerHTML = "";
  for (let i = 0; i < 4; i++) {
    const skeleton = document.createElement("span");
    skeleton.className = "anomaly-option is-skeleton";
    skeleton.style.setProperty("--d", (i * 70) + "ms");
    skeleton.setAttribute("aria-hidden", "true");
    anomalyOptions.appendChild(skeleton);
  }
  setAnomalyStatus("正在装载审查档案……");
  updateAnomalyChrome();
}

function showAnomalyError(code) {
  stopAnomalyTimer();
  anomaly.phase = "idle";
  anomaly.busy = false;
  anomalyConsole.classList.add("hidden");
  anomalyReview.classList.add("hidden");
  anomalySummary.classList.add("hidden");
  anomalyErrorPanel.classList.remove("hidden");
  anomalyErrorText.textContent = anomalyErrorMessage(code);
  updateAnomalyChrome();
  announceAnomaly("审查链路中断：" + anomalyErrorMessage(code));
  anomalyRetryBtn.focus({ preventScroll: true });
}

function renderAnomalyThemeDetails(theme) {
  anomalyThemeDetails.innerHTML = "";
  if (!theme) return;

  const head = document.createElement("header");
  const code = document.createElement("span");
  code.className = "anomaly-theme-detail-code";
  code.textContent = theme.labelEn;
  const title = document.createElement("h3");
  const titleText = document.createElement("span");
  titleText.textContent = theme.label;
  title.appendChild(titleText);
  if (theme.tag) {
    const riskTag = document.createElement("span");
    riskTag.className = "anomaly-theme-risk-tag";
    riskTag.setAttribute("aria-label", theme.tag + "主题");
    const riskSignal = document.createElement("i");
    riskSignal.setAttribute("aria-hidden", "true");
    const riskText = document.createElement("b");
    riskText.textContent = theme.tag + " // HIGH RISK";
    riskTag.appendChild(riskSignal);
    riskTag.appendChild(riskText);
    title.appendChild(riskTag);
  }
  const meta = document.createElement("p");
  meta.textContent = theme.id === "mixed"
    ? "六域混合 · 初始扫描 2 次 · 每三连对 +1"
    : "单域定向题库 · 共性扫描不适用";
  head.appendChild(code);
  head.appendChild(title);
  head.appendChild(meta);
  anomalyThemeDetails.appendChild(head);

  const caption = document.createElement("p");
  caption.className = "anomaly-theme-detail-caption";
  caption.textContent = theme.id === "mixed"
    ? "本主题将从以下六个审查域混合抽取十份档案"
    : "本主题当前题库涵盖以下大类";
  anomalyThemeDetails.appendChild(caption);

  const list = document.createElement("ol");
  list.className = "anomaly-theme-detail-list";
  (theme.groups || theme.items || []).forEach((item, index) => {
    const row = document.createElement("li");
    const number = document.createElement("span");
    number.textContent = String(index + 1).padStart(2, "0");
    const copy = document.createElement("div");
    const itemTitle = document.createElement("strong");
    itemTitle.textContent = item.title;
    const itemDesc = document.createElement("small");
    itemDesc.textContent = item.description || "已纳入审查题库";
    copy.appendChild(itemTitle);
    copy.appendChild(itemDesc);
    if (item.countLabel) {
      const itemCount = document.createElement("span");
      itemCount.className = "anomaly-theme-detail-count";
      itemCount.textContent = item.countLabel;
      copy.appendChild(itemCount);
    }
    row.appendChild(number);
    row.appendChild(copy);
    list.appendChild(row);
  });
  anomalyThemeDetails.appendChild(list);
}

function selectAnomalyTheme(domain) {
  const theme = anomaly.themes.find((entry) => entry.id === domain);
  if (!theme) return;
  anomaly.selectedTheme = theme.id;
  anomalyThemeGrid.querySelectorAll(".anomaly-theme-card").forEach((card) => {
    const selected = card.dataset.domain === theme.id;
    card.classList.toggle("is-selected", selected);
    card.setAttribute("aria-selected", selected ? "true" : "false");
  });
  renderAnomalyThemeDetails(theme);
  anomalyThemeStatus.textContent = "已选择 " + theme.label + (theme.tag ? " · " + theme.tag : "") + " · 覆盖 " + (theme.groupCount || (theme.groups || []).length) + " 类题库";
  anomalyThemeStart.disabled = false;
}

function renderAnomalyThemeCatalog() {
  anomalyThemeGrid.innerHTML = "";
  anomaly.themes.forEach((theme, index) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "anomaly-theme-card";
    card.dataset.domain = theme.id;
    card.setAttribute("role", "option");
    card.setAttribute("aria-selected", "false");

    const indexEl = document.createElement("span");
    indexEl.className = "anomaly-theme-card-index";
    indexEl.textContent = String(index + 1).padStart(2, "0");
    const copy = document.createElement("span");
    copy.className = "anomaly-theme-card-copy";
    const label = document.createElement("strong");
    label.textContent = theme.label;
    const labelEn = document.createElement("small");
    labelEn.textContent = theme.labelEn;
    copy.appendChild(label);
    copy.appendChild(labelEn);
    const count = document.createElement("span");
    count.className = "anomaly-theme-card-count";
    if (theme.tag) {
      const tag = document.createElement("em");
      tag.textContent = theme.tag;
      count.appendChild(tag);
    }
    count.appendChild(document.createTextNode(theme.itemCount + " 项"));
    card.appendChild(indexEl);
    card.appendChild(copy);
    card.appendChild(count);
    card.addEventListener("click", () => selectAnomalyTheme(theme.id));
    anomalyThemeGrid.appendChild(card);
  });
  const preferred = anomaly.themes.some((theme) => theme.id === anomaly.selectedTheme)
    ? anomaly.selectedTheme
    : "mixed";
  selectAnomalyTheme(preferred);
}

async function openAnomalyThemeSelect(preferredDomain) {
  cancelModeScreenFocus();
  const startSequence = ++gameStartSequence;
  const fromModeScreen = !modeScreen.classList.contains("hidden");
  if (preferredDomain) anomaly.selectedTheme = preferredDomain;
  resetAnomalyState();
  currentMode = "anomaly";
  anomaly.config = { domain: anomaly.selectedTheme, totalRounds: 10, scannerLimit: anomaly.selectedTheme === "mixed" ? 2 : 0, scannerRewardEvery: anomaly.selectedTheme === "mixed" ? 3 : 0 };
  anomaly.scansRemaining = anomaly.config.scannerLimit;
  document.body.dataset.mode = "anomaly";
  updateHudTags("anomaly");
  setModeLaunching("anomaly", fromModeScreen);
  anomalyThemeStart.disabled = true;
  anomalyThemeStatus.className = "status";
  anomalyThemeStatus.textContent = "正在读取审查题库目录……";
  anomalyThemeGrid.innerHTML = "";
  anomalyThemeDetails.innerHTML = "";
  const transition = playWipe();
  const dataRequest = fetchJSON("/api/anomaly/themes").catch(() => ({ error: "network" }));
  await transition.covered;
  if (startSequence !== gameStartSequence) return;
  modeScreen.classList.add("hidden");
  gameScreen.classList.add("hidden");
  gameScreen.classList.remove("mobile-fixed-viewport-root");
  document.body.classList.remove("game-scroll-lock", "mobile-record-active", "mobile-game-finished", "quick-guess-active");
  clearMobileGameViewport();
  document.body.classList.add("anomaly-scroll-lock");
  stageAnomalyWorkspaceEntry();
  anomalyScreen.classList.remove("hidden");
  anomalyScreen.classList.add("is-theme-selecting");
  anomalyThemeSelect.classList.remove("hidden");
  anomalyConsole.classList.add("hidden");
  anomalyReview.classList.add("hidden");
  anomalySummary.classList.add("hidden");
  anomalyErrorPanel.classList.add("hidden");
  updateAnomalyChrome();
  window.scrollTo(0, 0);
  const data = await dataRequest;
  if (transition) await transition.finished;
  if (startSequence !== gameStartSequence) return;
  setModeLaunching("anomaly", false);
  playAnomalyWorkspaceEntry();
  if (!data || data.error || !Array.isArray(data.themes) || !data.themes.length) {
    anomalyThemeStatus.className = "status error";
    anomalyThemeStatus.textContent = anomalyErrorMessage(data && data.error ? data.error : "question_bank_unavailable");
    anomalyThemeDetails.textContent = "题库目录读取失败，请返回模式页后重试。";
    return;
  }
  anomaly.themes = data.themes;
  renderAnomalyThemeCatalog();
  const selectedCard = anomalyThemeGrid.querySelector(".anomaly-theme-card.is-selected");
  if (selectedCard) selectedCard.focus({ preventScroll: true });
}

async function startAnomaly(domain) {
  cancelModeScreenFocus();
  const startSequence = ++gameStartSequence;
  const selectedDomain = domain || anomaly.selectedTheme || "mixed";
  const theme = anomaly.themes.find((entry) => entry.id === selectedDomain);
  resetAnomalyState();
  currentMode = "anomaly";
  anomaly.selectedTheme = selectedDomain;
  anomaly.config = {
    domain: selectedDomain,
    totalRounds: 10,
    scannerLimit: theme ? theme.scannerLimit : (selectedDomain === "mixed" ? 2 : 0),
    scannerRewardEvery: theme ? (theme.scannerRewardEvery || 0) : (selectedDomain === "mixed" ? 3 : 0),
  };
  anomaly.scansRemaining = anomaly.config.scannerLimit;
  anomaly.phase = "loading";
  document.body.dataset.mode = "anomaly";
  updateHudTags("anomaly");
  const transition = playWipe();
  const dataRequest = fetchJSON("/api/anomaly/new?domain=" + encodeURIComponent(selectedDomain))
    .catch(() => ({ error: "network" }));
  await transition.covered;
  if (startSequence !== gameStartSequence) return;
  modeScreen.classList.add("hidden");
  gameScreen.classList.add("hidden");
  gameScreen.classList.remove("mobile-fixed-viewport-root");
  document.body.classList.remove("game-scroll-lock", "mobile-record-active", "mobile-game-finished", "quick-guess-active");
  clearMobileGameViewport();
  document.body.classList.add("anomaly-scroll-lock");
  stageAnomalyWorkspaceEntry();
  anomalyScreen.classList.remove("hidden");
  anomalyScreen.classList.remove("is-theme-selecting");
  anomalyThemeSelect.classList.add("hidden");
  window.scrollTo(0, 0);
  renderAnomalyLoading();
  const data = await dataRequest;
  if (startSequence !== gameStartSequence) return;
  if (transition) await transition.finished;
  if (startSequence !== gameStartSequence) return;
  playAnomalyWorkspaceEntry();
  if (!data || data.error) {
    showAnomalyError(data && data.error ? data.error : "network");
    return;
  }
  anomaly.token = data.token;
  anomaly.score = Number(data.score) || 0;
  anomaly.correctCount = Number(data.correctCount) || 0;
  anomaly.streak = Number(data.streak) || 0;
  anomaly.scansRemaining = Number.isFinite(data.scansRemaining) ? data.scansRemaining : anomaly.scansRemaining;
  if (data.difficulty) anomaly.difficulty = data.difficulty;
  if (data.difficultyProgress) anomaly.difficultyProgress = data.difficultyProgress;
  if (data.config) anomaly.config = data.config;
  applyAnomalyQuestion(data.question);
}

function renderAnomalyOptions(options) {
  anomalyOptions.innerHTML = "";
  anomalyOptions.classList.remove("is-resolving", "is-reviewed");
  options.forEach((option, index) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "anomaly-option";
    card.dataset.id = option.id;
    card.dataset.label = ANOMALY_OPTION_LETTERS[index] + " · " + option.name;
    card.setAttribute("aria-pressed", "false");
    card.setAttribute("aria-label", card.dataset.label + "，标记为异类");
    card.style.setProperty("--d", (index * 55) + "ms");

    const art = document.createElement("span");
    art.className = "anomaly-option-art";
    const image = document.createElement("img");
    image.src = option.imageUrl || artUrl(option.id, false);
    image.alt = option.name + (option.artKind === "skin" ? " 时装立绘" : " 精英一阶段立绘");
    image.decoding = "async";
    image.addEventListener("error", () => art.classList.add("image-missing"));
    const scan = document.createElement("span");
    scan.className = "anomaly-option-scan";
    scan.setAttribute("aria-hidden", "true");
    art.appendChild(image);
    art.appendChild(scan);

    const foot = document.createElement("span");
    foot.className = "anomaly-option-foot";
    const indexTag = document.createElement("span");
    indexTag.className = "anomaly-option-index";
    indexTag.textContent = ANOMALY_OPTION_LETTERS[index];
    const name = document.createElement("strong");
    name.className = "anomaly-option-name";
    name.textContent = option.name;
    const mark = document.createElement("span");
    mark.className = "anomaly-option-mark";
    mark.textContent = "已标记";
    foot.appendChild(indexTag);
    foot.appendChild(name);
    foot.appendChild(mark);

    const verdict = document.createElement("span");
    verdict.className = "anomaly-option-verdict";
    const evidence = document.createElement("span");
    evidence.className = "anomaly-option-evidence";

    card.appendChild(art);
    card.appendChild(foot);
    card.appendChild(verdict);
    card.appendChild(evidence);
    card.addEventListener("click", () => onAnomalyCardActivate(card));
    anomalyOptions.appendChild(card);
  });
}

function applyAnomalyQuestion(question) {
  if (!question || !Array.isArray(question.options) || question.options.length !== 4) {
    showAnomalyError("question_unavailable");
    return;
  }
  anomaly.question = question;
  anomaly.difficulty = question.difficulty || anomaly.difficulty;
  anomaly.phase = "question";
  anomaly.selectedId = null;
  anomaly.hint = null;
  anomaly.result = null;
  anomaly.scannerAvailable = Boolean(question.scannerAvailable);
  if (Number.isFinite(question.scansRemaining)) anomaly.scansRemaining = question.scansRemaining;
  anomalyConsole.classList.remove("hidden");
  anomalyErrorPanel.classList.add("hidden");
  anomalyReview.classList.add("hidden");
  anomalyReview.innerHTML = "";
  anomalySummary.classList.add("hidden");
  anomalyHint.classList.add("hidden");
  const domain = question.domain || { label: "综合审查", labelEn: "FULL AUDIT" };
  anomalyDomainLabel.textContent = domain.label;
  anomalyDomainEn.textContent = domain.labelEn;
  renderAnomalyOptions(question.options);
  setAnomalyStatus("第 " + question.round + " 份档案已装载，标记异类后点击「确认异类」提交。");
  updateAnomalyChrome();
  startAnomalyTimer();
  announceAnomaly("第 " + question.round + " 份档案，共 " + question.totalRounds + " 份，审查域：" + domain.label + "，审查强度：" + (question.difficulty ? question.difficulty.label : "标准审查") + "。候选干员：" + question.options.map((o) => o.name).join("，") + "。");
  if (!isMobileLayout()) {
    const first = anomalyOptions.querySelector(".anomaly-option");
    if (first) first.focus({ preventScroll: true });
  }
}

/* 选择只改变标记态；真正的提交走「确认异类」按钮 */
function toggleAnomalySelection(id) {
  if (anomaly.phase !== "question" || anomaly.busy) return;
  anomaly.selectedId = anomaly.selectedId === id ? null : id;
  anomalyOptions.querySelectorAll(".anomaly-option").forEach((card) => {
    const selected = card.dataset.id === anomaly.selectedId;
    card.classList.toggle("is-selected", selected);
    card.setAttribute("aria-pressed", selected ? "true" : "false");
    card.setAttribute("aria-label", card.dataset.label + (selected ? "，已标记为异类，再次点击取消" : "，标记为异类"));
  });
  const picked = anomaly.selectedId && anomaly.question
    ? (anomaly.question.options.find((o) => o.id === anomaly.selectedId) || {}).name
    : null;
  setAnomalyStatus(picked ? "已标记 " + picked + "，点击「确认异类」提交判定。" : "已取消标记。");
  updateAnomalyChrome();
}

/* 揭示态下卡片不再可选，点击改为查看立绘大图 */
function onAnomalyCardActivate(card) {
  const id = card.dataset.id;
  if (anomaly.phase === "question") {
    toggleAnomalySelection(id);
    return;
  }
  if ((anomaly.phase === "answered" || anomaly.phase === "finished") && anomaly.question) {
    const art = card.querySelector(".anomaly-option-art");
    const image = card.querySelector("img");
    const option = anomaly.question.options.find((o) => o.id === id);
    if (art && image && option && !art.classList.contains("image-missing")) {
      openArtPreview(image, option.name, option.artKind === "skin" ? "时装立绘" : "精英一阶段立绘", card);
    }
  }
}

async function useAnomalyScanner() {
  if (anomaly.phase !== "question" || anomaly.busy || !anomaly.scannerAvailable || !anomaly.token) return;
  const startSequence = gameStartSequence;
  anomaly.busy = true;
  updateAnomalyChrome();
  setAnomalyStatus("扫描器运行中，正在比对三人共性……");
  try {
    const data = await fetchJSON("/api/anomaly/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: anomaly.token }),
    }).catch(() => ({ error: "network" }));
    if (startSequence !== gameStartSequence) return;
    if (data.error === "invalid_session") {
      showAnomalyError("invalid_session");
      return;
    }
    if (data.error) {
      setAnomalyStatus(anomalyErrorMessage(data.error), true);
      return;
    }
    anomaly.token = data.token;
    anomaly.scannerAvailable = Boolean(data.scannerAvailable);
    if (Number.isFinite(data.scansRemaining)) anomaly.scansRemaining = data.scansRemaining;
    anomaly.hint = data.hint || null;
    if (Number.isFinite(data.score)) anomaly.score = data.score;
    if (Number.isFinite(data.streak)) anomaly.streak = data.streak;
    renderAnomalyHint();
    setAnomalyStatus("共性规则已公开，本题得分将以 60% 结算。");
    announceAnomaly("扫描完成。共性规则：" + (anomaly.hint ? anomaly.hint.title : "") + "。本题得分将以 60% 结算。");
  } finally {
    if (startSequence === gameStartSequence) {
      anomaly.busy = false;
      updateAnomalyChrome();
    }
  }
}

function renderAnomalyHint() {
  if (!anomaly.hint) return;
  anomalyHintTitle.textContent = anomaly.hint.title || "共性规则";
  anomalyHintDesc.textContent = anomaly.hint.description || "";
  anomalyHint.classList.remove("hidden");
  if (isMobileLayout()) {
    window.requestAnimationFrame(() => {
      if (!anomalyHint.classList.contains("hidden")) {
        anomalyHint.scrollIntoView({ behavior: isReducedMotion() ? "auto" : "smooth", block: "center" });
      }
    });
  }
}

async function confirmAnomaly() {
  if (anomaly.phase !== "question" || anomaly.busy || !anomaly.selectedId || !anomaly.token) return;
  const startSequence = gameStartSequence;
  anomaly.phase = "submitting";
  anomalyOptions.classList.add("is-resolving");
  setAnomalyOptionsBusy(true);
  setAnomalyStatus("正在提交判定……");
  /* 等待一次横向审查扫描完成后再揭示证据，避免界面瞬跳 */
  const sweepDone = new Promise((resolve) => window.setTimeout(resolve, isReducedMotion() ? 30 : 700));
  const request = fetchJSON("/api/anomaly/answer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: anomaly.token, pickId: anomaly.selectedId }),
  }).catch(() => ({ error: "network" }));
  const [data] = await Promise.all([request, sweepDone]);
  if (startSequence !== gameStartSequence) return;
  if (data.error === "invalid_session") {
    showAnomalyError("invalid_session");
    return;
  }
  if (data.error) {
    anomaly.phase = "question";
    anomalyOptions.classList.remove("is-resolving");
    setAnomalyOptionsBusy(false);
    setAnomalyStatus(anomalyErrorMessage(data.error), true);
    return;
  }
  stopAnomalyTimer();
  anomaly.token = data.token;
  anomaly.score = Number(data.score) || 0;
  anomaly.correctCount = Number(data.correctCount) || 0;
  anomaly.streak = Number(data.streak) || 0;
  if (data.difficulty) anomaly.difficulty = data.difficulty;
  if (data.difficultyProgress) anomaly.difficultyProgress = data.difficultyProgress;
  if (Number.isFinite(data.scansRemaining)) anomaly.scansRemaining = data.scansRemaining;
  anomaly.result = data.result;
  anomaly.summary = data.summary || null;
  anomaly.phase = "answered";
  anomaly.busy = false;
  renderAnomalyReview(data);
  updateAnomalyChrome();
}

function anomalyPointChip(label, value, extraClass) {
  const chip = document.createElement("span");
  chip.className = "anomaly-point" + (extraClass ? " " + extraClass : "");
  const labelEl = document.createElement("i");
  labelEl.textContent = label;
  const valueEl = document.createElement("b");
  valueEl.textContent = value;
  chip.appendChild(labelEl);
  chip.appendChild(valueEl);
  return chip;
}

function renderAnomalyReview(data) {
  const result = data.result;
  const evidenceById = {};
  (result.evidence || []).forEach((item) => { evidenceById[item.id] = item; });
  anomalyOptions.classList.remove("is-resolving");
  anomalyOptions.classList.add("is-reviewed");
  anomalyOptions.querySelectorAll(".anomaly-option").forEach((card, index) => {
    const id = card.dataset.id;
    const isOdd = id === result.oddId;
    const isChosen = id === result.chosenId;
    card.disabled = false;
    card.classList.remove("is-selected");
    card.classList.add(isOdd ? "is-odd" : "is-common");
    if (isChosen) card.classList.add("is-chosen", result.correct ? "is-hit" : "is-miss");
    card.setAttribute("aria-pressed", "false");
    card.style.setProperty("--d", (index * 70) + "ms");
    const verdict = card.querySelector(".anomaly-option-verdict");
    const verdictTag = document.createElement("b");
    verdictTag.textContent = isOdd ? "异类 ANOMALY" : "符合 COMMON";
    verdict.appendChild(verdictTag);
    if (isChosen) {
      const pickTag = document.createElement("i");
      pickTag.textContent = result.correct ? "你的选择 ✓" : "你的选择 ✗";
      verdict.appendChild(pickTag);
    }
    const item = evidenceById[id];
    const evidence = card.querySelector(".anomaly-option-evidence");
    evidence.textContent = item ? item.value : "";
    card.setAttribute("aria-label", card.dataset.label + (isOdd ? "，本题异类" : "，符合共性") + (item ? "，档案值：" + item.value : "") + "，点击查看立绘大图");
  });

  anomalyReview.innerHTML = "";
  anomalyReview.classList.toggle("is-wrong-result", !result.correct);

  const head = document.createElement("header");
  head.className = "anomaly-review-head";
  const verdictEl = document.createElement("span");
  verdictEl.className = "anomaly-verdict " + (result.correct ? "is-correct" : "is-wrong");
  verdictEl.textContent = result.correct ? "判定正确 // VERDICT PASS" : "判定偏差 // VERDICT MISS";
  const domainEl = document.createElement("span");
  domainEl.className = "anomaly-review-domain";
  const domain = anomaly.question.domain || { label: "综合审查", labelEn: "FULL AUDIT" };
  domainEl.textContent = domain.label + " · " + domain.labelEn;
  head.appendChild(verdictEl);
  head.appendChild(domainEl);
  anomalyReview.appendChild(head);

  const ruleBox = document.createElement("div");
  ruleBox.className = "anomaly-review-rule";
  const ruleTag = document.createElement("span");
  ruleTag.className = "anomaly-rule-tag";
  ruleTag.textContent = "共性规则 // COMMON RULE";
  const ruleTitle = document.createElement("h3");
  ruleTitle.textContent = result.rule.title;
  const ruleDesc = document.createElement("p");
  ruleDesc.textContent = result.rule.description;
  ruleBox.appendChild(ruleTag);
  ruleBox.appendChild(ruleTitle);
  ruleBox.appendChild(ruleDesc);
  anomalyReview.appendChild(ruleBox);

  if (Array.isArray(result.supportingRules) && result.supportingRules.length) {
    const supportBox = document.createElement("div");
    supportBox.className = "anomaly-supporting";
    const supportTag = document.createElement("span");
    supportTag.className = "anomaly-rule-tag";
    supportTag.textContent = "次级符合项 // ALSO SATISFIES";
    const supportList = document.createElement("ul");
    result.supportingRules.forEach((rule) => {
      const li = document.createElement("li");
      const liTitle = document.createElement("strong");
      liTitle.textContent = rule.title;
      const liDesc = document.createElement("span");
      liDesc.textContent = rule.description;
      li.appendChild(liTitle);
      li.appendChild(liDesc);
      supportList.appendChild(li);
    });
    supportBox.appendChild(supportTag);
    supportBox.appendChild(supportList);
    anomalyReview.appendChild(supportBox);
  }

  const points = result.points || { base: 0, timeBonus: 0, streakMultiplier: 1, hintMultiplier: 1, total: 0 };
  const pointsBox = document.createElement("div");
  pointsBox.className = "anomaly-points";
  const roundDifficulty = result.difficulty || ANOMALY_DIFFICULTIES.standard;
  pointsBox.appendChild(anomalyPointChip("LEVEL 难度", roundDifficulty.label + " ×" + Number(roundDifficulty.scoreMultiplier || 1).toFixed(2)));
  pointsBox.appendChild(anomalyPointChip("BASE 基础", String(points.base)));
  pointsBox.appendChild(anomalyPointChip("TIME 时间", "+" + points.timeBonus));
  pointsBox.appendChild(anomalyPointChip("STREAK 连胜", "×" + Number(points.streakMultiplier).toFixed(2)));
  if (points.hintMultiplier !== 1) {
    pointsBox.appendChild(anomalyPointChip("SCAN 扫描", "×" + points.hintMultiplier));
  }
  if (Number(result.scannerReward) > 0) {
    pointsBox.appendChild(anomalyPointChip("STREAK REWARD", "+1 扫描", "is-reward"));
  }
  if (result.difficultyChange) {
    const nextDifficulty = result.nextDifficulty || roundDifficulty;
    pointsBox.appendChild(anomalyPointChip(
      result.difficultyChange > 0 ? "LEVEL UP 强度提升" : "LEVEL DOWN 强度回落",
      nextDifficulty.label + (result.difficultyChange > 0 ? " ↗" : " ↘"),
      result.difficultyChange > 0 ? "is-reward" : "is-level-down"
    ));
  }
  pointsBox.appendChild(anomalyPointChip("ELAPSED 用时", (Number(result.elapsedMs) / 1000).toFixed(1) + "s"));
  pointsBox.appendChild(anomalyPointChip("TOTAL 本题得分", "+" + points.total, "is-total"));
  anomalyReview.appendChild(pointsBox);

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "anomaly-next";
  const nextLabel = document.createElement("span");
  nextLabel.textContent = data.finished ? "查看审查结论" : "下一份档案";
  const nextArrow = document.createElement("i");
  nextArrow.setAttribute("aria-hidden", "true");
  nextArrow.textContent = "↗";
  nextBtn.appendChild(nextLabel);
  nextBtn.appendChild(nextArrow);
  nextBtn.addEventListener("click", () => {
    if (data.finished) showAnomalySummary();
    else nextAnomalyRound();
  });
  anomalyReview.appendChild(nextBtn);
  anomalyReview.classList.remove("hidden");

  const oddEntry = (result.evidence || []).find((item) => item.id === result.oddId) || {};
  const oddName = oddEntry.name || "";
  const difficultyNotice = result.difficultyChange > 0
    ? " 审查强度提升，下题进入" + result.nextDifficulty.label + "。"
    : result.difficultyChange < 0 ? " 审查强度回落，下题进入" + result.nextDifficulty.label + "。" : "";
  setAnomalyStatus(result.correct
    ? "判定正确，本题 +" + points.total + " 分。" + (result.scannerReward ? " 三连判定达成，获得 1 次共性扫描。" : "") + difficultyNotice
    : "判定偏差，异类是 " + oddName + "，本题不得分，连胜清零。" + difficultyNotice, !result.correct);
  announceAnomaly((result.correct ? "判定正确。" : "判定偏差，异类是 " + oddName + "。") + "共性规则：" + result.rule.title + "。本题得分 " + points.total + "。" + (result.scannerReward ? "三连判定达成，获得一次共性扫描。" : "") + difficultyNotice);
  anomalyReview.focus({ preventScroll: true });
  window.setTimeout(() => {
    anomalyReview.scrollIntoView({ behavior: isReducedMotion() ? "auto" : "smooth", block: "nearest" });
  }, 60);
}

async function nextAnomalyRound() {
  if (anomaly.phase !== "answered" || anomaly.busy || !anomaly.token) return;
  const startSequence = gameStartSequence;
  anomaly.busy = true;
  updateAnomalyChrome();
  setAnomalyStatus("正在装载下一份档案……");
  try {
    const data = await fetchJSON("/api/anomaly/next", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: anomaly.token }),
    }).catch(() => ({ error: "network" }));
    if (startSequence !== gameStartSequence) return;
    if (data.error === "invalid_session") {
      showAnomalyError("invalid_session");
      return;
    }
    if (data.error) {
      setAnomalyStatus(anomalyErrorMessage(data.error), true);
      return;
    }
    anomaly.token = data.token;
    anomaly.score = Number(data.score) || 0;
    anomaly.correctCount = Number(data.correctCount) || 0;
    anomaly.streak = Number(data.streak) || 0;
    if (data.difficulty) anomaly.difficulty = data.difficulty;
    if (data.difficultyProgress) anomaly.difficultyProgress = data.difficultyProgress;
    if (Number.isFinite(data.scansRemaining)) anomaly.scansRemaining = data.scansRemaining;
    applyAnomalyQuestion(data.question);
  } finally {
    if (startSequence === gameStartSequence) {
      anomaly.busy = false;
      updateAnomalyChrome();
    }
  }
}

function showAnomalySummary() {
  const summary = anomaly.summary;
  if (!summary) return;
  anomaly.phase = "finished";
  stopAnomalyTimer();
  anomalyConsole.classList.add("hidden");
  anomalyReview.classList.add("hidden");
  anomalyHint.classList.add("hidden");
  anomalySummary.innerHTML = "";
  const totalRounds = anomaly.config.totalRounds || 10;

  const art = document.createElement("div");
  art.className = "anomaly-summary-art";
  art.setAttribute("aria-hidden", "true");
  const mlyss = document.createElement("img");
  mlyss.className = "anomaly-summary-mlyss";
  mlyss.src = "img/operators/final/char_249_mlyss.webp";
  mlyss.alt = "";
  const rhine = document.createElement("img");
  rhine.className = "anomaly-summary-rhine";
  rhine.src = "img/factions/rhine.webp";
  rhine.alt = "";
  art.appendChild(mlyss);
  art.appendChild(rhine);
  anomalySummary.appendChild(art);

  const inner = document.createElement("div");
  inner.className = "anomaly-summary-inner";

  const en = document.createElement("span");
  en.className = "anomaly-summary-en";
  en.textContent = "AUDIT COMPLETE // RHINE LAB ECOLOGICAL SECTION";
  inner.appendChild(en);

  const rating = document.createElement("div");
  rating.className = "anomaly-rating";
  const letter = document.createElement("span");
  letter.className = "anomaly-rating-letter";
  letter.textContent = summary.rating || "C";
  const ratingText = document.createElement("div");
  ratingText.className = "anomaly-rating-text";
  const ratingTitle = document.createElement("strong");
  ratingTitle.textContent = ANOMALY_RATING_TEXT[summary.rating] || "审查结案";
  const ratingSub = document.createElement("small");
  ratingSub.textContent = anomalyDomainName(anomaly.config.domain) + " · 评级指数 " + (summary.ratingIndex || 0) + " · 挑战指数 " + (summary.challengeIndex || 0);
  ratingText.appendChild(ratingTitle);
  ratingText.appendChild(ratingSub);
  rating.appendChild(letter);
  rating.appendChild(ratingText);
  inner.appendChild(rating);

  const stats = document.createElement("div");
  stats.className = "anomaly-summary-stats";
  [
    ["总分", String(summary.score)],
    ["正确", summary.correctCount + "/" + totalRounds],
    ["准确率", summary.accuracy + "%"],
    ["评级指数", String(summary.ratingIndex || 0)],
    ["最高难度", (ANOMALY_DIFFICULTIES[summary.highestDifficulty] || ANOMALY_DIFFICULTIES.standard).label],
    ["平均用时", (Number(summary.averageElapsedMs) / 1000).toFixed(1) + "s"],
    ["最高连胜", "×" + summary.maxStreak],
  ].forEach(([label, value]) => {
    const cell = document.createElement("p");
    cell.className = "anomaly-stat";
    const cellLabel = document.createElement("span");
    cellLabel.textContent = label;
    const cellValue = document.createElement("strong");
    cellValue.textContent = value;
    cell.appendChild(cellLabel);
    cell.appendChild(cellValue);
    stats.appendChild(cell);
  });
  inner.appendChild(stats);

  const difficultyEntries = Object.values(summary.difficulties || {}).filter((entry) => entry.answered > 0);
  if (difficultyEntries.length) {
    const difficultyBox = document.createElement("div");
    difficultyBox.className = "anomaly-summary-domains anomaly-summary-difficulties";
    const difficultyTitle = document.createElement("h3");
    difficultyTitle.textContent = "难度履历 // DIFFICULTY RECORD · 评级 = 准确率 55% + 挑战指数 45%";
    difficultyBox.appendChild(difficultyTitle);
    const list = document.createElement("ul");
    difficultyEntries.forEach((entry) => {
      const item = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = entry.label;
      const bar = document.createElement("i");
      const barFill = document.createElement("b");
      barFill.style.width = entry.accuracy + "%";
      bar.appendChild(barFill);
      const value = document.createElement("strong");
      value.textContent = entry.correct + "/" + entry.answered + " · ×" + Number(entry.scoreMultiplier).toFixed(2);
      item.appendChild(name);
      item.appendChild(bar);
      item.appendChild(value);
      list.appendChild(item);
    });
    difficultyBox.appendChild(list);
    inner.appendChild(difficultyBox);
  }

  const domainEntries = ANOMALY_DOMAINS
    .filter((d) => d.id !== "mixed" && summary.domains && summary.domains[d.id])
    .map((d) => [d.label, summary.domains[d.id]]);
  if (domainEntries.length) {
    const domainsBox = document.createElement("div");
    domainsBox.className = "anomaly-summary-domains";
    const domainsTitle = document.createElement("h3");
    domainsTitle.textContent = "各域正确率 // DOMAIN ACCURACY";
    domainsBox.appendChild(domainsTitle);
    const list = document.createElement("ul");
    domainEntries.forEach(([label, d]) => {
      const item = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = label;
      const bar = document.createElement("i");
      const barFill = document.createElement("b");
      barFill.style.width = (d.accuracy || 0) + "%";
      bar.appendChild(barFill);
      const value = document.createElement("strong");
      value.textContent = d.correct + "/" + d.answered + " · " + d.accuracy + "%";
      item.appendChild(name);
      item.appendChild(bar);
      item.appendChild(value);
      list.appendChild(item);
    });
    domainsBox.appendChild(list);
    inner.appendChild(domainsBox);
  }

  const actions = document.createElement("div");
  actions.className = "anomaly-summary-actions";
  const again = document.createElement("button");
  again.type = "button";
  again.className = "anomaly-again";
  again.textContent = "重新审查";
  again.addEventListener("click", () => openAnomalyThemeSelect(anomaly.config.domain));
  const home = document.createElement("button");
  home.type = "button";
  home.className = "ghost";
  home.textContent = "返回协议选择";
  home.addEventListener("click", showModeScreen);
  actions.appendChild(again);
  actions.appendChild(home);
  inner.appendChild(actions);

  anomalySummary.appendChild(inner);
  anomalySummary.classList.remove("hidden");
  setAnomalyStatus("");
  updateAnomalyChrome();
  announceAnomaly("审查完成。评级 " + (summary.rating || "C") + "，总分 " + summary.score + "，正确 " + summary.correctCount + " / " + totalRounds + "，准确率 " + summary.accuracy + "%。");
  anomalySummary.focus({ preventScroll: true });
  window.setTimeout(() => {
    anomalySummary.scrollIntoView({ behavior: isReducedMotion() ? "auto" : "smooth", block: "start" });
  }, 60);
}

/* ---------- 异类审查事件绑定 ---------- */

modeAnomalyGo.addEventListener("click", (event) => {
  event.stopPropagation();
  openAnomalyThemeSelect();
});
modeAnomalyCard.addEventListener("click", (e) => {
  if (e.target.closest("button")) return;
  openAnomalyThemeSelect();
});
anomalyThemeStart.addEventListener("click", () => startAnomaly(anomaly.selectedTheme));
anomalyConfirmBtn.addEventListener("click", confirmAnomaly);
anomalyScanBtn.addEventListener("click", useAnomalyScanner);
anomalyRestartBtn.addEventListener("click", () => openAnomalyThemeSelect(anomaly.config.domain));
anomalyChangeModeBtn.addEventListener("click", showModeScreen);
anomalyRetryBtn.addEventListener("click", () => startAnomaly(anomaly.config.domain));
anomalyErrorHomeBtn.addEventListener("click", showModeScreen);

/* ---------- 初始化 ---------- */

async function init() {
  clearDirectiveHistory();
  const [names, art, searchData] = await Promise.all([
    fetchJSON("data/names.json"),
    fetchJSON("data/operator-art.json").catch(() => ({})),
    fetchJSON("data/operator-search.json").catch(() => ({ schemaVersion: 1 })),
  ]);
  namesIndex = names;
  operatorSearchEngine = OperatorSearch.createOperatorSearch(names, searchData);
  endlessEasterEggs = EndlessEasterEggs.createEndlessEasterEggs(searchData.specialGroups?.mama || []);
  operatorArt = art;
  validNames = new Set(names.map((x) => x.n));
  /* 搜索候选列表也接入滚动边界转交：候选滑到顶/底后继续滑动可带动外层档案卡片与最外层页面（移动端） */
  bindMobileScrollBoundaryHandoff(suggestEl);
  showModeScreen();
}

init();
