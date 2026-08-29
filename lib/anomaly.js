const crypto = require("crypto");
const operatorsByName = require("../server-data/operators.json");
const operatorArt = require("../public/data/operator-art.json");
const ruleData = require("../server-data/anomaly-rules.json");
const questionData = require("../server-data/anomaly-questions.json");

const SECRET = process.env.GAME_SECRET || "local-dev-secret";
const KEY = crypto.createHash("sha256").update(SECRET + ":anomaly-audit:v1").digest();
const VERSION = 4;
const TOTAL_ROUNDS = 10;
const STARTING_DIFFICULTY = "standard";
const RUNTIME_QUESTION_POOL = "all";
const MIXED_SCAN_LIMIT = 2;
const STREAK_SCAN_REWARD_INTERVAL = 3;
const DIFFICULTY_UP_STREAK = 3;
const DIFFICULTY_DOWN_STREAK = 2;
const DOMAIN_IDS = Object.keys(ruleData.domains || {});
const DIFFICULTY_ORDER = ["trainee", "standard", "hazard"];
const DIFFICULTY_META = {
  trainee: { id: "trainee", level: 1, label: "基础审查", labelEn: "TRAINEE", scoreMultiplier: 1 },
  standard: { id: "standard", level: 2, label: "标准审查", labelEn: "STANDARD", scoreMultiplier: 1.5 },
  hazard: { id: "hazard", level: 3, label: "危机审查", labelEn: "HAZARD", scoreMultiplier: 2.2 },
};
const BASE_POINTS = { trainee: 100, standard: 150, hazard: 220 };
const RATING_THRESHOLDS = { S: 88, A: 72, B: 52 };
const MIXED_DOMAIN_PLAN = [
  "roster",
  "identity", "identity",
  "skill", "skill",
  "battle", "battle",
  "logistics", "logistics",
  "visual",
];
const THEME_GROUPS = {
  roster: [
    { title: "职业", categories: ["profession"], description: "比较四名干员的主职业归属" },
    { title: "子职业", categories: ["subprofession"], description: "在相同主职业内判断子职业分支" },
    { title: "部署位置", categories: ["position"], description: "比较近战位与远程位部署属性" },
  ],
  identity: [
    { title: "势力归属", categories: ["power", "power_root", "secondary_power"], description: "核对所属、上级及次级势力记录" },
    { title: "出生地", categories: ["origin"], description: "依据档案记载的出身地区判断" },
    { title: "种族", categories: ["race"], description: "依据公开种族档案寻找共同归属" },
    { title: "异格关系", categories: ["alter_family"], description: "判断平行履历与异格身份关系" },
  ],
  skill: [
    { title: "技力回复", categories: ["skill_attack_recovery", "damaged_recovery"], description: "比较自然、攻击或受击回复方式" },
    { title: "技能触发", categories: ["skill_auto_trigger", "skill_passive", "skill_all_manual", "skill_manual_auto"], description: "判断自动、手动与被动触发结构" },
    { title: "特殊机制", categories: ["skill_chargeable", "skill_ammo", "skill_none"], description: "识别蓄力、弹药等特殊技能机制" },
    { title: "攻击范围", categories: ["skill_range_change", "skill_distinct_ranges"], description: "比较技能是否改变或区分攻击范围" },
    { title: "技能数量", categories: ["count"], description: "依据常规技能数量寻找共同点" },
  ],
  battle: [
    { title: "战场调度", categories: ["battle_block_control", "battle_fast_redeploy", "battle_forced_movement"], description: "识别阻挡变化、快速再部署与位移能力" },
    { title: "生存与隐匿", categories: ["battle_concealment", "barrier"], description: "判断隐匿、生存锁定及屏障能力" },
    { title: "伤害能力", categories: ["battle_elemental", "true_damage", "aerial"], description: "比较元素、真实伤害与对空响应" },
    { title: "召唤与支援", categories: ["summon", "ally_heal"], description: "判断召唤单位与友方治疗能力" },
    { title: "控制效果", categories: ["stun", "sleep", "cold_frozen", "bind"], description: "识别晕眩、沉睡、低温与束缚效果" },
  ],
  logistics: [
    { title: "获取方式", categories: ["obtain", "limited", "public_recruit", "activity_potential"], description: "比较寻访、活动、招募及专属信物来源" },
    { title: "基建技能", categories: ["base_room"], description: "依据基建技能适用房间判断" },
  ],
  visual: [
    { title: "画师", categories: ["illustrator"], description: "比较默认立绘的画师署名" },
    { title: "服装品牌", categories: ["outfit_brand"], description: "使用对应皮肤判断共有服装品牌" },
  ],
};
const DOMAIN_RULE_EXPLANATIONS = {
  roster: "比较职业、子职业与部署位置；子职业题固定在同一主职业内",
  identity: "从势力、出生地、种族及异格关系中寻找档案共性",
  skill: "围绕技力、触发、特殊机制、范围与技能数量进行核验",
  battle: "判断调度、生存、伤害、召唤支援与控制能力",
  logistics: "根据获取方式及基建技能比对后勤履历",
  visual: "依据默认画师与实际服装品牌比对形象档案",
};

const operatorsById = Object.fromEntries(
  Object.values(operatorsByName).map((operator) => [operator.id, operator])
);
const rules = ruleData.definitions || {};
const questions = questionData.questions || [];
const questionsById = Object.fromEntries(questions.map((question) => [question.id, question]));
const questionBuckets = new Map();
for (const question of questions) {
  const key = `${question.domain}:${question.difficulty}`;
  if (!questionBuckets.has(key)) questionBuckets.set(key, []);
  questionBuckets.get(key).push(question);
}
const allQuestionsByDomain = new Map();
const difficultyPreference = { standard: 0, trainee: 1, hazard: 2 };
for (const question of questions) {
  if (!allQuestionsByDomain.has(question.domain)) allQuestionsByDomain.set(question.domain, new Map());
  const semanticKey = `${question.ruleId}:${question.majorityIds.join(",")}:${question.oddId}`;
  const existing = allQuestionsByDomain.get(question.domain).get(semanticKey);
  if (!existing || difficultyPreference[question.difficulty] < difficultyPreference[existing.difficulty]) {
    allQuestionsByDomain.get(question.domain).set(semanticKey, question);
  }
}
for (const [domain, bucket] of allQuestionsByDomain) {
  questionBuckets.set(`${domain}:${RUNTIME_QUESTION_POOL}`, Array.from(bucket.values()));
}

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

function decrypt(token) {
  try {
    const buffer = Buffer.from(token, "base64url");
    const iv = buffer.subarray(0, 12);
    const tag = buffer.subarray(12, 28);
    const encrypted = buffer.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8"));
  } catch (error) {
    return null;
  }
}

function shuffle(values, random = Math.random) {
  const result = values.slice();
  for (let index = result.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function normalizeConfig(domain) {
  const normalizedDomain = domain || "mixed";
  if (normalizedDomain !== "mixed" && !DOMAIN_IDS.includes(normalizedDomain)) {
    return { error: "invalid_domain" };
  }
  return { domain: normalizedDomain };
}

function auditThemes() {
  const availableRuleIds = new Set(questions.map((question) => question.ruleId));
  const domains = DOMAIN_IDS.map((domainId) => {
    const domain = ruleData.domains[domainId];
    const domainRules = Object.values(rules)
      .filter((rule) => rule.domain === domainId && availableRuleIds.has(rule.id));
    const items = domainRules
      .map((rule) => ({ title: rule.title, description: rule.description }))
      .sort((left, right) => left.title.localeCompare(right.title, "zh-CN"));
    const categoryCounts = domainRules.reduce((counts, rule) => {
      const category = rule.id.split(".")[1] || "other";
      counts[category] = (counts[category] || 0) + 1;
      return counts;
    }, {});
    const groups = (THEME_GROUPS[domainId] || []).map((group) => {
      const ruleCount = group.categories.reduce((sum, category) => sum + (categoryCounts[category] || 0), 0);
      return {
        title: group.title,
        description: group.description,
        countLabel: `${ruleCount} 项规则`,
        ruleCount,
      };
    }).filter((group) => group.ruleCount > 0);
    return {
      id: domain.id,
      label: domain.label,
      labelEn: domain.labelEn,
      itemCount: items.length,
      items,
      groupCount: groups.length,
      groups,
      scannerLimit: 0,
    };
  });
  return {
    themes: [{
      id: "mixed",
      label: "综合审查",
      labelEn: "FULL AUDIT",
      itemCount: domains.reduce((sum, domain) => sum + domain.itemCount, 0),
      items: domains.map((domain) => ({
        title: domain.label,
        description: `${domain.groupCount} 类 · ${domain.itemCount} 项可用规则`,
      })),
      groupCount: domains.length,
      tag: "高难",
      groups: domains.map((domain) => ({
        title: domain.label,
        description: DOMAIN_RULE_EXPLANATIONS[domain.id],
        countLabel: `${domain.groupCount} 类 · ${domain.itemCount} 项规则`,
        ruleCount: domain.itemCount,
      })),
      scannerLimit: MIXED_SCAN_LIMIT,
      scannerRewardEvery: STREAK_SCAN_REWARD_INTERVAL,
    }, ...domains],
  };
}

function domainPlan(domain, random = Math.random) {
  if (domain !== "mixed") return Array(TOTAL_ROUNDS).fill(domain);
  return shuffle(MIXED_DOMAIN_PLAN, random);
}

function balancedOddPositions(random = Math.random) {
  const offset = Math.floor(random() * 4);
  const positions = [];
  for (let index = 0; index < TOTAL_ROUNDS; index++) positions.push((index + offset) % 4);
  return shuffle(positions, random);
}

function orderedOptions(question, oddPosition, random = Math.random) {
  const majority = shuffle(question.majorityIds, random);
  const options = majority.slice();
  options.splice(oddPosition, 0, question.oddId);
  return options;
}

function questionSignature(question) {
  return `${question.ruleId}:${question.majorityIds.concat(question.oddId).slice().sort().join(",")}`;
}

function chooseQuestion(candidates, state, previousOptions, random = Math.random) {
  const randomized = shuffle(candidates, random);
  const checks = [
    (question) => !state.usedRules.has(question.ruleId)
      && question.majorityIds.concat(question.oddId).every((id) => (state.operatorCounts.get(id) || 0) < 2)
      && question.majorityIds.concat(question.oddId).every((id) => !previousOptions.has(id)),
    (question) => question.majorityIds.concat(question.oddId).every((id) => (state.operatorCounts.get(id) || 0) < 2)
      && question.majorityIds.concat(question.oddId).every((id) => !previousOptions.has(id)),
    (question) => question.majorityIds.concat(question.oddId).every((id) => (state.operatorCounts.get(id) || 0) < 2),
  ];
  for (const check of checks) {
    const selected = randomized.find((question) => !state.usedQuestions.has(question.id)
      && !state.usedQuestionSignatures.has(questionSignature(question))
      && check(question));
    if (selected) return selected;
  }
  return null;
}

function selectRun(domain, difficulty, random = Math.random) {
  const domains = domainPlan(domain, random);
  const oddPositions = balancedOddPositions(random);
  for (let runAttempt = 0; runAttempt < 80; runAttempt++) {
    const state = {
      usedQuestions: new Set(),
      usedQuestionSignatures: new Set(),
      usedRules: new Set(),
      operatorCounts: new Map(),
    };
    let previousOptions = new Set();
    const selected = [];
    for (let index = 0; index < domains.length; index++) {
      const bucket = questionBuckets.get(`${domains[index]}:${difficulty}`) || [];
      const question = chooseQuestion(bucket, state, previousOptions, random);
      if (!question) break;
      const optionIds = orderedOptions(question, oddPositions[index], random);
      selected.push({ id: question.id, optionIds });
      state.usedQuestions.add(question.id);
      state.usedQuestionSignatures.add(questionSignature(question));
      state.usedRules.add(question.ruleId);
      for (const operatorId of optionIds) {
        state.operatorCounts.set(operatorId, (state.operatorCounts.get(operatorId) || 0) + 1);
      }
      previousOptions = new Set(optionIds);
    }
    if (selected.length === TOTAL_ROUNDS) return selected;
  }
  return null;
}

function selectAdaptiveQuestion(session, difficulty, random = Math.random) {
  const state = {
    usedQuestions: new Set(),
    usedQuestionSignatures: new Set(),
    usedRules: new Set(),
    operatorCounts: new Map(),
  };
  for (const entry of session.run) {
    const question = questionsById[entry.id];
    if (!question) continue;
    state.usedQuestions.add(question.id);
    state.usedQuestionSignatures.add(questionSignature(question));
    state.usedRules.add(question.ruleId);
    for (const operatorId of entry.optionIds) {
      state.operatorCounts.set(operatorId, (state.operatorCounts.get(operatorId) || 0) + 1);
    }
  }
  const domain = session.domainPlan[session.roundIndex];
  const candidates = questionBuckets.get(`${domain}:${difficulty}`) || [];
  const previousEntry = session.run[session.run.length - 1];
  const previousOptions = new Set(previousEntry ? previousEntry.optionIds : []);
  const question = chooseQuestion(candidates, state, previousOptions, random);
  if (!question) return null;
  return {
    id: question.id,
    optionIds: orderedOptions(question, session.oddPositions[session.roundIndex], random),
  };
}

function difficultyProfile(difficulty) {
  return DIFFICULTY_META[difficulty] || DIFFICULTY_META.standard;
}

function adjustDifficulty(session, correct) {
  const currentIndex = Math.max(0, DIFFICULTY_ORDER.indexOf(session.difficulty));
  let correctProgress = correct ? session.difficultyCorrectStreak + 1 : 0;
  let wrongProgress = correct ? 0 : session.difficultyWrongStreak + 1;
  let nextIndex = currentIndex;
  if (correctProgress >= DIFFICULTY_UP_STREAK && currentIndex < DIFFICULTY_ORDER.length - 1) {
    nextIndex++;
    correctProgress = 0;
  } else if (wrongProgress >= DIFFICULTY_DOWN_STREAK && currentIndex > 0) {
    nextIndex--;
    wrongProgress = 0;
  }
  return {
    difficulty: DIFFICULTY_ORDER[nextIndex],
    difficultyCorrectStreak: Math.min(correctProgress, DIFFICULTY_UP_STREAK),
    difficultyWrongStreak: Math.min(wrongProgress, DIFFICULTY_DOWN_STREAK),
    change: nextIndex - currentIndex,
  };
}

function questionForSession(session) {
  const entry = session.run[session.roundIndex];
  return entry ? questionsById[entry.id] : null;
}

function questionProfile(session) {
  const entry = session.run[session.roundIndex];
  const question = questionForSession(session);
  if (!entry || !question) return null;
  const domain = ruleData.domains[question.domain];
  const optionArt = Object.fromEntries(
    (question.optionArt || []).map((entry) => [entry.operatorId, entry])
  );
  return {
    round: session.roundIndex + 1,
    totalRounds: TOTAL_ROUNDS,
    difficulty: difficultyProfile(question.difficulty),
    domain: {
      id: domain.id,
      label: domain.label,
      labelEn: domain.labelEn,
    },
    options: entry.optionIds.map((operatorId) => ({
      id: operatorId,
      name: operatorsById[operatorId].name,
      imageUrl: (optionArt[operatorId] || {}).imageUrl
        || (operatorArt[operatorId] || {}).e1
        || `/img/operators/e1/${operatorId}.webp`,
      artKind: optionArt[operatorId] ? "skin" : "e1",
    })),
    scannerAvailable: session.domain === "mixed"
      && session.scansRemaining > 0
      && !session.scannedCurrent,
    scansRemaining: session.scansRemaining,
  };
}

function publicConfig(session) {
  return {
    domain: session.domain,
    totalRounds: TOTAL_ROUNDS,
    scannerLimit: session.domain === "mixed" ? MIXED_SCAN_LIMIT : 0,
    scannerRewardEvery: session.domain === "mixed" ? STREAK_SCAN_REWARD_INTERVAL : 0,
    difficultyUpStreak: DIFFICULTY_UP_STREAK,
    difficultyDownStreak: DIFFICULTY_DOWN_STREAK,
  };
}

function baseResponse(session) {
  return {
    version: VERSION,
    mode: "anomaly",
    config: publicConfig(session),
    score: session.score,
    correctCount: session.correctCount,
    streak: session.streak,
    scansRemaining: session.scansRemaining,
    difficulty: difficultyProfile(session.difficulty),
    difficultyProgress: {
      correct: session.difficultyCorrectStreak,
      wrong: session.difficultyWrongStreak,
      correctRequired: DIFFICULTY_UP_STREAK,
      wrongRequired: DIFFICULTY_DOWN_STREAK,
    },
  };
}

function newAudit(domain, random = Math.random, now = Date.now()) {
  const config = normalizeConfig(domain);
  if (config.error) return config;
  const session = {
    version: VERSION,
    type: "anomaly",
    domain: config.domain,
    difficulty: STARTING_DIFFICULTY,
    difficultyCorrectStreak: 0,
    difficultyWrongStreak: 0,
    domainPlan: domainPlan(config.domain, random),
    oddPositions: balancedOddPositions(random),
    run: [],
    roundIndex: 0,
    phase: "question",
    score: 0,
    correctCount: 0,
    streak: 0,
    maxStreak: 0,
    scansRemaining: config.domain === "mixed" ? MIXED_SCAN_LIMIT : 0,
    scannedCurrent: false,
    startedAt: now,
    results: [],
  };
  const firstEntry = selectAdaptiveQuestion(session, session.difficulty, random);
  if (!firstEntry) return { error: "question_bank_unavailable" };
  session.run.push(firstEntry);
  return {
    ...baseResponse(session),
    token: encrypt(session),
    question: questionProfile(session),
  };
}

function validSession(token) {
  const session = decrypt(token);
  if (!session || session.version !== VERSION || session.type !== "anomaly") return null;
  return session;
}

function scan(token) {
  const session = validSession(token);
  if (!session) return { error: "invalid_session" };
  if (session.phase !== "question") return { error: "invalid_phase" };
  if (session.domain !== "mixed" || session.scansRemaining <= 0 || session.scannedCurrent) {
    return { error: "scan_unavailable" };
  }
  const question = questionForSession(session);
  const rule = question && rules[question.ruleId];
  if (!rule) return { error: "question_unavailable" };
  const nextSession = {
    ...session,
    scansRemaining: session.scansRemaining - 1,
    scannedCurrent: true,
  };
  return {
    ...baseResponse(nextSession),
    token: encrypt(nextSession),
    scannerAvailable: false,
    scansRemaining: nextSession.scansRemaining,
    hint: {
      title: rule.title,
      description: rule.description,
    },
  };
}

function scoreRound(difficulty, correct, elapsedMs, streakBefore, scanned) {
  const base = BASE_POINTS[difficulty];
  if (!correct) {
    return { base, timeBonus: 0, streakMultiplier: 1, hintMultiplier: scanned ? 0.6 : 1, total: 0 };
  }
  const elapsedSeconds = Math.min(20, Math.max(0, elapsedMs / 1000));
  const timeBonus = Math.round(base * 0.4 * (1 - elapsedSeconds / 20));
  const streakMultiplier = 1 + Math.min(streakBefore, 5) * 0.05;
  const hintMultiplier = scanned ? 0.6 : 1;
  const total = Math.round((base + timeBonus) * streakMultiplier * hintMultiplier);
  return { base, timeBonus, streakMultiplier, hintMultiplier, total };
}

function summary(session) {
  const elapsedValues = session.results.map((result) => result.elapsedMs);
  const byDomain = {};
  const byDifficulty = Object.fromEntries(DIFFICULTY_ORDER.map((difficulty) => [difficulty, {
    ...difficultyProfile(difficulty),
    answered: 0,
    correct: 0,
  }]));
  let difficultyCredit = 0;
  for (const result of session.results) {
    if (!byDomain[result.domain]) byDomain[result.domain] = { answered: 0, correct: 0 };
    byDomain[result.domain].answered++;
    byDifficulty[result.difficulty].answered++;
    if (result.correct) {
      byDomain[result.domain].correct++;
      byDifficulty[result.difficulty].correct++;
      difficultyCredit += difficultyProfile(result.difficulty).scoreMultiplier;
    }
  }
  for (const value of Object.values(byDomain)) {
    value.accuracy = value.answered ? Math.round(value.correct / value.answered * 100) : 0;
  }
  for (const value of Object.values(byDifficulty)) {
    value.accuracy = value.answered ? Math.round(value.correct / value.answered * 100) : 0;
  }
  const idealDifficultyCredit = DIFFICULTY_UP_STREAK * DIFFICULTY_META.standard.scoreMultiplier
    + (TOTAL_ROUNDS - DIFFICULTY_UP_STREAK) * DIFFICULTY_META.hazard.scoreMultiplier;
  const accuracy = Math.round(session.correctCount / TOTAL_ROUNDS * 100);
  const challengeIndex = Math.min(100, Math.round(difficultyCredit / idealDifficultyCredit * 100));
  const ratingIndex = Math.round(accuracy * 0.55 + challengeIndex * 0.45);
  const rating = ratingIndex >= RATING_THRESHOLDS.S
    ? "S"
    : ratingIndex >= RATING_THRESHOLDS.A
      ? "A"
      : ratingIndex >= RATING_THRESHOLDS.B ? "B" : "C";
  return {
    rating,
    ratingIndex,
    challengeIndex,
    score: session.score,
    correctCount: session.correctCount,
    accuracy,
    averageElapsedMs: elapsedValues.length
      ? Math.round(elapsedValues.reduce((sum, value) => sum + value, 0) / elapsedValues.length)
      : 0,
    maxStreak: session.maxStreak,
    highestDifficulty: session.results.reduce((highest, result) => (
      difficultyProfile(result.difficulty).level > difficultyProfile(highest).level
        ? result.difficulty
        : highest
    ), "trainee"),
    domains: byDomain,
    difficulties: byDifficulty,
  };
}

function answer(token, pickId, now = Date.now()) {
  const session = validSession(token);
  if (!session) return { error: "invalid_session" };
  if (session.phase !== "question") return { error: "invalid_phase" };
  const entry = session.run[session.roundIndex];
  const question = questionForSession(session);
  if (!entry || !question) return { error: "question_unavailable" };
  if (!entry.optionIds.includes(pickId)) return { error: "invalid_pick" };
  const elapsedMs = Math.max(0, now - session.startedAt);
  const correct = pickId === question.oddId;
  const answeredDifficulty = question.difficulty;
  const points = scoreRound(answeredDifficulty, correct, elapsedMs, session.streak, session.scannedCurrent);
  const streak = correct ? session.streak + 1 : 0;
  const difficultyAdjustment = adjustDifficulty(session, correct);
  const finished = session.roundIndex === TOTAL_ROUNDS - 1;
  const scannerReward = session.domain === "mixed"
    && correct
    && !finished
    && streak % STREAK_SCAN_REWARD_INTERVAL === 0
    ? 1
    : 0;
  const resultRecord = {
    domain: question.domain,
    difficulty: answeredDifficulty,
    correct,
    elapsedMs,
    points: points.total,
  };
  const nextSession = {
    ...session,
    difficulty: difficultyAdjustment.difficulty,
    difficultyCorrectStreak: difficultyAdjustment.difficultyCorrectStreak,
    difficultyWrongStreak: difficultyAdjustment.difficultyWrongStreak,
    phase: finished ? "finished" : "answered",
    score: session.score + points.total,
    correctCount: session.correctCount + (correct ? 1 : 0),
    streak,
    maxStreak: Math.max(session.maxStreak, streak),
    scansRemaining: session.scansRemaining + scannerReward,
    results: session.results.concat(resultRecord),
  };
  const rule = rules[question.ruleId];
  const evidenceById = Object.fromEntries(question.evidence.map((entry) => [entry.operatorId, entry]));
  const out = {
    ...baseResponse(nextSession),
    token: encrypt(nextSession),
    finished,
    result: {
      correct,
      chosenId: pickId,
      oddId: question.oddId,
      rule: {
        id: rule.id,
        domain: rule.domain,
        title: rule.title,
        description: rule.description,
      },
      evidence: entry.optionIds.map((operatorId) => ({
        id: operatorId,
        name: operatorsById[operatorId].name,
        match: evidenceById[operatorId].match,
        value: evidenceById[operatorId].value,
      })),
      supportingRules: question.supportingRuleIds.map((ruleId) => ({
        id: rules[ruleId].id,
        title: rules[ruleId].title,
        description: rules[ruleId].description,
      })),
      points,
      elapsedMs,
      scannerReward,
      difficulty: difficultyProfile(answeredDifficulty),
      nextDifficulty: difficultyProfile(difficultyAdjustment.difficulty),
      difficultyChange: difficultyAdjustment.change,
    },
  };
  if (finished) out.summary = summary(nextSession);
  return out;
}

function next(token, now = Date.now(), random = Math.random) {
  const session = validSession(token);
  if (!session) return { error: "invalid_session" };
  if (session.phase !== "answered") return { error: "invalid_phase" };
  const nextSession = {
    ...session,
    roundIndex: session.roundIndex + 1,
    phase: "question",
    scannedCurrent: false,
    startedAt: now,
  };
  const entry = selectAdaptiveQuestion(nextSession, nextSession.difficulty, random);
  if (!entry) return { error: "question_bank_unavailable" };
  nextSession.run = session.run.concat(entry);
  const question = questionProfile(nextSession);
  if (!question) return { error: "question_unavailable" };
  return {
    ...baseResponse(nextSession),
    token: encrypt(nextSession),
    question,
  };
}

module.exports = {
  auditThemes,
  newAudit,
  scan,
  answer,
  next,
  VERSION,
  TOTAL_ROUNDS,
  STARTING_DIFFICULTY,
  RUNTIME_QUESTION_POOL,
  STREAK_SCAN_REWARD_INTERVAL,
  DIFFICULTY_UP_STREAK,
  DIFFICULTY_DOWN_STREAK,
};

if (process.env.NODE_ENV === "test") {
  module.exports._test = {
    encrypt,
    decrypt,
    normalizeConfig,
    selectRun,
    scoreRound,
    questions,
    rules,
    questionsById,
    operatorsById,
  };
}
