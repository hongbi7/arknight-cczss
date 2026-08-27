const crypto = require("crypto");
const data = require("../server-data/operators.json");
const archives = require("../server-data/operator-archives.json");
const clueData = require("../server-data/operator-clues.json");
const themeData = require("../server-data/operator-themes.json");

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
const CLUE_PROFILES = [
  { kind: "skillIcon", strength: 1, baseWeight: 24 },
  { kind: "silhouette", strength: 1.5, baseWeight: 20 },
  { kind: "artFragment", itemIndex: 0, strength: 2, baseWeight: 18 },
  { kind: "skillMechanic", strength: 2.5, baseWeight: 16 },
  { kind: "quote", strength: 3, baseWeight: 14 },
  { kind: "artFragment", itemIndex: 1, strength: 3.5, baseWeight: 12 },
  { kind: "skillName", strength: 4.5, baseWeight: 8 },
];
const MULTI_SKILL_CLUE_STRENGTH = { skillIcon: 2, skillMechanic: 3.5 };
const MULTI_SKILL_CLUE_WEIGHT = { skillIcon: 0.08, skillMechanic: 0.12 };
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
const THEME_DEFINITIONS = themeData.definitions || {};
const THEMES_BY_OPERATOR = themeData.byOperator || {};
const THEME_MEMBER_SETS = Object.fromEntries(
  Object.entries(THEME_DEFINITIONS).map(([themeId, definition]) => [
    themeId,
    new Set(definition.members || []),
  ])
);
const THEME_FAMILY_WEIGHTS = { skill: 45, battle: 35, identity: 20 };
const THEME_FAMILY_LABELS = {
  skill: "技能协议",
  battle: "战场响应",
  identity: "身份档案",
};

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

function selectDirective(operator, randomValue = Math.random(), recentThemeIds = []) {
  const themeIds = (THEMES_BY_OPERATOR[operator.id] || []).filter((themeId) => THEME_DEFINITIONS[themeId]);
  if (!themeIds.length) return null;
  const recent = Array.from(new Set(
    (Array.isArray(recentThemeIds) ? recentThemeIds : []).filter((themeId) => THEME_DEFINITIONS[themeId])
  ));
  const recentIndex = new Map(recent.map((themeId, index) => [themeId, index]));
  const hasUnseenTheme = themeIds.some((themeId) => !recentIndex.has(themeId));
  const familySizes = themeIds.reduce((counts, themeId) => {
    const family = THEME_DEFINITIONS[themeId].family;
    counts[family] = (counts[family] || 0) + 1;
    return counts;
  }, {});
  const familiarityScore = Number.isFinite(operator.familiarityScore) ? operator.familiarityScore : 50;
  const obscurity = 1 - clamp(familiarityScore, 0, 100) / 100;
  const desiredInformation = 0.25 + 0.55 * obscurity;
  return weightedChoice(themeIds.map((themeId) => {
    const theme = THEME_DEFINITIONS[themeId];
    const information = clamp(theme.informationStrength || 0);
    const challenge = clamp(theme.challengeDifficulty || 0);
    const distance = information - desiredInformation;
    const rangeOverlapPenalty = ["skill_range_change", "skill_distinct_ranges"].includes(theme.id) ? 0.6 : 1;
    const seenAt = recentIndex.get(theme.id);
    let rotationWeight = 1;
    if (seenAt !== undefined && hasUnseenTheme) {
      rotationWeight = 0.035 + Math.min(seenAt, 12) * 0.006;
    } else if (seenAt !== undefined && recent.length > 1) {
      rotationWeight = 0.12 + 0.88 * Math.pow(seenAt / (recent.length - 1), 1.35);
    }
    return {
      value: theme,
      weight: ((THEME_FAMILY_WEIGHTS[theme.family] || 1) / (familySizes[theme.family] || 1))
        * Math.exp(-4 * distance * distance)
        * (0.55 + 0.45 * (1 - challenge))
        * rangeOverlapPenalty
        * rotationWeight,
    };
  }), seededUnit(`${operator.id}:${randomValue}`, "directive"));
}

function directiveGoal(operator, theme) {
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
  const obscurityNeed = Math.pow(obscurity, 0.72);
  const need = clamp(0.78 * obscurityNeed + 0.24 * challenge - 0.28 * information + 0.08);
  let strength = 1 + 3.5 * need;
  if (familiarityScore <= 25) strength = Math.max(strength, 4.05);
  else if (familiarityScore <= 40) strength = Math.max(strength, 3.35);
  else if (familiarityScore >= 82) strength = Math.min(strength, 2.35);
  return strength;
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
  const target = Number.isFinite(context && context.targetStrength)
    ? context.targetStrength
    : targetClueStrength(operator, context || {});
  const familiarityScore = Number.isFinite(operator.familiarityScore) ? operator.familiarityScore : 50;
  const obscurity = 1 - clamp(familiarityScore, 0, 100) / 100;
  const allSkills = Boolean(context && context.allSkills);
  const themeId = context && context.themeId;
  const available = CLUE_PROFILES.filter((profile) => {
    if (profile.kind === "silhouette") return Boolean(source.silhouetteUrl);
    if (profile.kind === "artFragment") return Boolean(fragments[profile.itemIndex]);
    if (profile.kind === "quote") return quotes.length > 0;
    if (profile.kind === "skillIcon") {
      return allSkills ? skills.length > 0 && iconSkillIndexes.length === skills.length : iconSkillIndexes.length > 0;
    }
    if (profile.kind === "skillMechanic" && DIRECTIVE_MECHANIC_THEME_IDS.has(themeId)) return false;
    return skills.length > 0;
  }).map((profile) => {
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
    let silhouetteFactor = 1;
    if (profile.kind === "silhouette" && operator.rarity === 6) {
      if (familiarityScore <= 30) silhouetteFactor = 1;
      else if (familiarityScore <= 40) silhouetteFactor = 0.35;
      else if (familiarityScore <= 55) silhouetteFactor = 0.04;
      else silhouetteFactor = 0.001;
    }
    return {
      value: { ...profile, strength },
      weight: profile.baseWeight
        * weightFactor
        * silhouetteFactor
        * Math.max(0.12, directionFactor)
        * (0.07 + Math.exp(-1.05 * distance * distance)),
    };
  });
  if (!available.length) return null;

  const selected = weightedChoice(available, seededUnit(plan.seed, "kind"));
  let itemIndex = selected.itemIndex || 0;
  if (selected.kind === "quote") {
    itemIndex = Math.floor(seededUnit(plan.seed, "quote") * quotes.length);
  }
  if (selected.kind === "skillIcon" && !allSkills) {
    const iconIndex = Math.floor(seededUnit(plan.seed, "skill-icon") * iconSkillIndexes.length);
    itemIndex = iconSkillIndexes[iconIndex];
  }
  if ((selected.kind === "skillMechanic" && !allSkills) || selected.kind === "skillName") {
    itemIndex = Math.floor(seededUnit(plan.seed, selected.kind) * skills.length);
  }
  return {
    ...plan,
    kind: selected.kind,
    itemIndex,
    strength: selected.strength,
    allSkills,
  };
}

function newGame(mode, requestedMax, requestedVersion, recentThemeIds) {
  const pool = poolFor(mode);
  const secretName = pool[Math.floor(Math.random() * pool.length)];
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
  if (mode === "sudden" && Number(requestedVersion) === SUDDEN_THEME_VERSION) {
    const secret = data[secretName];
    const theme = selectDirective(secret, Math.random(), recentThemeIds);
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
    operator: publicProfile(guess),
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
    out.operator = publicProfile(secret);
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

function legacyMatches(operator, secret, key) {
  if (key === "subProfession") return operator.subProfessionId === secret.subProfessionId;
  if (key === "exp") return operator.exp === secret.exp && operator.exp !== null;
  if (key === "height") return operator.height === secret.height && operator.height !== null;
  if (key === "birthday") {
    return !!(operator.birthday && secret.birthday)
      && operator.birthday.month === secret.birthday.month
      && operator.birthday.day === secret.birthday.day;
  }
  return operator[key] === secret[key];
}

function legacyGreenKeys(secret, guessNames) {
  const green = [];
  for (const guessName of guessNames) {
    const guess = data[guessName];
    if (!guess) continue;
    const result = legacyDimResult(secret, guess);
    for (const key of LEGACY_DIM_KEYS) {
      if (result[key].state === "exact" && !green.includes(key)) green.push(key);
    }
  }
  return green;
}

function v2Matches(operator, secret, key) {
  if (key === "subProfession") return operator.subProfessionId === secret.subProfessionId;
  if (key === "tags") return equalSets(operator.tags, secret.tags);
  if (key === "power") return (operator.power || {}).id === (secret.power || {}).id;
  if (key === "deploymentTemplate") {
    const operatorRanges = operator.skillRanges || [];
    const secretRanges = secret.skillRanges || [];
    return operatorRanges.length === secretRanges.length
      && operatorRanges.every((entry, index) =>
        entry.slot === secretRanges[index].slot
        && equalSets(
          (entry.rangeCells || []).map(cellKey),
          (secretRanges[index].rangeCells || []).map(cellKey)
        )
      );
  }
  if (key === "deploymentCost") return operator.deploymentCost === secret.deploymentCost;
  return legacyMatches(operator, secret, key);
}

function choiceMatches(operator, secret, key, version) {
  return isComparisonVersion(version) ? v2Matches(operator, secret, key) : legacyMatches(operator, secret, key);
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
  const green = isComparisonVersion(session.version)
    ? session.confirmedKeys || []
    : legacyGreenKeys(secret, session.guesses || []);
  const lockedKeys = green.filter((key) => !["profession", "gender"].includes(key));
  const matchesDirective = (name) =>
    session.version !== SUDDEN_THEME_VERSION || directiveMatches(session.themeId, data[name]);
  const coreMatches = (operator) =>
    operator.profession === secret.profession && operator.gender === secret.gender;
  const lockedScore = (operator) => lockedKeys.reduce((score, key) =>
    score + (choiceMatches(operator, secret, key, session.version) ? (key === "race" ? 3 : 1) : 0), 0
  );
  const allLockedMatch = (operator) =>
    lockedKeys.every((key) => choiceMatches(operator, secret, key, session.version));
  const ranked = shuffle(pool).map((name) => {
    const operator = data[name];
    return {
      name,
      directive: matchesDirective(name),
      core: coreMatches(operator),
      allLocked: allLockedMatch(operator),
      lockedScore: lockedScore(operator),
    };
  });
  const tiers = [
    (candidate) => candidate.directive && candidate.core && candidate.allLocked,
    (candidate) => candidate.core && candidate.allLocked,
    (candidate) => candidate.directive && candidate.core,
    (candidate) => candidate.core,
    (candidate) => candidate.directive && candidate.allLocked,
    (candidate) => candidate.directive,
    (candidate) => candidate.allLocked,
    () => true,
  ];
  const distractors = [];
  const used = new Set();
  for (const accepts of tiers) {
    const candidates = ranked.filter((candidate) => !used.has(candidate.name) && accepts(candidate));
    candidates.sort((first, second) => second.lockedScore - first.lockedScore);
    for (const candidate of candidates) {
      used.add(candidate.name);
      distractors.push(candidate.name);
      if (distractors.length === 3) break;
    }
    if (distractors.length === 3) break;
  }

  const optionNames = shuffle([session.name].concat(distractors.slice(0, 3)));
  const relaxedCount = optionNames.filter((name) => {
    const operator = data[name];
    return !coreMatches(operator) || !allLockedMatch(operator) || !matchesDirective(name);
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
  if (
    isComparisonVersion(session.version)
    && (session.mode !== "sudden" || (session.guesses || []).length < sessionSuddenMax(session))
  ) {
    return { error: "invalid_phase" };
  }
  const won = pickName === session.name;
  if (isComparisonVersion(session.version)) {
    return {
      version: session.version,
      win: won,
      answerName: secret.name,
      pickName,
      operator: publicProfile(secret),
      archive: personnelArchive(secret),
    };
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
  if (exposeAllSkills && plan.kind === "skillIcon") {
    const skillIcons = skills.map((skill) => ({
      slot: skill.slot,
      imageUrl: skill.iconUrl,
      imageAlt: "已解码的" + skill.slot + "技能图标",
    }));
    if (!skillIcons.length || skillIcons.some((skill) => !skill.imageUrl)) return null;
    return {
      id: plan.id,
      kind: plan.kind,
      title: "全技能图标",
      allSkills: true,
      skillCount: skillIcons.length,
      skills: skillIcons,
    };
  }
  if (exposeAllSkills && plan.kind === "skillMechanic") {
    if (!skills.length) return null;
    return {
      id: plan.id,
      kind: plan.kind,
      title: "全技能机制档案",
      allSkills: true,
      skillCount: skills.length,
      skills: skills.map((skill) => ({ slot: skill.slot, mechanic: skill.mechanic })),
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
      operator: publicProfile(secret),
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
    themes: THEME_DEFINITIONS,
    selectDirective,
    directiveGoal,
    directiveMatches,
    directivePublicState,
    directiveClueStrength,
  };
}
