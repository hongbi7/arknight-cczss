const crypto = require("crypto");
const data = require("../server-data/operators.json");
const archives = require("../server-data/operator-archives.json");
const clueData = require("../server-data/operator-clues.json");
const themeData = require("../server-data/operator-themes.json");
const brandArt = require("../server-data/operator-brand-art.json");

const SECRET = process.env.GAME_SECRET || "local-dev-secret";
const KEY = crypto.createHash("sha256").update(SECRET).digest();
const SUDDEN_MAX = 6;
const SUDDEN_MIN = 1;
const SUDDEN_LIMIT = 20;
const SUDDEN_VERSION = 2;
const SUDDEN_THEME_VERSION = 3;
const HEIGHT_CLOSE_CM = 15;
const BIRTHDAY_CLOSE_DAYS = 60;
const ASSIST_MIN_ATTEMPT = 2;
const ROTATING_KEYS = ["birthday", "height", "exp", "infected"];
const V2_FIXED_KEYS = [
  "profession",
  "subProfession",
  "rarity",
  "position",
  "tags",
  "gender",
  "origin",
  "race",
  "power",
  "deploymentTemplate",
  "deploymentCost",
];
const LEGACY_DIM_KEYS = [
  "profession",
  "subProfession",
  "rarity",
  "position",
  "gender",
  "exp",
  "origin",
  "birthday",
  "race",
  "height",
  "infected",
];
// 信息强度按实际辨识度排序：泛用台词/技能偏低，角色专属台词居中，完整剪影属于高情报。
const CLUE_PROFILES = [
  { kind: "skillMechanic", strength: 1.25, baseWeight: 16 },
  { kind: "skillIcon", strength: 1.4, baseWeight: 24 },
  { kind: "quote", quoteTier: "low", strength: 1.35, baseWeight: 24 },
  { kind: "skillName", strength: 1.85, baseWeight: 8 },
  { kind: "quote", quoteTier: "high", strength: 2.65, baseWeight: 14 },
  { kind: "artFragment", itemIndex: 0, strength: 3.15, baseWeight: 18 },
  { kind: "silhouette", strength: 4.15, baseWeight: 20 },
  { kind: "artFragment", itemIndex: 1, strength: 4.5, baseWeight: 12 },
];
const MULTI_SKILL_CLUE_STRENGTH = { skillIcon: 2.35, skillMechanic: 1.7, skillName: 2.05 };
const MULTI_SKILL_CLUE_WEIGHT = { skillIcon: 0.07, skillMechanic: 0.06, skillName: 0.12 };
const MULTI_SKILL_CLUE_FIELDS = {
  skillIcon: ["icon", "name"],
  skillMechanic: ["icon", "mechanic"],
  skillName: ["name", "mechanic"],
};
const DIRECTIVE_THEME_STRENGTH_ADJUSTMENT = 0.18;
const DIRECTIVE_REWARD_FIT_SHARPNESS = 4.2;
const DIRECTIVE_MECHANIC_THEME_IDS = new Set([
  "skill_attack_recovery",
  "skill_auto_trigger",
  "skill_passive",
  "skill_all_manual",
  "skill_manual_auto",
  "skill_chargeable",
  "skill_ammo",
]);

const ALL_NAMES = Object.keys(data);
const OPERATOR_NAMES_BY_ID = Object.fromEntries(
  Object.values(data).map((operator) => [operator.id, operator.name])
);
const THEME_DEFINITIONS = themeData.definitions || {};
const THEMES_BY_OPERATOR = themeData.byOperator || {};
const THEME_MEMBER_SETS = Object.fromEntries(
  Object.entries(THEME_DEFINITIONS).map(([themeId, definition]) => [
    themeId,
    new Set(definition.members || []),
  ])
);
const THEME_FAMILY_WEIGHTS = { skill: 30, battle: 22, identity: 18, logistics: 20, visual: 10 };
const THEME_FAMILY_LABELS = {
  skill: "技能协议",
  battle: "战场响应",
  identity: "身份档案",
  logistics: "后勤履历",
  visual: "形象档案",
};
// 重复游玩时持续轮换五族：兼顾最近出现位置和近两轮频次，首轮走完后仍避免扎堆。
const THEME_FAMILY_ROTATION_PENALTY = 0.98;
const THEME_FAMILY_ROTATION_DECAY_GAMES = 3;
const THEME_FAMILY_BALANCE_WINDOW = 10;
const THEME_FAMILY_BALANCE_PENALTY = 0.22;
const THEME_EXHAUSTED_FAMILY_REPEAT_PENALTY = 0.18;
const THEME_RECENT_REPEAT_BASE = 0.015;
const THEME_RECENT_REPEAT_RECOVERY = 0.003;
const FIRST_VISUAL_THEME_ID = "visual_brand_shan-hu-hai-an";
const FIRST_VISUAL_THEME_BOOST = 1.75;
const CORAL_OPENING_BOOSTS = [2.25, 4, 8];
const CORAL_DIRECT_OPENING_CHANCES = [0.3, 0.7, 0.9];
const CORAL_DIRECT_CATCHUP_CHANCE = 0.9;
const CORAL_CONSECUTIVE_REPEAT_PENALTY = 0.18;
const CORAL_OPENING_REPEAT_WEIGHT = 1;
const CORAL_WEIGHT_AFTER_THREE = 1;
const DIRECTIVE_FIRST_CYCLE_MARKER = "__directive_first_family_cycle_complete__";
const POST_CYCLE_VISUAL_FAMILY_BOOST = 1.2;
const VISUAL_DIRECTIVE_GOAL = 2;
const VISUAL_DIRECTIVE_GOAL_SMALL = 25;
const VISUAL_DIRECTIVE_GOAL_OBSCURE = 0.55;
const CORAL_SECRET_NAMES = (THEME_DEFINITIONS[FIRST_VISUAL_THEME_ID]?.members || [])
  .map((operatorId) => OPERATOR_NAMES_BY_ID[operatorId])
  .filter(Boolean);

function publicProfile(operator) {
  return {
    id: operator.id,
    name: operator.name,
    profession: operator.profession,
    professionText: operator.professionText,
    subProfessionId: operator.subProfessionId,
    subProfessionText: operator.subProfessionText,
    rarity: operator.rarity,
    position: operator.position,
    gender: operator.gender,
    expText: operator.expText,
    origin: operator.origin,
    birthdayText: operator.birthdayText,
    race: operator.race,
    heightText: operator.heightText,
    infectedText: operator.infectedText,
    tags: operator.tags,
    power: operator.power,
    deploymentCost: operator.deploymentCost,
    rangeCells: operator.rangeCells,
    skillRanges: operator.skillRanges || [],
    familiarityTier: operator.familiarityTier,
  };
}

function choiceProfile(operator, choiceImageUrl) {
  const profile = {
    id: operator.id,
    name: operator.name,
  };
  return choiceImageUrl ? { ...profile, choiceImageUrl } : profile;
}

// Outfit-brand directives swap the guessed operator's portrait to that brand's
// skin; operators without a mapped skin keep their default art.
function operatorProfileWithThemeArt(operator, themeId) {
  const theme = THEME_DEFINITIONS[themeId];
  const entry = theme && theme.artBrand
    ? (brandArt.brands[theme.artBrand] || {})[operator.id]
    : null;
  if (!entry) return publicProfile(operator);
  return {
    ...publicProfile(operator),
    themeArtUrl: entry.imageUrl,
    themeArtBrand: theme.artBrand,
    themeArtSkinName: entry.skinName || null,
  };
}

function personnelArchive(operator) {
  return archives[operator.id] || [];
}

function poolFor() {
  return ALL_NAMES;
}

function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(obj), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
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

function normalizeSuddenMax(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return SUDDEN_MAX;
  return Math.min(SUDDEN_LIMIT, Math.max(SUDDEN_MIN, parsed));
}

function sessionSuddenMax(session) {
  return normalizeSuddenMax(session && session.maxAttempts);
}

function shuffle(values) {
  const result = values.slice();
  for (let index = result.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function buildRotationPlan(maxAttempts) {
  return extendRotationPlan([], maxAttempts).slice(0, maxAttempts);
}

function extendRotationPlan(currentPlan, requiredLength) {
  const result = Array.isArray(currentPlan) ? currentPlan.slice() : [];
  while (result.length < requiredLength) {
    const batch = shuffle(ROTATING_KEYS);
    if (result.length && batch[0] === result[result.length - 1]) {
      const swapIndex = batch.findIndex((key) => key !== result[result.length - 1]);
      [batch[0], batch[swapIndex]] = [batch[swapIndex], batch[0]];
    }
    result.push(...batch);
  }
  return result;
}

function weightedChoice(entries, randomValue = Math.random()) {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = randomValue * total;
  for (const entry of entries) {
    cursor -= entry.weight;
    if (cursor <= 0) return entry.value;
  }
  return entries[entries.length - 1].value;
}

function familyRotationFactor(lastSeenIndex) {
  if (lastSeenIndex === undefined) return 1;
  return 1 - THEME_FAMILY_ROTATION_PENALTY * Math.exp(-lastSeenIndex / THEME_FAMILY_ROTATION_DECAY_GAMES);
}

function familyBalanceFactor(recentCount, minimumCount) {
  return recentCount > minimumCount ? THEME_FAMILY_BALANCE_PENALTY : 1;
}

function directiveFamilyWeight(family, firstCycleCompleted) {
  const baseWeight = THEME_FAMILY_WEIGHTS[family] || 1;
  return family === "visual" && firstCycleCompleted
    ? baseWeight * POST_CYCLE_VISUAL_FAMILY_BOOST
    : baseWeight;
}

function directiveRecordedHistory(recentThemeIds) {
  return (Array.isArray(recentThemeIds) ? recentThemeIds : [])
    .filter((themeId) => typeof themeId === "string")
    .slice(0, 44);
}

function coralOpeningChance(recentThemeIds) {
  const recent = directiveRecordedHistory(recentThemeIds)
    .filter((themeId) => THEME_DEFINITIONS[themeId])
    .slice(0, 43);
  if (recent.includes(FIRST_VISUAL_THEME_ID)) return 0;
  return recent.length < CORAL_DIRECT_OPENING_CHANCES.length
    ? CORAL_DIRECT_OPENING_CHANCES[recent.length]
    : CORAL_DIRECT_CATCHUP_CHANCE;
}

function shouldOpenCoral(recentThemeIds, randomValue = Math.random()) {
  return randomValue < coralOpeningChance(recentThemeIds);
}

function coralThemeBaseWeight(theme, coralAppearances, recentGameCount) {
  if (coralAppearances >= 3) return CORAL_WEIGHT_AFTER_THREE;
  // 前三局一旦已经出现珊瑚海岸，剩余开局轮次立即恢复普通主题权重，避免开局重复加权。
  if (coralAppearances > 0 && recentGameCount < CORAL_OPENING_BOOSTS.length) {
    return CORAL_OPENING_REPEAT_WEIGHT;
  }
  return theme.weightBoost || 1;
}

function selectDirective(operator, randomValue = Math.random(), recentThemeIds = []) {
  const themeIds = (THEMES_BY_OPERATOR[operator.id] || []).filter((themeId) => THEME_DEFINITIONS[themeId]);
  if (!themeIds.length) return null;
  const recordedRecent = directiveRecordedHistory(recentThemeIds);
  const recent = recordedRecent.filter((themeId) => THEME_DEFINITIONS[themeId]).slice(0, 43);
  const firstCycleCompleted = recordedRecent.includes(DIRECTIVE_FIRST_CYCLE_MARKER)
    || new Set(recent.map((themeId) => THEME_DEFINITIONS[themeId].family)).size >= 5;
  // 珊瑚海岸只借历史确认开启状态和累计三次后的权重阶段，不参与主题或五族轮换降权。
  const rotationRecent = recent
    .filter((themeId) => themeId !== FIRST_VISUAL_THEME_ID)
    .slice(0, 40);
  const rotationThemeIds = themeIds.filter((themeId) => themeId !== FIRST_VISUAL_THEME_ID);
  const coralAppearances = Math.min(
    3,
    recent.filter((themeId) => themeId === FIRST_VISUAL_THEME_ID).length
  );
  const lastThemeWasCoral = recent[0] === FIRST_VISUAL_THEME_ID;
  const recentIndex = new Map();
  const familyLastSeen = new Map();
  rotationRecent.forEach((themeId, index) => {
    const family = THEME_DEFINITIONS[themeId].family;
    if (!recentIndex.has(themeId)) recentIndex.set(themeId, index);
    if (!familyLastSeen.has(family)) familyLastSeen.set(family, index);
  });
  const hasSeenVisualTheme = recent.some((themeId) => THEME_DEFINITIONS[themeId].family === "visual");
  const hasUnseenTheme = rotationThemeIds.some((themeId) => !recentIndex.has(themeId));
  const familySizes = themeIds.reduce((counts, themeId) => {
    const family = THEME_DEFINITIONS[themeId].family;
    counts[family] = (counts[family] || 0) + 1;
    return counts;
  }, {});
  const familyHasUnseenTheme = rotationThemeIds.reduce((unseen, themeId) => {
    const family = THEME_DEFINITIONS[themeId].family;
    if (!recentIndex.has(themeId)) unseen[family] = true;
    return unseen;
  }, {});
  const recentFamilyCounts = rotationRecent.slice(0, THEME_FAMILY_BALANCE_WINDOW).reduce((counts, themeId) => {
    const family = THEME_DEFINITIONS[themeId].family;
    counts[family] = (counts[family] || 0) + 1;
    return counts;
  }, {});
  const minimumFamilyCount = Math.min(
    ...Object.keys(familySizes).map((family) => recentFamilyCounts[family] || 0)
  );
  const familiarityScore = Number.isFinite(operator.familiarityScore) ? operator.familiarityScore : 50;
  const obscurity = 1 - clamp(familiarityScore, 0, 100) / 100;
  const desiredInformation = 0.25 + 0.55 * obscurity;
  return weightedChoice(themeIds.map((themeId) => {
    const theme = THEME_DEFINITIONS[themeId];
    const information = clamp(theme.informationStrength || 0);
    const challenge = clamp(theme.challengeDifficulty || 0);
    const distance = information - desiredInformation;
    const rangeOverlapPenalty = ["skill_range_change", "skill_distinct_ranges"].includes(theme.id) ? 0.6 : 1;
    const firstCoralBoost = recent.length < CORAL_OPENING_BOOSTS.length
      ? CORAL_OPENING_BOOSTS[recent.length]
      : FIRST_VISUAL_THEME_BOOST;
    const firstVisualFactor = !hasSeenVisualTheme && theme.family === "visual"
      ? (theme.id === FIRST_VISUAL_THEME_ID ? firstCoralBoost : 0)
      : 1;
    const ignoresRotationHistory = theme.id === FIRST_VISUAL_THEME_ID;
    const themeBaseWeight = ignoresRotationHistory
      ? coralThemeBaseWeight(theme, coralAppearances, recent.length)
      : theme.weightBoost || 1;
    const consecutiveRepeatWeight = ignoresRotationHistory && lastThemeWasCoral
      ? CORAL_CONSECUTIVE_REPEAT_PENALTY
      : 1;
    const seenAt = recentIndex.get(theme.id);
    let rotationWeight = 1;
    if (seenAt !== undefined && hasUnseenTheme) {
      rotationWeight = THEME_RECENT_REPEAT_BASE
        + Math.min(seenAt, 12) * THEME_RECENT_REPEAT_RECOVERY;
    } else if (seenAt !== undefined && rotationRecent.length > 1) {
      rotationWeight = 0.12 + 0.88 * Math.pow(seenAt / (rotationRecent.length - 1), 1.35);
    }
    return {
      value: theme,
      weight: (directiveFamilyWeight(theme.family, firstCycleCompleted) / (familySizes[theme.family] || 1))
        * Math.exp(-4 * distance * distance)
        * (0.55 + 0.45 * (1 - challenge))
        * rangeOverlapPenalty
        * firstVisualFactor
        * rotationWeight
        * (ignoresRotationHistory ? 1 : familyRotationFactor(familyLastSeen.get(theme.family)))
        * (ignoresRotationHistory
          ? 1
          : familyBalanceFactor(recentFamilyCounts[theme.family] || 0, minimumFamilyCount))
        * (ignoresRotationHistory
          ? 1
          : hasUnseenTheme && !familyHasUnseenTheme[theme.family]
            ? THEME_EXHAUSTED_FAMILY_REPEAT_PENALTY
            : 1)
        * themeBaseWeight
        * consecutiveRepeatWeight,
    };
  }), seededUnit(`${operator.id}:${randomValue}`, "directive"));
}

function directiveGoal(operator, theme) {
  if (theme && Number.isInteger(theme.directiveGoal)) return theme.directiveGoal;
  if (theme && theme.family === "visual") {
    const smallBrand = (theme.memberCount || 0) <= VISUAL_DIRECTIVE_GOAL_SMALL;
    const obscureBrand = clamp(theme && theme.challengeDifficulty || 0) >= VISUAL_DIRECTIVE_GOAL_OBSCURE;
    return smallBrand || obscureBrand ? 1 : VISUAL_DIRECTIVE_GOAL;
  }
  const familiarityScore = Number.isFinite(operator.familiarityScore) ? operator.familiarityScore : 50;
  if (familiarityScore <= 28 && clamp(theme && theme.challengeDifficulty || 0) >= 0.45) return 1;
  if (familiarityScore < 30) return 2;
  return 3;
}

function directiveMatches(themeId, operator) {
  const members = THEME_MEMBER_SETS[themeId];
  return Boolean(members && operator && members.has(operator.id));
}

function directivePublicState(session) {
  const theme = THEME_DEFINITIONS[session.themeId];
  if (!theme) return null;
  const progress = Math.min(session.themeGoal || 3, (session.themeHits || []).length);
  const completed = progress >= (session.themeGoal || 3);
  const status = session.clueStatus === "revealed" ? "revealed" : completed ? "complete" : "active";
  return {
    id: theme.id,
    family: theme.family,
    familyLabel: THEME_FAMILY_LABELS[theme.family] || theme.family,
    title: theme.title,
    description: theme.description,
    goal: session.themeGoal || 3,
    progress,
    status,
  };
}

function directiveClueStrength(operator, theme) {
  const familiarityScore = Number.isFinite(operator.familiarityScore) ? operator.familiarityScore : 50;
  const obscurity = 1 - clamp(familiarityScore, 0, 100) / 100;
  const information = clamp(theme && theme.informationStrength || 0);
  const challenge = clamp(theme && theme.challengeDifficulty || 0);
  const obscurityNeed = Math.pow(obscurity, 1.05);
  const themeAdjustment = DIRECTIVE_THEME_STRENGTH_ADJUSTMENT * (challenge - information);
  let strength = clamp(1.25 + 3.15 * obscurityNeed + themeAdjustment, 1, 4.5);
  if (familiarityScore <= 25) strength = Math.max(strength, 4);
  else if (familiarityScore <= 40) strength = Math.max(strength, 3.25);
  else if (familiarityScore >= 80) strength = Math.min(strength, 1.9);
  return strength;
}

function directiveRewardFit(strength, familiarityScore) {
  const familiarityDirection = clamp((familiarityScore - 50) / 30, -1, 1);
  const strengthDirection = clamp((strength - 2.75) / 1.75, -1, 1);
  const oppositeDirection = Math.max(0, familiarityDirection * strengthDirection);
  return Math.exp(-DIRECTIVE_REWARD_FIT_SHARPNESS * oppositeDirection);
}

function directiveRewardBandFactor(strength, familiarityScore) {
  if (familiarityScore <= 25) {
    if (strength < 2.5) return 0.015;
    if (strength < 3) return 0.12;
  } else if (familiarityScore <= 40) {
    if (strength < 2.35) return 0.06;
    if (strength < 3) return 0.3;
  } else if (familiarityScore >= 80) {
    if (strength >= 4) return 0.002;
    if (strength >= 3) return 0.025;
    if (strength > 2.35) return 0.18;
  } else if (familiarityScore >= 60) {
    if (strength >= 4) return 0.03;
    if (strength >= 3) return 0.22;
  }
  return 1;
}

function directiveQuoteTierFactor(quoteTier, familiarityScore) {
  if (quoteTier !== "high") return 1;
  if (familiarityScore <= 25) return 0.3;
  if (familiarityScore <= 59) return 1;
  if (familiarityScore <= 79) return 0.15;
  return 0.025;
}

function silhouetteRewardFactor(operator, usesDirectiveTheme) {
  const familiarityScore = Number.isFinite(operator.familiarityScore) ? operator.familiarityScore : 50;
  if (!usesDirectiveTheme) {
    if (operator.rarity !== 6) return 1;
    if (familiarityScore <= 30) return 1;
    if (familiarityScore <= 40) return 0.35;
    if (familiarityScore <= 55) return 0.04;
    return 0.001;
  }
  if (familiarityScore <= 25) return 2.4;
  if (familiarityScore <= 40) return operator.rarity === 6 ? 0.45 : 1;
  if (familiarityScore <= 59) return operator.rarity === 6 ? 0.025 : 0.18;
  if (familiarityScore <= 79) return 0.004;
  return 0.0002;
}

function isComparisonVersion(version) {
  return version === SUDDEN_VERSION || version === SUDDEN_THEME_VERSION;
}

function seededUnit(seed, label) {
  const hash = crypto.createHash("sha256").update(`${seed}:${label}`).digest();
  return hash.readUIntBE(0, 6) / 281474976710656;
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function createCluePlan(operator) {
  const source = clueData[operator.id] || {};
  const hasClue = source.silhouetteUrl
    || (source.fragmentUrls || []).length
    || (source.quotes || []).length
    || (source.skills || []).length;
  if (!hasClue) return null;
  return {
    id: crypto.randomBytes(9).toString("base64url"),
    seed: crypto.randomBytes(12).toString("base64url"),
  };
}

function targetClueStrength(operator, context) {
  const familiarityScore = Number.isFinite(operator.familiarityScore) ? operator.familiarityScore : 50;
  const familiarity = clamp(familiarityScore, 0, 100) / 100;
  const obscurity = 1 - familiarity;
  const attemptRatio = clamp((context.attempts || 0) / Math.max(1, context.maxAttempts || 1));
  const stallRatio = clamp((context.stallCount || 0) / 3);
  const remainingRatio = clamp((context.candidateCount || 1) / ALL_NAMES.length);
  const confirmedRatio = clamp((context.confirmedCount || 0) / 6);
  const momentumRatio = clamp((context.assistMomentum || 0) / 100);
  const recentProgress = clamp(context.recentProgress || 0);
  const need = clamp(
    0.62 * Math.pow(obscurity, 0.72)
    + 0.10 * attemptRatio
    + 0.16 * stallRatio
    + 0.12 * remainingRatio
    + 0.10 * momentumRatio
    - 0.08 * confirmedRatio
    - 0.10 * recentProgress
  );
  let strength = 1 + 3.5 * need;
  if (familiarityScore <= 25) strength = Math.max(strength, 4.05);
  else if (familiarityScore <= 40) strength = Math.max(strength, 3.35);
  else if (familiarityScore >= 82) strength = Math.min(strength, 2.35);
  return strength;
}

function finalizeCluePlan(operator, plan, context) {
  if (!plan || plan.kind) return plan;
  const source = clueData[operator.id] || {};
  const skills = source.skills || [];
  const iconSkillIndexes = skills
    .map((skill, index) => skill.iconUrl ? index : -1)
    .filter((index) => index >= 0);
  const fragments = source.fragmentUrls || [];
  const quotes = source.quotes || [];
  const quoteIndexesByTier = {
    low: quotes.map((quote, index) => quote.informationTier !== "high" ? index : -1).filter((index) => index >= 0),
    high: quotes.map((quote, index) => quote.informationTier === "high" ? index : -1).filter((index) => index >= 0),
  };
  const target = Number.isFinite(context && context.targetStrength)
    ? context.targetStrength
    : targetClueStrength(operator, context || {});
  const familiarityScore = Number.isFinite(operator.familiarityScore) ? operator.familiarityScore : 50;
  const obscurity = 1 - clamp(familiarityScore, 0, 100) / 100;
  const allSkills = Boolean(context && context.allSkills);
  const themeId = context && context.themeId;
  const available = CLUE_PROFILES.filter((profile) => {
    const skillFields = allSkills && MULTI_SKILL_CLUE_FIELDS[profile.kind];
    if (profile.kind === "silhouette") return Boolean(source.silhouetteUrl);
    if (profile.kind === "artFragment") return Boolean(fragments[profile.itemIndex]);
    if (profile.kind === "quote") return (quoteIndexesByTier[profile.quoteTier] || []).length > 0;
    if (skillFields && skillFields.includes("mechanic") && DIRECTIVE_MECHANIC_THEME_IDS.has(themeId)) {
      return false;
    }
    if (skillFields && skillFields.includes("icon")) {
      return skills.length > 0 && iconSkillIndexes.length === skills.length;
    }
    if (profile.kind === "skillIcon") {
      return allSkills ? skills.length > 0 && iconSkillIndexes.length === skills.length : iconSkillIndexes.length > 0;
    }
    if (profile.kind === "skillMechanic" && DIRECTIVE_MECHANIC_THEME_IDS.has(themeId)) return false;
    return skills.length > 0;
  }).map((profile) => {
    const skillFields = allSkills ? MULTI_SKILL_CLUE_FIELDS[profile.kind] : null;
    const strength = allSkills && MULTI_SKILL_CLUE_STRENGTH[profile.kind]
      ? MULTI_SKILL_CLUE_STRENGTH[profile.kind]
      : profile.strength;
    const weightFactor = allSkills && MULTI_SKILL_CLUE_WEIGHT[profile.kind]
      ? MULTI_SKILL_CLUE_WEIGHT[profile.kind]
      : 1;
    const distance = strength - target;
    const directionFactor = distance < 0
      ? 1 - 0.72 * obscurity * clamp(-distance / 3.5)
      : 1 - 0.48 * (1 - obscurity) * clamp(distance / 3.5);
    const silhouetteFactor = profile.kind === "silhouette"
      ? silhouetteRewardFactor(operator, Boolean(themeId))
      : 1;
    return {
      value: { ...profile, strength, skillFields },
      weight: profile.baseWeight
        * weightFactor
        * silhouetteFactor
        * (themeId ? directiveRewardFit(strength, familiarityScore) : 1)
        * (themeId ? directiveRewardBandFactor(strength, familiarityScore) : 1)
        * (themeId ? directiveQuoteTierFactor(profile.quoteTier, familiarityScore) : 1)
        * Math.max(0.12, directionFactor)
        * (0.07 + Math.exp(-1.05 * distance * distance)),
    };
  });
  if (!available.length) return null;

  const selected = weightedChoice(available, seededUnit(plan.seed, "kind"));
  let itemIndex = selected.itemIndex || 0;
  if (selected.kind === "quote") {
    const quoteIndexes = quoteIndexesByTier[selected.quoteTier];
    itemIndex = quoteIndexes[Math.floor(seededUnit(plan.seed, `quote-${selected.quoteTier}`) * quoteIndexes.length)];
  }
  if (selected.kind === "skillIcon" && !allSkills) {
    const iconIndex = Math.floor(seededUnit(plan.seed, "skill-icon") * iconSkillIndexes.length);
    itemIndex = iconSkillIndexes[iconIndex];
  }
  if (!allSkills && ["skillMechanic", "skillName"].includes(selected.kind)) {
    itemIndex = Math.floor(seededUnit(plan.seed, selected.kind) * skills.length);
  }
  return {
    ...plan,
    kind: selected.skillFields ? "skillBundle" : selected.kind,
    itemIndex,
    strength: selected.strength,
    allSkills,
    ...(selected.kind === "quote" ? { quoteTier: selected.quoteTier } : {}),
    ...(selected.skillFields ? { skillFields: selected.skillFields } : {}),
  };
}

function newGame(mode, requestedMax, requestedVersion, recentThemeIds) {
  const pool = poolFor(mode);
  const usesDirectiveThemes = mode === "sudden" && Number(requestedVersion) === SUDDEN_THEME_VERSION;
  const coralOpeningSelected = usesDirectiveThemes
    && CORAL_SECRET_NAMES.length > 0
    && shouldOpenCoral(recentThemeIds, Math.random());
  const secretPool = coralOpeningSelected ? CORAL_SECRET_NAMES : pool;
  const secretName = secretPool[Math.floor(Math.random() * secretPool.length)];
  const maxAttempts = mode === "sudden" ? normalizeSuddenMax(requestedMax) : null;
  if (mode === "endless" && Number(requestedVersion) === SUDDEN_THEME_VERSION) {
    const session = {
      version: SUDDEN_THEME_VERSION,
      name: secretName,
      mode,
      guesses: [],
      rotationPlan: buildRotationPlan(ROTATING_KEYS.length),
    };
    return {
      token: encrypt(session),
      total: pool.length,
      maxAttempts,
      version: SUDDEN_THEME_VERSION,
    };
  }
  if (usesDirectiveThemes) {
    const secret = data[secretName];
    const theme = coralOpeningSelected
      ? THEME_DEFINITIONS[FIRST_VISUAL_THEME_ID]
      : selectDirective(secret, Math.random(), recentThemeIds);
    if (!theme) throw new Error(`No tactical directive is available for ${secret.id}`);
    const themeGoal = Math.min(maxAttempts, directiveGoal(secret, theme));
    const cluePlan = finalizeCluePlan(secret, createCluePlan(secret), {
      targetStrength: directiveClueStrength(secret, theme),
      themeId: theme.id,
      allSkills: true,
    });
    const session = {
      version: SUDDEN_THEME_VERSION,
      name: secretName,
      mode,
      guesses: [],
      maxAttempts,
      rotationPlan: buildRotationPlan(maxAttempts),
      confirmedKeys: [],
      candidateCount: theme.memberCount,
      themeId: theme.id,
      themeGoal,
      themeHits: [],
      clueStatus: "locked",
      cluePlan,
    };
    return {
      token: encrypt(session),
      total: pool.length,
      maxAttempts,
      version: SUDDEN_THEME_VERSION,
      theme: directivePublicState(session),
    };
  }
  if (mode === "sudden" && Number(requestedVersion) === SUDDEN_VERSION) {
    const secret = data[secretName];
    const session = {
      version: SUDDEN_VERSION,
      name: secretName,
      mode,
      guesses: [],
      maxAttempts,
      rotationPlan: buildRotationPlan(maxAttempts),
      confirmedKeys: [],
      candidateCount: pool.length,
      stallCount: 0,
      assistMomentum: 0,
      assistScore: 0,
      clueStatus: "locked",
      cluePlan: createCluePlan(secret),
    };
    return {
      token: encrypt(session),
      total: pool.length,
      maxAttempts,
      version: SUDDEN_VERSION,
      assist: assistPublicState(session, []),
    };
  }
  const token = encrypt({ name: secretName, mode, guesses: [], maxAttempts });
  return { token, total: pool.length, maxAttempts };
}

function cmp(first, second) {
  if (first === second) return 0;
  return first > second ? 1 : -1;
}

function expState(guess, secret) {
  if (guess === null || secret === null) return "unknown";
  if (guess === secret) return "exact";
  return guess > secret ? "high" : "low";
}

function originState(guess, secret) {
  if (!guess || !secret) return "unknown";
  return guess === secret ? "exact" : "wrong";
}

function signedDayDiff(guess, secret) {
  const guessDate = new Date(2000, guess.month - 1, guess.day);
  const secretDate = new Date(2000, secret.month - 1, secret.day);
  const raw = (secretDate - guessDate) / 86400000;
  const forward = ((raw % 366) + 366) % 366;
  return forward > 183 ? forward - 366 : forward;
}

function birthdayState(guess, secret, guessText, secretText) {
  if (!guess || !secret) {
    return { state: "unknown", close: false, guess, answer: secret, guessText, answerText: secretText };
  }
  const difference = signedDayDiff(guess, secret);
  const base = { guess, answer: secret, guessText, answerText: secretText };
  if (difference === 0) return { state: "exact", close: false, ...base };
  return {
    state: difference > 0 ? "after" : "before",
    close: Math.abs(difference) <= BIRTHDAY_CLOSE_DAYS,
    ...base,
  };
}

function heightState(guess, secret) {
  if (guess === null || secret === null) return { state: "unknown", close: false };
  if (guess === secret) return { state: "exact", close: false };
  return { state: guess > secret ? "high" : "low", close: Math.abs(guess - secret) <= HEIGHT_CLOSE_CM };
}

function infectedState(guess, secret) {
  if (guess === null || secret === null) return "unknown";
  return guess === secret ? "exact" : "wrong";
}

// Legacy comparison is kept for endless and existing sudden clients until the
// frontend explicitly requests v=2.
function legacyDimResult(secret, guess) {
  return {
    profession: {
      state: guess.profession === secret.profession ? "exact" : "wrong",
      guess: guess.profession,
      answer: secret.profession,
      guessText: guess.professionText,
      answerText: secret.professionText,
    },
    subProfession: {
      state: guess.subProfessionId === secret.subProfessionId ? "exact" : "wrong",
      guess: guess.subProfessionId,
      answer: secret.subProfessionId,
      guessText: guess.subProfessionText,
      answerText: secret.subProfessionText,
    },
    rarity: {
      state: guess.rarity === secret.rarity ? "exact" : cmp(guess.rarity, secret.rarity) > 0 ? "high" : "low",
      guess: guess.rarity,
      answer: secret.rarity,
      guessText: guess.rarity + "星",
      answerText: secret.rarity + "星",
    },
    position: {
      state: guess.position === secret.position ? "exact" : "wrong",
      guess: guess.position,
      answer: secret.position,
      guessText: guess.position === "RANGED" ? "远程" : "近战",
      answerText: secret.position === "RANGED" ? "远程" : "近战",
    },
    tags: {
      state: "hint",
      shared: guess.tags.filter((tag) => secret.tags.includes(tag)),
      guess: guess.tags,
      answer: secret.tags,
    },
    gender: {
      state: guess.gender === secret.gender ? "exact" : "wrong",
      guess: guess.gender,
      answer: secret.gender,
    },
    exp: {
      state: expState(guess.exp, secret.exp),
      guess: guess.exp,
      answer: secret.exp,
      guessText: guess.expText,
      answerText: secret.expText,
      special: !!guess.expSpecial,
    },
    origin: {
      state: originState(guess.origin, secret.origin),
      guess: guess.origin,
      answer: secret.origin,
      special: !!guess.originSpecial,
    },
    birthday: birthdayState(guess.birthday, secret.birthday, guess.birthdayText, secret.birthdayText),
    race: {
      state: guess.race === secret.race ? "exact" : "wrong",
      guess: guess.race,
      answer: secret.race,
      special: !!guess.raceSpecial,
    },
    height: {
      ...heightState(guess.height, secret.height),
      guess: guess.height,
      answer: secret.height,
      guessText: guess.heightText,
      answerText: secret.heightText,
    },
    infected: {
      state: infectedState(guess.infected, secret.infected),
      guess: guess.infected,
      answer: secret.infected,
    },
  };
}

function v2DirectionalState(guess, secret) {
  if (guess === null || secret === null || guess === undefined || secret === undefined) return "unknown";
  if (guess === secret) return "exact";
  return guess > secret ? "higher" : "lower";
}

function equalSets(first, second) {
  const left = Array.from(new Set(first || [])).sort();
  const right = Array.from(new Set(second || [])).sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function cellKey(cell) {
  return `${cell.x},${cell.y}`;
}

function rangeCellsResult(secretCells, guessCells) {
  secretCells = secretCells || [];
  guessCells = guessCells || [];
  if (!guessCells.length || !secretCells.length) {
    return {
      state: "unknown",
      overlapCount: 0,
      guessCellCount: guessCells.filter((cell) => cell.x !== 0 || cell.y !== 0).length,
      cells: guessCells.map((cell) => ({
        ...cell,
        state: cell.x === 0 && cell.y === 0 ? "origin" : "guessOnly",
      })),
    };
  }
  const secretSet = new Set(secretCells.map(cellKey));
  const guessSet = new Set(guessCells.map(cellKey));
  const guessAttackCells = guessCells.filter((cell) => cell.x !== 0 || cell.y !== 0);
  const overlap = guessAttackCells.filter((cell) => secretSet.has(cellKey(cell)));
  const exact = guessSet.size === secretSet.size && Array.from(guessSet).every((key) => secretSet.has(key));
  return {
    state: exact ? "exact" : overlap.length ? "related" : "wrong",
    overlapCount: overlap.length,
    guessCellCount: guessAttackCells.length,
    cells: guessCells.map((cell) => ({
      x: cell.x,
      y: cell.y,
      state: cell.x === 0 && cell.y === 0 ? "origin" : secretSet.has(cellKey(cell)) ? "overlap" : "guessOnly",
    })),
  };
}

function skillRangeResult(secret, guess) {
  const secretRanges = secret.skillRanges || [];
  const guessRanges = guess.skillRanges || [];
  const guessSkillMechanics = new Map(
    (((clueData[guess.id] || {}).skills) || []).map((skill) => [skill.slot, skill.mechanic || null])
  );
  const secretBySlot = new Map(secretRanges.map((entry) => [entry.slot, entry]));
  const slots = guessRanges.map((guessRange) => {
    const secretRange = secretBySlot.get(guessRange.slot);
    const result = secretRange
      ? rangeCellsResult(secretRange.rangeCells, guessRange.rangeCells || [])
      : {
        state: "wrong",
        overlapCount: 0,
        guessCellCount: (guessRange.rangeCells || []).filter((cell) => cell.x !== 0 || cell.y !== 0).length,
        cells: (guessRange.rangeCells || []).map((cell) => ({
          ...cell,
          state: cell.x === 0 && cell.y === 0 ? "origin" : "guessOnly",
        })),
      };
    return {
      slot: guessRange.slot,
      inherited: !guessRange.rangeOverridden,
      mechanic: guessSkillMechanics.get(guessRange.slot) || null,
      ...result,
    };
  });
  const sameSkillCount = guessRanges.length === secretRanges.length;
  const exact = sameSkillCount && slots.length > 0 && slots.every((slot) => slot.state === "exact");
  const related = slots.some((slot) => slot.state === "exact" || slot.state === "related");
  const state = !guessRanges.length
    ? "unknown"
    : !secretRanges.length
      ? "wrong"
    : exact
      ? "exact"
      : related
        ? "related"
        : "wrong";
  const primary = slots[0] || { cells: [], overlapCount: 0, guessCellCount: 0 };
  return {
    state,
    slots,
    guessSkillCount: guessRanges.length,
    exactSkillCount: slots.filter((slot) => slot.state === "exact").length,
    cells: primary.cells,
    overlapCount: primary.overlapCount,
    guessCellCount: primary.guessCellCount,
  };
}

function powerResult(secret, guess) {
  const guessPower = guess.power || {};
  const secretPower = secret.power || {};
  let state = "wrong";
  if (!guessPower.id || !secretPower.id || guessPower.id === "none" || secretPower.id === "none") {
    state = guessPower.id === secretPower.id && guessPower.id ? "exact" : "unknown";
  } else if (guessPower.id === secretPower.id) {
    state = "exact";
  } else if (guessPower.rootId && guessPower.rootId === secretPower.rootId) {
    state = "related";
  }
  return {
    state,
    guess: {
      name: guessPower.name || "未知",
      parentName: guessPower.parentName
        || (guessPower.rootName && guessPower.rootName !== guessPower.name ? guessPower.rootName : null),
      logoUrl: guessPower.logoUrl || null,
    },
  };
}

function v2BirthdayResult(secret, guess) {
  if (!guess.birthday || !secret.birthday) {
    return { state: "unknown", close: false, guessText: guess.birthdayText || "未知" };
  }
  const difference = signedDayDiff(guess.birthday, secret.birthday);
  if (difference === 0) return { state: "exact", close: false, guessText: guess.birthdayText };
  return {
    state: difference > 0 ? "before" : "after",
    close: Math.abs(difference) <= BIRTHDAY_CLOSE_DAYS,
    guessText: guess.birthdayText,
  };
}

function rotatingResult(secret, guess, key) {
  if (key === "birthday") return v2BirthdayResult(secret, guess);
  if (key === "height") {
    const result = heightState(guess.height, secret.height);
    return {
      state: result.state === "high" ? "higher" : result.state === "low" ? "lower" : result.state,
      close: result.close,
      guessText: guess.heightText || "未知",
    };
  }
  if (key === "exp") {
    const state = expState(guess.exp, secret.exp);
    return {
      state: state === "high" ? "higher" : state === "low" ? "lower" : state,
      guessText: guess.expText || "未知",
      special: !!guess.expSpecial,
    };
  }
  return {
    state: infectedState(guess.infected, secret.infected),
    guessText: guess.infected === true ? "感染者" : guess.infected === false ? "非感染者" : "未知",
  };
}

function suddenComparison(secret, guess, rotatingKey) {
  const sharedTags = (guess.tags || []).filter((tag) => (secret.tags || []).includes(tag));
  const tagState = equalSets(guess.tags, secret.tags) ? "exact" : sharedTags.length ? "related" : "wrong";
  const dims = {
    profession: {
      state: guess.profession === secret.profession ? "exact" : "wrong",
      guessText: guess.professionText,
    },
    subProfession: {
      state: guess.subProfessionId === secret.subProfessionId ? "exact" : "wrong",
      guessText: guess.subProfessionText,
    },
    rarity: {
      state: v2DirectionalState(guess.rarity, secret.rarity),
      guessValue: guess.rarity,
      guessText: guess.rarity + "星",
    },
    position: {
      state: guess.position === secret.position ? "exact" : "wrong",
      guessText: guess.position === "RANGED" ? "远程" : "近战",
    },
    tags: { state: tagState, guess: guess.tags || [], shared: sharedTags },
    gender: {
      state: guess.gender === null || secret.gender === null ? "unknown" : guess.gender === secret.gender ? "exact" : "wrong",
      guessText: guess.gender || "未知",
    },
    origin: {
      state: originState(guess.origin, secret.origin),
      guessText: guess.origin || "未知",
      special: !!guess.originSpecial,
    },
    race: {
      state: !guess.race || !secret.race ? "unknown" : guess.race === secret.race ? "exact" : "wrong",
      guessText: guess.race || "未知",
      special: !!guess.raceSpecial,
    },
    power: powerResult(secret, guess),
    deploymentTemplate: skillRangeResult(secret, guess),
    deploymentCost: {
      state: v2DirectionalState(guess.deploymentCost, secret.deploymentCost),
      guessValue: guess.deploymentCost,
      guessText: guess.deploymentCost === null ? "未知" : String(guess.deploymentCost),
    },
  };
  return {
    dims,
    rotatingIntel: {
      key: rotatingKey,
      label: {
        birthday: "生日",
        height: "身高",
        exp: "战斗经验",
        infected: "矿石病感染情况",
      }[rotatingKey],
      result: rotatingResult(secret, guess, rotatingKey),
    },
  };
}

function exactKeys(comparison) {
  const keys = V2_FIXED_KEYS.filter((key) => comparison.dims[key].state === "exact");
  if (comparison.rotatingIntel.result.state === "exact") keys.push(comparison.rotatingIntel.key);
  return keys;
}

function resultSignature(secret, guess, rotatingKey) {
  const comparison = suddenComparison(secret, guess, rotatingKey);
  const dims = comparison.dims;
  return JSON.stringify({
    profession: dims.profession.state,
    subProfession: dims.subProfession.state,
    rarity: dims.rarity.state,
    position: dims.position.state,
    tags: [dims.tags.state, dims.tags.shared.slice().sort()],
    gender: dims.gender.state,
    origin: dims.origin.state,
    race: dims.race.state,
    power: dims.power.state,
    deploymentTemplate: [
      dims.deploymentTemplate.state,
      dims.deploymentTemplate.slots.map((slot) => [
        slot.slot,
        slot.state,
        slot.cells
          .filter((cell) => cell.state === "overlap")
          .map(cellKey)
          .sort(),
      ]),
    ],
    deploymentCost: dims.deploymentCost.state,
    rotating: [
      comparison.rotatingIntel.key,
      comparison.rotatingIntel.result.state,
      !!comparison.rotatingIntel.result.close,
    ],
  });
}

function remainingCandidateCount(secret, guessNames, rotationPlan, themeId = null) {
  const signatures = guessNames.map((guessName, index) =>
    resultSignature(secret, data[guessName], rotationPlan[index])
  );
  const guessed = new Set(guessNames);
  let count = 0;
  for (const candidateName of ALL_NAMES) {
    if (guessed.has(candidateName)) continue;
    const candidate = data[candidateName];
    if (themeId && !directiveMatches(themeId, candidate)) continue;
    let matches = true;
    for (let index = 0; index < guessNames.length; index++) {
      if (resultSignature(candidate, data[guessNames[index]], rotationPlan[index]) !== signatures[index]) {
        matches = false;
        break;
      }
    }
    if (matches) count++;
  }
  return Math.max(1, count);
}

function progressLevel(newlyConfirmed, previousCandidates, currentCandidates) {
  const reduction = previousCandidates > 0 ? 1 - currentCandidates / previousCandidates : 0;
  if (newlyConfirmed.length >= 2 || reduction >= 0.5) return { value: 1, reduction, stalled: false };
  if (newlyConfirmed.length >= 1 || reduction >= 0.2) return { value: 0.5, reduction, stalled: false };
  return { value: 0, reduction, stalled: true };
}

function dynamicAssistState(secret, context) {
  const familiarityScore = Number.isFinite(secret.familiarityScore) ? secret.familiarityScore : 50;
  const obscurity = 1 - clamp(familiarityScore, 0, 100) / 100;
  const attempts = context.attempts || 0;
  const maxAttempts = Math.max(1, context.maxAttempts || 1);
  const attemptRatio = clamp(attempts / maxAttempts);
  const stallRatio = clamp((context.stallCount || 0) / 3);
  const confirmedRatio = clamp((context.confirmedCount || 0) / 6);
  const evidenceGap = 1 - confirmedRatio;
  const candidateCount = Math.max(1, context.candidateCount || 1);
  const ambiguity = clamp(
    Math.log2(candidateCount + 1) / Math.log2(ALL_NAMES.length + 1)
  );
  const recentProgress = clamp(context.recentProgress || 0);
  const instantNeed = clamp(
    0.30 * obscurity
    + 0.22 * attemptRatio
    + 0.20 * stallRatio
    + 0.18 * ambiguity
    + 0.10 * evidenceGap
    - 0.22 * recentProgress
  );
  const previousMomentum = clamp(context.previousMomentum || 0, 0, 100);
  const progressAdjustment = recentProgress === 0 ? 8 : -8 * recentProgress;
  const momentum = clamp(
    previousMomentum * 0.45 + instantNeed * 45 + progressAdjustment,
    0,
    100
  );
  const threshold = 74
    - 10 * stallRatio
    - 7 * obscurity
    - 4 * attemptRatio;
  const readiness = momentum - threshold;
  const probability = attempts < ASSIST_MIN_ATTEMPT
    ? 0
    : clamp((readiness + 8) / 45, 0, 0.82);
  const roll = seededUnit(context.seed || "assist", `unlock:${attempts}`);
  const forced = attempts >= maxAttempts
    && recentProgress < 0.5
    && ((context.stallCount || 0) >= 2 || obscurity >= 0.55 || ambiguity >= 0.55);
  return {
    momentum,
    signal: Math.round(clamp(50 + readiness * 2, 0, 100)),
    probability,
    roll,
    unlock: attempts >= ASSIST_MIN_ATTEMPT && (forced || roll < probability),
    forced,
  };
}

function dynamicAssistScore(secret, attempts, maxAttempts, stallCount, candidateCount, confirmedCount, recentProgress, previousMomentum = 0) {
  return dynamicAssistState(secret, {
    attempts,
    maxAttempts,
    stallCount,
    candidateCount,
    confirmedCount,
    recentProgress,
    previousMomentum,
    seed: "score-preview",
  }).signal;
}

function assistPublicState(session, newlyConfirmed) {
  if (session.clueStatus === "pending") {
    return {
      status: "pending",
      trend: "critical",
      message: "检测到连续推理停滞，辅助档案已授权",
      confirmedCount: (session.confirmedKeys || []).length,
      newlyConfirmed,
    };
  }
  if (session.clueStatus === "revealed") {
    return {
      status: "revealed",
      trend: "stable",
      message: "本局辅助情报已使用",
      confirmedCount: (session.confirmedKeys || []).length,
      newlyConfirmed,
    };
  }
  const score = session.assistScore || 0;
  const trend = score >= 82 ? "critical" : score >= 56 ? "rising" : "stable";
  return {
    status: trend === "stable" ? "monitoring" : "rising",
    trend,
    message: trend === "stable" ? "推理链路稳定，辅助情报暂未授权" : "有效信息不足，辅助权限正在提升",
    confirmedCount: (session.confirmedKeys || []).length,
    newlyConfirmed,
  };
}

function pendingClues(session) {
  if (session.clueStatus !== "pending" || !session.cluePlan) return [];
  return [{
    id: session.cluePlan.id,
    label: session.version === SUDDEN_THEME_VERSION ? "战术指令情报已授权" : "待解码情报",
  }];
}

function guessSuddenV3(session, guessName) {
  const secret = data[session.name];
  if (!secret || !THEME_DEFINITIONS[session.themeId]) return { error: "invalid_session" };
  const maxAttempts = sessionSuddenMax(session);
  const oldGuesses = session.guesses || [];
  if (oldGuesses.length >= maxAttempts) return { error: "attempts_exhausted" };
  const guess = data[guessName];
  if (!guess) return { error: "unknown_operator" };
  if (oldGuesses.includes(guessName)) return { error: "duplicate_guess" };

  const won = guessName === session.name;
  const rotatingKey = session.rotationPlan[oldGuesses.length];
  const comparison = suddenComparison(secret, guess, rotatingKey);
  const guesses = oldGuesses.concat(guessName);
  const remaining = Math.max(0, maxAttempts - guesses.length);
  const previousConfirmed = new Set(session.confirmedKeys || []);
  const newlyConfirmed = exactKeys(comparison).filter((key) => !previousConfirmed.has(key));
  for (const key of newlyConfirmed) previousConfirmed.add(key);

  let candidateCount = session.candidateCount || ALL_NAMES.length;
  let themeHits = session.themeHits || [];
  let clueStatus = session.clueStatus || "locked";
  const matched = directiveMatches(session.themeId, guess);
  const previousProgress = themeHits.length;
  if (!won) {
    candidateCount = remainingCandidateCount(secret, guesses, session.rotationPlan, session.themeId);
    if (matched && themeHits.length < session.themeGoal) themeHits = themeHits.concat(guessName);
    if (clueStatus === "locked" && themeHits.length >= session.themeGoal && session.cluePlan) {
      clueStatus = "pending";
    }
  }

  const nextSession = {
    ...session,
    guesses,
    confirmedKeys: Array.from(previousConfirmed),
    candidateCount,
    themeHits,
    clueStatus,
  };
  const progress = Math.min(session.themeGoal, themeHits.length);
  const completed = progress >= session.themeGoal;
  const out = {
    win: won,
    guessName: guess.name,
    mode: "sudden",
    version: SUDDEN_THEME_VERSION,
    total: ALL_NAMES.length,
    remaining,
    dims: comparison.dims,
    rotatingIntel: comparison.rotatingIntel,
    operator: operatorProfileWithThemeArt(guess, session.themeId),
    theme: directivePublicState(nextSession),
    themeResult: {
      matched,
      progress,
      goal: session.themeGoal,
      completed,
      newlyCompleted: !won && previousProgress < session.themeGoal && completed,
    },
    pendingClues: pendingClues(nextSession),
    token: encrypt(nextSession),
  };
  if (won) {
    out.answerName = secret.name;
    out.operator = operatorProfileWithThemeArt(secret, session.themeId);
    out.archive = personnelArchive(secret);
    out.pendingClues = [];
  }
  return out;
}

function guessSuddenV2(session, guessName) {
  const secret = data[session.name];
  if (!secret) return { error: "invalid_session" };
  const maxAttempts = sessionSuddenMax(session);
  const oldGuesses = session.guesses || [];
  if (oldGuesses.length >= maxAttempts) return { error: "attempts_exhausted" };
  const guess = data[guessName];
  if (!guess) return { error: "unknown_operator" };
  if (oldGuesses.includes(guessName)) return { error: "duplicate_guess" };
  const won = guessName === session.name;
  const rotatingKey = session.rotationPlan[oldGuesses.length];
  const comparison = suddenComparison(secret, guess, rotatingKey);
  const guesses = oldGuesses.concat(guessName);
  const remaining = Math.max(0, maxAttempts - guesses.length);
  const previousConfirmed = new Set(session.confirmedKeys || []);
  const newlyConfirmed = exactKeys(comparison).filter((key) => !previousConfirmed.has(key));
  for (const key of newlyConfirmed) previousConfirmed.add(key);

  let candidateCount = session.candidateCount || ALL_NAMES.length;
  let stallCount = session.stallCount || 0;
  let assistMomentum = session.assistMomentum || 0;
  let assistScore = session.assistScore || 0;
  let clueStatus = session.clueStatus || "locked";
  let cluePlan = session.cluePlan;
  if (!won) {
    const nextCandidateCount = remainingCandidateCount(secret, guesses, session.rotationPlan);
    const progress = progressLevel(newlyConfirmed, candidateCount, nextCandidateCount);
    stallCount = progress.stalled ? stallCount + 1 : 0;
    candidateCount = nextCandidateCount;
    const assistState = dynamicAssistState(secret, {
      attempts: guesses.length,
      maxAttempts,
      stallCount,
      candidateCount,
      confirmedCount: previousConfirmed.size,
      recentProgress: progress.value,
      previousMomentum: assistMomentum,
      seed: (cluePlan && (cluePlan.seed || cluePlan.id)) || session.name,
    });
    assistMomentum = assistState.momentum;
    assistScore = assistState.signal;
    if (
      clueStatus === "locked"
      && cluePlan
      && assistState.unlock
    ) {
      cluePlan = finalizeCluePlan(secret, cluePlan, {
        attempts: guesses.length,
        maxAttempts,
        stallCount,
        candidateCount,
        confirmedCount: previousConfirmed.size,
        recentProgress: progress.value,
        assistMomentum,
      });
      if (cluePlan) clueStatus = "pending";
    }
  }

  const nextSession = {
    ...session,
    guesses,
    confirmedKeys: Array.from(previousConfirmed),
    candidateCount,
    stallCount,
    assistMomentum,
    assistScore,
    clueStatus,
    cluePlan,
  };
  const out = {
    win: won,
    guessName: guess.name,
    mode: "sudden",
    version: SUDDEN_VERSION,
    total: ALL_NAMES.length,
    remaining,
    dims: comparison.dims,
    rotatingIntel: comparison.rotatingIntel,
    operator: publicProfile(guess),
    assist: assistPublicState(nextSession, newlyConfirmed),
    pendingClues: pendingClues(nextSession),
    token: encrypt(nextSession),
  };
  if (won) {
    out.answerName = secret.name;
    out.operator = publicProfile(secret);
    out.archive = personnelArchive(secret);
    out.pendingClues = [];
  }
  return out;
}

function guessLegacy(session, guessName) {
  const secret = data[session.name];
  if (!secret) return { error: "invalid_session" };
  const maxAttempts = session.mode === "sudden" ? sessionSuddenMax(session) : null;
  if (session.mode === "sudden" && (session.guesses || []).length >= maxAttempts) {
    return { error: "attempts_exhausted" };
  }
  const guessOperator = data[guessName];
  if (!guessOperator) return { error: "unknown_operator" };
  const won = guessName === session.name;
  const dims = legacyDimResult(secret, guessOperator);
  if (won) {
    for (const key of Object.keys(dims)) dims[key].state = "exact";
  }
  const guesses = (session.guesses || []).concat([guessName]);
  const remaining = session.mode === "sudden" ? Math.max(0, maxAttempts - guesses.length) : null;
  const out = {
    win: won,
    guessName: guessOperator.name,
    mode: session.mode,
    total: poolFor(session.mode).length,
    remaining,
    dims,
    operator: publicProfile(guessOperator),
    token: encrypt({ name: session.name, mode: session.mode, guesses, maxAttempts }),
  };
  if (won) {
    out.answerName = secret.name;
    out.archive = personnelArchive(secret);
  }
  return out;
}

function guessEndlessComparison(session, guessName) {
  const secret = data[session.name];
  if (!secret) return { error: "invalid_session" };
  const oldGuesses = session.guesses || [];
  const guessOperator = data[guessName];
  if (!guessOperator) return { error: "unknown_operator" };
  if (oldGuesses.includes(guessName)) return { error: "duplicate_guess" };

  const rotationPlan = extendRotationPlan(session.rotationPlan, oldGuesses.length + 1);
  const comparison = suddenComparison(secret, guessOperator, rotationPlan[oldGuesses.length]);
  const won = guessName === session.name;
  const guesses = oldGuesses.concat(guessName);
  const nextSession = { ...session, guesses, rotationPlan };
  const out = {
    win: won,
    guessName: guessOperator.name,
    mode: "endless",
    version: session.version,
    total: ALL_NAMES.length,
    remaining: null,
    dims: comparison.dims,
    rotatingIntel: comparison.rotatingIntel,
    operator: publicProfile(guessOperator),
    token: encrypt(nextSession),
  };
  if (won) {
    out.answerName = secret.name;
    out.operator = publicProfile(secret);
    out.archive = personnelArchive(secret);
  }
  return out;
}

function guess(token, guessName) {
  const session = decrypt(token);
  if (!session) return { error: "invalid_session" };
  if (session.mode === "endless" && isComparisonVersion(session.version)) {
    return guessEndlessComparison(session, guessName);
  }
  if (session.mode === "sudden" && session.version === SUDDEN_THEME_VERSION) {
    return guessSuddenV3(session, guessName);
  }
  if (session.mode === "sudden" && session.version === SUDDEN_VERSION) {
    return guessSuddenV2(session, guessName);
  }
  return guessLegacy(session, guessName);
}

function choices(token) {
  const session = decrypt(token);
  if (!session) return { error: "invalid_session" };
  const secret = data[session.name];
  if (!secret) return { error: "invalid_session" };
  const maxAttempts = sessionSuddenMax(session);
  if (session.mode !== "sudden" || (session.guesses || []).length < maxAttempts) {
    return { error: "invalid_phase" };
  }
  const pool = poolFor(session.mode).filter((name) =>
    name !== session.name && !(session.guesses || []).includes(name)
  );
  const sameRarity = (operator) => operator.rarity === secret.rarity;
  const sameGender = (operator) => operator.gender === secret.gender;
  const sameProfession = (operator) => operator.profession === secret.profession;
  const sameRace = (operator) => operator.race === secret.race;
  const ranked = shuffle(pool).map((name) => {
    const operator = data[name];
    return {
      name,
      rarity: sameRarity(operator),
      gender: sameGender(operator),
      profession: sameProfession(operator),
      race: sameRace(operator),
    };
  });
  const priorityScore = (candidate) =>
    (candidate.rarity ? 8 : 0)
    + (candidate.gender ? 8 : 0)
    + (candidate.profession ? 2 : 0)
    + (candidate.race ? 1 : 0);
  ranked.sort((first, second) => priorityScore(second) - priorityScore(first));
  const distractors = ranked.slice(0, 3).map((candidate) => candidate.name);

  const optionNames = shuffle([session.name].concat(distractors.slice(0, 3)));
  const relaxedCount = optionNames.filter((name) => {
    const operator = data[name];
    return !sameRarity(operator) || !sameGender(operator)
      || !sameProfession(operator) || !sameRace(operator);
  }).length;
  const useSilhouettes = session.version === SUDDEN_THEME_VERSION
    && session.clueStatus === "revealed"
    && ["silhouette", "artFragment"].includes((session.cluePlan || {}).kind);
  const answerSilhouetteUrl = useSilhouettes ? (clueData[secret.id] || {}).silhouetteUrl : null;
  return {
    version: session.version || 1,
    options: optionNames.map((name) => {
      const operator = data[name];
      if (!useSilhouettes) return choiceProfile(operator);
      return choiceProfile(operator, answerSilhouetteUrl);
    }),
    choicePresentation: useSilhouettes ? "silhouette" : "operatorArt",
    remaining: 0,
    relaxedCount,
  };
}

function pick(token, pickName) {
  const session = decrypt(token);
  if (!session) return { error: "invalid_session" };
  const secret = data[session.name];
  if (!secret) return { error: "invalid_session" };
  const picked = data[pickName];
  if (!picked) return { error: "unknown_operator" };
  if (
    isComparisonVersion(session.version)
    && (session.mode !== "sudden" || (session.guesses || []).length < sessionSuddenMax(session))
  ) {
    return { error: "invalid_phase" };
  }
  const won = pickName === session.name;
  if (isComparisonVersion(session.version)) {
    const out = {
      version: session.version,
      win: won,
      answerName: secret.name,
      pickName,
      operator: operatorProfileWithThemeArt(secret, session.themeId),
      archive: personnelArchive(secret),
    };
    if (!won) {
      const guessCount = (session.guesses || []).length;
      const rotationPlan = extendRotationPlan(session.rotationPlan, guessCount + 1);
      const comparison = suddenComparison(secret, picked, rotationPlan[guessCount]);
      out.pickRecord = {
        guessName: picked.name,
        dims: comparison.dims,
        rotatingIntel: comparison.rotatingIntel,
        operator: operatorProfileWithThemeArt(picked, session.themeId),
      };
    }
    return out;
  }
  const dims = legacyDimResult(secret, secret);
  for (const key of Object.keys(dims)) dims[key].state = "exact";
  return {
    win: won,
    answerName: secret.name,
    pickName,
    dims,
    operator: publicProfile(secret),
    archive: personnelArchive(secret),
  };
}

function allSkillRewardFields(plan) {
  const rawFields = plan.kind === "skillBundle"
    ? plan.skillFields
    : MULTI_SKILL_CLUE_FIELDS[plan.kind];
  const fields = Array.from(new Set(
    (Array.isArray(rawFields) ? rawFields : []).filter((field) => ["icon", "name", "mechanic"].includes(field))
  ));
  return fields.length === 2 ? fields : null;
}

function clueContent(session) {
  const secret = data[session.name];
  const source = clueData[secret.id] || {};
  const plan = session.cluePlan;
  if (!plan) return null;
  const skills = source.skills || [];
  const exposeAllSkills = plan.allSkills === true || session.version === SUDDEN_THEME_VERSION;
  if (plan.kind === "silhouette") {
    return {
      id: plan.id,
      kind: plan.kind,
      title: "干员剪影",
      imageUrl: source.silhouetteUrl,
      imageAlt: "已解码的未知干员剪影",
    };
  }
  if (plan.kind === "artFragment") {
    return {
      id: plan.id,
      kind: plan.kind,
      title: "剪影局部显影",
      imageUrl: (source.fragmentUrls || [])[plan.itemIndex],
      imageAlt: "完整未知干员剪影中一小块区域恢复了颜色",
    };
  }
  if (plan.kind === "quote") {
    const quote = (source.quotes || [])[plan.itemIndex];
    return quote ? { id: plan.id, kind: plan.kind, title: quote.title, text: quote.text } : null;
  }
  const skillFields = exposeAllSkills ? allSkillRewardFields(plan) : null;
  if (skillFields) {
    if (!skills.length) return null;
    const rewardSkills = skills.map((skill) => ({
      slot: skill.slot,
      ...(skillFields.includes("icon") ? {
        imageUrl: skill.iconUrl,
        imageAlt: "已解码的" + skill.slot + "技能图标",
      } : {}),
      ...(skillFields.includes("name") ? { name: skill.name } : {}),
      ...(skillFields.includes("mechanic") ? { mechanic: skill.mechanic } : {}),
    }));
    if (skillFields.includes("icon") && rewardSkills.some((skill) => !skill.imageUrl)) return null;
    const title = {
      "icon,name": "全技能图标与名称",
      "icon,mechanic": "全技能图标与机制",
      "name,mechanic": "全技能名称与机制",
    }[skillFields.join(",")] || "全技能联合档案";
    return {
      id: plan.id,
      kind: "skillBundle",
      title,
      allSkills: true,
      skillFields,
      skillCount: skills.length,
      skills: rewardSkills,
    };
  }
  const skill = skills[plan.itemIndex];
  if (!skill) return null;
  if (plan.kind === "skillIcon") {
    return {
      id: plan.id,
      kind: plan.kind,
      title: "技能图标",
      slot: skill.slot,
      imageUrl: skill.iconUrl,
      imageAlt: "已解码的未知技能图标",
    };
  }
  if (plan.kind === "skillName") {
    return { id: plan.id, kind: plan.kind, title: "技能名称", slot: skill.slot, text: skill.name };
  }
  return {
    id: plan.id,
    kind: "skillMechanic",
    title: "技能机制档案",
    mechanic: skill.mechanic,
  };
}

function revealClue(token, clueId) {
  const session = decrypt(token);
  if (!session) return { error: "invalid_session" };
  if (session.mode !== "sudden" || !isComparisonVersion(session.version)) return { error: "invalid_phase" };
  if (!session.cluePlan || session.cluePlan.id !== clueId) return { error: "invalid_clue" };
  if (session.clueStatus !== "pending" && session.clueStatus !== "revealed") {
    return { error: "invalid_phase" };
  }
  const clue = clueContent(session);
  if (!clue) return { error: "clue_unavailable" };
  const nextSession = { ...session, clueStatus: "revealed" };
  const out = {
    version: session.version,
    clue,
    token: encrypt(nextSession),
  };
  if (session.version === SUDDEN_THEME_VERSION) out.theme = directivePublicState(nextSession);
  else out.assist = assistPublicState(nextSession, []);
  return out;
}

function reveal(token) {
  const session = decrypt(token);
  if (!session) return { error: "invalid_session" };
  const secret = data[session.name];
  if (!secret) return { error: "invalid_session" };
  if (isComparisonVersion(session.version)) {
    return {
      version: session.version,
      answerName: secret.name,
      operator: operatorProfileWithThemeArt(secret, session.themeId),
      archive: personnelArchive(secret),
    };
  }
  const dims = legacyDimResult(secret, secret);
  for (const key of Object.keys(dims)) dims[key].state = "exact";
  return {
    answerName: secret.name,
    dims,
    operator: publicProfile(secret),
    archive: personnelArchive(secret),
  };
}

module.exports = {
  newGame,
  guess,
  reveal,
  revealClue,
  choices,
  pick,
  SUDDEN_MAX,
  SUDDEN_VERSION,
  SUDDEN_THEME_VERSION,
  count: ALL_NAMES.length,
};

if (process.env.NODE_ENV === "test") {
  module.exports._test = {
    data,
    encrypt,
    decrypt,
    buildRotationPlan,
    suddenComparison,
    remainingCandidateCount,
    dynamicAssistState,
    dynamicAssistScore,
    progressLevel,
    createCluePlan,
    finalizeCluePlan,
    targetClueStrength,
    clueProfiles: CLUE_PROFILES,
    multiSkillClueStrength: MULTI_SKILL_CLUE_STRENGTH,
    themes: THEME_DEFINITIONS,
    selectDirective,
    coralOpeningChance,
    shouldOpenCoral,
    coralThemeBaseWeight,
    coralSecretNames: CORAL_SECRET_NAMES,
    directiveGoal,
    directiveMatches,
    directivePublicState,
    directiveClueStrength,
    directiveRewardBandFactor,
    directiveQuoteTierFactor,
    silhouetteRewardFactor,
    directiveFamilyWeight,
    directiveFirstCycleMarker: DIRECTIVE_FIRST_CYCLE_MARKER,
  };
}
