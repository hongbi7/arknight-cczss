const assert = require("assert");
const fs = require("fs");
const path = require("path");

process.env.NODE_ENV = "test";
const game = require("./game.js");
const clues = require("../server-data/operator-clues.json");
const identities = require("../server-data/operator-identities.json");
const familiarityAudit = require("../server-data/operator-familiarity.json");
const brandArt = require("../server-data/operator-brand-art.json");

const test = game._test;
const names = Object.keys(test.data);
const namesById = Object.fromEntries(Object.values(test.data).map((operator) => [operator.id, operator.name]));

function firstDifferent(name, excluded = []) {
  return names.find((candidate) => candidate !== name && !excluded.includes(candidate));
}

function v2Session(secretName, overrides = {}) {
  const secret = test.data[secretName];
  return {
    version: 2,
    name: secretName,
    mode: "sudden",
    guesses: [],
    maxAttempts: 6,
    rotationPlan: ["birthday", "height", "exp", "infected", "height", "birthday"],
    confirmedKeys: [],
    candidateCount: names.length,
    stallCount: 0,
    assistMomentum: 0,
    assistScore: 0,
    clueStatus: "locked",
    cluePlan: test.createCluePlan(secret),
    ...overrides,
  };
}

function v3Session(secretName, themeId, goal = 3, overrides = {}) {
  const secret = test.data[secretName];
  const theme = test.themes[themeId];
  return {
    version: 3,
    name: secretName,
    mode: "sudden",
    guesses: [],
    maxAttempts: 6,
    rotationPlan: ["birthday", "height", "exp", "infected", "height", "birthday"],
    confirmedKeys: [],
    candidateCount: names.length,
    themeId,
    themeGoal: goal,
    themeHits: [],
    clueStatus: "locked",
    cluePlan: test.finalizeCluePlan(secret, test.createCluePlan(secret), {
      targetStrength: test.directiveClueStrength(secret, theme),
      themeId,
      allSkills: true,
    }),
    ...overrides,
  };
}

function assertNoKey(value, blockedKey) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.notStrictEqual(key, blockedKey, `response leaked key ${blockedKey}`);
    assertNoKey(child, blockedKey);
  }
}

function assertNoStringValue(value, blockedValue) {
  if (typeof value === "string") {
    assert.notStrictEqual(value, blockedValue, `response leaked value ${blockedValue}`);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const child of Object.values(value)) assertNoStringValue(child, blockedValue);
}

function publicPath(url) {
  return path.join(__dirname, "..", "public", url.replace(/^\//, ""));
}

for (let sample = 0; sample < 100; sample++) {
  const rotation = test.buildRotationPlan(20);
  assert.strictEqual(new Set(rotation.slice(0, 4)).size, 4);
  for (let index = 1; index < rotation.length; index++) {
    if (index % 4 === 0) assert.notStrictEqual(rotation[index], rotation[index - 1]);
  }
}

const legacyGame = game.newGame("sudden", 6);
assert.strictEqual(legacyGame.version, undefined);
const newGame = game.newGame("sudden", 6, 2);
assert.strictEqual(newGame.version, 2);
assert.strictEqual(newGame.assist.status, "monitoring");
const newSession = test.decrypt(newGame.token);
assert.strictEqual(newSession.rotationPlan.length, 6);
assert(newSession.cluePlan.id);
assert(newSession.cluePlan.seed);
assert.strictEqual(newSession.cluePlan.kind, undefined);

const themeGame = game.newGame("sudden", 6, 3);
assert.strictEqual(themeGame.version, 3);
assert(themeGame.theme);
assert([1, 2, 3].includes(themeGame.theme.goal));
assert.strictEqual(themeGame.theme.progress, 0);
assert.strictEqual(themeGame.theme.status, "active");
assertNoKey(themeGame, "members");
const themeSession = test.decrypt(themeGame.token);
assert(test.directiveMatches(themeSession.themeId, test.data[themeSession.name]));
assert.strictEqual(themeSession.cluePlan.kind !== undefined, true, "V3 must lock its clue type at game start");
assert.strictEqual(themeSession.cluePlan.allSkills, true, "V3 clue plans must explicitly require all skills");
assertNoStringValue(themeGame, themeSession.name);
assertNoStringValue(themeGame, test.data[themeSession.name].id);

const endlessGame = game.newGame("endless", null, 3);
assert.strictEqual(endlessGame.version, 3);
const endlessSession = test.decrypt(endlessGame.token);
assert.strictEqual(endlessSession.mode, "endless");
assert.strictEqual(endlessSession.rotationPlan.length, 4);
const endlessGuessNames = names.filter((name) => name !== endlessSession.name).slice(0, 8);
let endlessToken = endlessGame.token;
const endlessRotations = [];
let endlessGuess = null;
for (const endlessGuessName of endlessGuessNames) {
  endlessGuess = game.guess(endlessToken, endlessGuessName);
  assert.strictEqual(endlessGuess.win, false);
  endlessRotations.push(endlessGuess.rotatingIntel.key);
  endlessToken = endlessGuess.token;
}
assert.strictEqual(endlessGuess.mode, "endless");
assert.strictEqual(endlessGuess.version, 3);
assert.strictEqual(endlessGuess.remaining, null);
assert.strictEqual(Object.keys(endlessGuess.dims).length, 11);
assert.strictEqual(new Set(endlessRotations.slice(0, 4)).size, 4);
assert.strictEqual(new Set(endlessRotations.slice(4, 8)).size, 4);
assert.notStrictEqual(endlessRotations[3], endlessRotations[4]);
assertNoKey(endlessGuess, "answer");
assertNoKey(endlessGuess, "answerText");
assertNoStringValue(endlessGuess, endlessSession.name);
assertNoStringValue(endlessGuess, test.data[endlessSession.name].id);
for (const version of [2, 3]) {
  const opened = game.newGame("endless", null, version);
  const session = test.decrypt(opened.token);
  const repeatedName = firstDifferent(session.name);
  let repeatedToken = opened.token;
  for (let index = 0; index < 5; index++) {
    const result = game.guess(repeatedToken, repeatedName);
    assert.strictEqual(result.error, undefined);
    assert.strictEqual(result.win, false);
    assert.strictEqual(result.guessName, repeatedName);
    assert.strictEqual(result.operator.name, repeatedName);
    assert.strictEqual(result.remaining, null);
    assert(Object.keys(result.dims).length >= 11, "repeat submissions must include full comparison data");
    assert.strictEqual(test.decrypt(result.token).guesses.length, index + 1);
    assert.strictEqual(new Set(test.decrypt(result.token).guesses).size, 1);
    assertNoStringValue(result, session.name);
    repeatedToken = result.token;
  }
}

const freePeekName = firstDifferent(themeSession.name);
const freePeek = game.guess(themeGame.token, freePeekName, { free: true });
assert.strictEqual(freePeek.error, undefined);
assert.strictEqual(freePeek.win, false);
assert.strictEqual(freePeek.free, true);
assert.strictEqual(freePeek.version, 3);
assert.strictEqual(freePeek.remaining, 6);
assert(Object.keys(freePeek.dims).length >= 11);
assert.strictEqual(freePeek.rotatingIntel.key, themeSession.rotationPlan[0]);
assertNoKey(freePeek, "answer");
assertNoKey(freePeek, "answerText");
assertNoStringValue(freePeek, themeSession.name);
assertNoStringValue(freePeek, test.data[themeSession.name].id);
assert.deepStrictEqual(test.decrypt(freePeek.token).guesses || [], [], "free peek must not record the guess");
const afterFreePeek = game.guess(freePeek.token, freePeekName);
assert.strictEqual(afterFreePeek.error, undefined, "a free peek never blocks the real guess");
assert.strictEqual(afterFreePeek.remaining, 5);
assert.strictEqual(game.guess(themeGame.token, themeSession.name, { free: true }).error, "invalid_phase", "the hidden answer cannot be loaded for free");
assert.strictEqual(game.guess(afterFreePeek.token, freePeekName, { free: true }).error, "duplicate_guess");
assert.strictEqual(game.guess(endlessGame.token, firstDifferent(endlessSession.name), { free: true }).error, "invalid_phase", "endless games reject free peeks");
assert.strictEqual(game.guess(newGame.token, firstDifferent(newSession.name), { free: true }).error, "invalid_phase", "non-V3 sudden games reject free peeks");

const secretName = newSession.name;
const guessName = firstDifferent(secretName);
const firstGuess = game.guess(newGame.token, guessName);
assert.strictEqual(firstGuess.version, 2);
assert.strictEqual(firstGuess.win, false);
assert.strictEqual(Object.keys(firstGuess.dims).length, 11);
assert.strictEqual(firstGuess.rotatingIntel.key, newSession.rotationPlan[0]);
assertNoKey(firstGuess, "answer");
assertNoKey(firstGuess, "answerText");
assertNoStringValue(firstGuess, secretName);
assertNoStringValue(firstGuess, test.data[secretName].id);
const firstRangeResult = firstGuess.dims.deploymentTemplate;
const firstGuessOperator = test.data[guessName];
assert.strictEqual(firstRangeResult.slots.length, firstGuessOperator.skillRanges.length);
for (let index = 0; index < firstRangeResult.slots.length; index++) {
  const slot = firstRangeResult.slots[index];
  assert.strictEqual(slot.slot, firstGuessOperator.skillRanges[index].slot);
  assert.deepStrictEqual(
    slot.cells.map((cell) => `${cell.x},${cell.y}`).sort(),
    firstGuessOperator.skillRanges[index].rangeCells.map((cell) => `${cell.x},${cell.y}`).sort(),
    "a range comparison may only return cells already owned by the guessed operator"
  );
  for (const cell of slot.cells) {
    assert(["origin", "overlap", "guessOnly"].includes(cell.state));
  }
}
assert.strictEqual(game.guess(firstGuess.token, guessName).error, "duplicate_guess");

const directWinSession = v2Session(secretName);
const directWin = game.guess(test.encrypt(directWinSession), secretName);
assert.strictEqual(directWin.win, true);
assert.strictEqual(directWin.answerName, secretName);
assert.deepStrictEqual(directWin.pendingClues, []);

const multiRangeName = names.find((name) => {
  const ranges = test.data[name].skillRanges || [];
  return ranges.length === 3 && new Set(ranges.map((entry) => entry.rangeId)).size === 3;
});
const multiRangeWin = game.guess(test.encrypt(v2Session(multiRangeName)), multiRangeName);
assert.strictEqual(multiRangeWin.dims.deploymentTemplate.state, "exact");
assert.strictEqual(multiRangeWin.dims.deploymentTemplate.slots.length, 3);
assert(multiRangeWin.dims.deploymentTemplate.slots.every((slot) => slot.state === "exact"));

function assistSequence(familiarityScore, progressValues, seed, candidateCounts) {
  let previousMomentum = 0;
  let stallCount = 0;
  return progressValues.map((recentProgress, index) => {
    stallCount = recentProgress === 0 ? stallCount + 1 : 0;
    const state = test.dynamicAssistState(
      { familiarityScore },
      {
        attempts: index + 1,
        maxAttempts: progressValues.length,
        stallCount,
        candidateCount: candidateCounts[index],
        confirmedCount: recentProgress > 0 ? Math.min(6, (index + 1) * 2) : 0,
        recentProgress,
        previousMomentum,
        seed,
      }
    );
    previousMomentum = state.momentum;
    return state;
  });
}

const stalledCandidates = [425, 380, 300, 250, 200, 170];
const coldSequence = assistSequence(20, [0, 0, 0, 0, 0, 0], "cold-sequence", stalledCandidates);
const hotSequence = assistSequence(95, [0, 0, 0, 0, 0, 0], "hot-sequence", stalledCandidates);
const easyHotSequence = assistSequence(95, [1, 1, 0.5, 1, 0.5, 1], "easy-sequence", [425, 180, 80, 30, 12, 3]);
assert(coldSequence[2].momentum > coldSequence[1].momentum);
assert(coldSequence[2].probability > hotSequence[2].probability);
assert(coldSequence[5].forced, "a fully stalled final guess must receive a safety-net clue");
assert(easyHotSequence.every((state) => !state.unlock && state.probability === 0));
assert.deepStrictEqual(
  coldSequence,
  assistSequence(20, [0, 0, 0, 0, 0, 0], "cold-sequence", stalledCandidates),
  "assist rolls must be deterministic for the same encrypted game seed"
);
let coldUnlocksByThree = 0;
let hotUnlocksByThree = 0;
for (let sample = 0; sample < 400; sample++) {
  const seed = `assist-rate-${sample}`;
  if (assistSequence(20, [0, 0, 0, 0, 0, 0], seed, stalledCandidates).slice(0, 3).some((state) => state.unlock)) {
    coldUnlocksByThree++;
  }
  if (assistSequence(95, [0, 0, 0, 0, 0, 0], seed, stalledCandidates).slice(0, 3).some((state) => state.unlock)) {
    hotUnlocksByThree++;
  }
}
assert(coldUnlocksByThree > 160);
assert(hotUnlocksByThree <= 5);
assert(coldUnlocksByThree > hotUnlocksByThree * 20);
assert.strictEqual(test.progressLevel([], 100, 90).stalled, true);
assert.strictEqual(test.progressLevel(["race"], 100, 90).value, 0.5);
assert.strictEqual(test.progressLevel([], 100, 40).value, 1);

const themeDefinitions = Object.values(test.themes);
assert.strictEqual(themeDefinitions.length, 53);
assert.strictEqual(identities.groups.length, 37);
assert.strictEqual(test.themes.identity_alter_family.memberCount, 75);
assert.strictEqual(test.themes.identity_alter_form.memberCount, 38);
const brandThemes = themeDefinitions.filter((theme) => theme.artBrand);
assert(brandThemes.length >= 5, "outfit-brand directives must be present");
for (const theme of brandThemes) {
  assert.strictEqual(theme.family, "visual");
  assert(brandArt.brands[theme.artBrand], `brand art map is missing ${theme.artBrand}`);
}
assert(test.themes.logistics_limited.memberCount >= 15);
assert(test.directiveMatches("logistics_limited", test.data["麒麟R夜刀"]));
assert(test.directiveMatches("identity_power_root_luo-de-dao", test.data["阿米娅"]));
for (const name of ["阿米娅", "煌", "迷迭香", "芬", "梓兰", "夜刀"]) {
  assert(test.directiveMatches("identity_power_luo-de-dao", test.data[name]),
    `Rhodes Island directive must accept subordinate teams: ${name}`);
}
assert(!test.directiveMatches("identity_power_luo-de-dao", test.data["能天使"]));
assert(themeDefinitions.some((theme) => theme.family === "logistics"));
for (const operator of Object.values(test.data)) {
  assert(
    themeDefinitions.some((theme) => test.directiveMatches(theme.id, operator)),
    `${operator.name} must be covered by at least one tactical directive`
  );
}
for (const theme of themeDefinitions) {
  assert(theme.memberCount >= 3);
  assert.strictEqual(theme.memberCount, theme.members.length);
  let previousStrength = Infinity;
  for (let familiarityScore = 0; familiarityScore <= 100; familiarityScore++) {
    const strength = test.directiveClueStrength({ familiarityScore }, theme);
    assert(
      strength <= previousStrength + Number.EPSILON,
      `${theme.id} must not give stronger target intel as the answer becomes more familiar`
    );
    previousStrength = strength;
  }
}

const rotationOperator = test.data["假日威龙陈"];
const rotationThemeIds = themeDefinitions
  .filter((theme) => test.directiveMatches(theme.id, rotationOperator))
  .map((theme) => theme.id);
// 最近几局都是技能族指令 → 新对局应优先把其他族轮换出来，技能族保留少量重复概率
const skillHistory = rotationThemeIds.filter((id) => test.themes[id].family === "skill").slice(1);
const familyCounts = {};
const familyRotationSamples = 10000;
for (let sample = 0; sample < familyRotationSamples; sample++) {
  const selectedTheme = test.selectDirective(rotationOperator, sample / familyRotationSamples, skillHistory);
  familyCounts[selectedTheme.family] = (familyCounts[selectedTheme.family] || 0) + 1;
}
assert((familyCounts.skill || 0) < 250, "a family played in recent games should be strongly suppressed");
assert((familyCounts.skill || 0) > 0, "directive rotation should retain a small repeat chance");
assert(
  ["identity", "battle", "logistics", "visual"].reduce((sum, family) => sum + (familyCounts[family] || 0), 0) > 9700,
  "other families should take over after a single-family streak"
);

// 五族各出现一次后，仍优先选择该干员尚未见过的具体主题；重复只保留很小概率。
const postCycleOperator = test.data["阿米娅"];
const postCycleHistory = [
  "skill_auto_trigger",
  "battle_stun",
  "logistics_base_room_kong-zhi-zhong-shu",
  "visual_brand_te-si-te-shou-cang",
  "identity_power_root_luo-de-dao",
];
assert.strictEqual(
  new Set(postCycleHistory.map((themeId) => test.themes[themeId].family)).size,
  5,
  "post-cycle history must cover all five directive families"
);
let postCycleThemeRepeats = 0;
let postCycleLatestFamilyRepeats = 0;
const postCycleLatestFamily = test.themes[postCycleHistory[0]].family;
for (let sample = 0; sample < 5000; sample++) {
  const selectedTheme = test.selectDirective(postCycleOperator, sample / 5000, postCycleHistory);
  if (postCycleHistory.includes(selectedTheme.id)) postCycleThemeRepeats++;
  if (selectedTheme.family === postCycleLatestFamily) postCycleLatestFamilyRepeats++;
}
assert(
  postCycleThemeRepeats < 180,
  "themes used during the first five-family cycle must stay rare while fresh themes remain"
);
assert(
  postCycleLatestFamilyRepeats < 250,
  "the latest family must stay rare when the next five-family cycle begins"
);
assert.strictEqual(test.directiveFamilyWeight("visual", false), 10);
assert.strictEqual(
  test.directiveFamilyWeight("visual", true),
  12,
  "形象档案 must receive a mild 1.2x family boost after the first five-family cycle"
);
assert.strictEqual(
  test.directiveFamilyWeight("identity", true),
  test.directiveFamilyWeight("identity", false),
  "the post-cycle boost must only affect 形象档案"
);

assert.strictEqual(test.directiveGoal({ familiarityScore: 30 }, { challengeDifficulty: 1 }), 3);
assert.strictEqual(test.directiveGoal({ familiarityScore: 29 }, { challengeDifficulty: 0 }), 2);
assert.strictEqual(test.directiveGoal({ familiarityScore: 28 }, { challengeDifficulty: 0.44 }), 2);
assert.strictEqual(test.directiveGoal({ familiarityScore: 28 }, { challengeDifficulty: 0.45 }), 1);
assert.strictEqual(test.directiveGoal({ familiarityScore: 80 }, { family: "visual", memberCount: 97, challengeDifficulty: 0.2 }), 2);
assert.strictEqual(test.directiveGoal({ familiarityScore: 20 }, { family: "visual", memberCount: 60, challengeDifficulty: 0.3 }), 2);
assert.strictEqual(test.directiveGoal({ familiarityScore: 80 }, { family: "visual", memberCount: 23, challengeDifficulty: 0.2 }), 1);
assert.strictEqual(test.directiveGoal({ familiarityScore: 20 }, { family: "visual", memberCount: 60, challengeDifficulty: 0.6 }), 1);
const coralTheme = themeDefinitions.find((theme) => theme.artBrand === "珊瑚海岸");
assert(coralTheme && coralTheme.directiveGoal === 3, "珊瑚海岸 must pin its directive goal to 3");
assert.strictEqual(test.directiveGoal({ familiarityScore: 80 }, coralTheme), 3);
assert.strictEqual(coralTheme.weightBoost, 3.5, "珊瑚海岸 must carry its global weight boost");
assert.strictEqual(
  test.coralSecretNames.length,
  coralTheme.memberCount,
  "every 珊瑚海岸 member must be available as an opening answer"
);
assert(
  test.coralSecretNames.every((name) => test.directiveMatches(coralTheme.id, test.data[name])),
  "a forced 珊瑚海岸 opening must only draw answers that match the theme"
);
assert.strictEqual(test.coralOpeningChance([]), 0.3);
assert.strictEqual(test.coralOpeningChance(["skill_auto_trigger"]), 0.7);
assert.strictEqual(test.coralOpeningChance(["skill_auto_trigger", "battle_stun"]), 0.9);
assert.strictEqual(
  test.coralOpeningChance(["skill_auto_trigger", "battle_stun", "logistics_limited"]),
  0.9,
  "a miss in the first three games must keep the catch-up chance instead of dropping back"
);
assert.strictEqual(
  test.coralOpeningChance([test.directiveFirstCycleMarker, "missing_theme"]),
  0.3,
  "markers and invalid entries must not advance the opening schedule"
);
assert.strictEqual(
  test.coralOpeningChance(["skill_auto_trigger", coralTheme.id]),
  0,
  "the forced opening schedule must stop once 珊瑚海岸 appears"
);
assert(test.shouldOpenCoral([], 0.2999));
assert(!test.shouldOpenCoral([], 0.3));
const coralOpeningWithinThreeChance = 1 - (1 - 0.3) * (1 - 0.7) * (1 - 0.9);
assert(
  coralOpeningWithinThreeChance > 0.97,
  "the answer-aware opening schedule must surface 珊瑚海岸 within three games over 97% of the time"
);
assert.strictEqual(
  test.coralThemeBaseWeight(coralTheme, 1, 1),
  1,
  "珊瑚海岸 must return to ordinary weight after appearing in the first game"
);
assert.strictEqual(
  test.coralThemeBaseWeight(coralTheme, 1, 2),
  1,
  "珊瑚海岸 must keep ordinary weight for the rest of the first three games"
);
assert.strictEqual(
  test.coralThemeBaseWeight(coralTheme, 1, 3),
  coralTheme.weightBoost,
  "珊瑚海岸 global weight must resume after the opening three games"
);
assert.strictEqual(
  test.coralThemeBaseWeight(coralTheme, 3, 4),
  1,
  "珊瑚海岸 must still lose its global boost after three appearances"
);
let forcedCoralOpening;
const originalRandom = Math.random;
try {
  Math.random = () => 0;
  forcedCoralOpening = game.newGame("sudden", 6, 3, []);
} finally {
  Math.random = originalRandom;
}
const forcedCoralSession = test.decrypt(forcedCoralOpening.token);
assert.strictEqual(forcedCoralSession.themeId, coralTheme.id);
assert(
  test.coralSecretNames.includes(forcedCoralSession.name),
  "newGame must select the theme and a matching answer together for a forced opening"
);
const globalThemeOperators = Object.values(test.data);
function coralSelections(weightBoost) {
  coralTheme.weightBoost = weightBoost;
  let selected = 0;
  const samplesPerOperator = 32;
  for (const operator of globalThemeOperators) {
    for (let sample = 0; sample < samplesPerOperator; sample++) {
      const randomValue = (sample + 0.5) / samplesPerOperator;
      const theme = test.selectDirective(operator, randomValue, []);
      if (theme.id === coralTheme.id) selected++;
    }
  }
  return selected;
}
const defaultCoralSelections = coralSelections(1);
const boostedCoralSelections = coralSelections(3.5);
coralTheme.weightBoost = 3.5;
assert(
  boostedCoralSelections > defaultCoralSelections * 2,
  "珊瑚海岸 global boost must materially raise its selection rate across the full operator pool"
);

const firstVisualOperator = test.data["银灰"];
let firstVisualSelections = 0;
for (let sample = 0; sample < 10000; sample++) {
  const theme = test.selectDirective(firstVisualOperator, sample / 10000, []);
  if (theme.family !== "visual") continue;
  firstVisualSelections++;
  assert.strictEqual(theme.id, coralTheme.id, "the first visual directive must be 珊瑚海岸");
}
assert(firstVisualSelections > 2500, "珊瑚海岸 should be modestly front-loaded during the first family cycle");

let coralWithinThree = 0;
const coralOpeningTurns = [0, 0, 0];
for (let sample = 0; sample < 10000; sample++) {
  const openingHistory = [];
  for (let turn = 0; turn < 3; turn++) {
    const randomValue = ((sample * 3 + turn) * 0.6180339887498949) % 1;
    const theme = test.selectDirective(firstVisualOperator, randomValue, openingHistory);
    if (theme.id === coralTheme.id) {
      coralWithinThree++;
      coralOpeningTurns[turn]++;
      break;
    }
    openingHistory.unshift(theme.id);
  }
}
assert(
  coralWithinThree > 9000,
  "珊瑚海岸-capable answers should receive 珊瑚海岸 within the first three themes most of the time"
);
assert(coralOpeningTurns.every((count) => count > 0), "each of the first three positions must retain a coral chance");

const noCoralOperator = test.data["阿米娅"];
for (let sample = 0; sample < 5000; sample++) {
  const theme = test.selectDirective(noCoralOperator, sample / 5000, []);
  assert.notStrictEqual(
    theme.family,
    "visual",
    "non-coral visual directives must wait until 珊瑚海岸 has opened the visual family"
  );
}

let laterNonCoralVisualSelections = 0;
for (let sample = 0; sample < 10000; sample++) {
  const theme = test.selectDirective(firstVisualOperator, sample / 10000, [coralTheme.id]);
  if (theme.family === "visual" && theme.id !== coralTheme.id) laterNonCoralVisualSelections++;
}
assert(laterNonCoralVisualSelections > 0, "other visual directives must return after 珊瑚海岸 appears");

function coralSelectionsWithHistory(history) {
  let selected = 0;
  for (let sample = 0; sample < 10000; sample++) {
    if (test.selectDirective(firstVisualOperator, sample / 10000, history).id === coralTheme.id) selected++;
  }
  return selected;
}
const consecutiveCoralSelections = coralSelectionsWithHistory([
  coralTheme.id,
  "skill_auto_trigger",
  "battle_stun",
]);
const spacedCoralSelections = coralSelectionsWithHistory([
  "skill_auto_trigger",
  "battle_stun",
  coralTheme.id,
]);
assert(consecutiveCoralSelections > 0, "珊瑚海岸 must retain a small immediate repeat chance");
assert(
  consecutiveCoralSelections < spacedCoralSelections * 0.4,
  "珊瑚海岸 must be strongly suppressed only when it appeared in the immediately previous game"
);

const postCycleBoostHistory = [coralTheme.id, "skill_auto_trigger", "battle_stun"];
let visualSelectionsBeforeCycleMarker = 0;
let visualSelectionsAfterCycleMarker = 0;
for (let sample = 0; sample < 20000; sample++) {
  const randomValue = sample / 20000;
  if (test.selectDirective(firstVisualOperator, randomValue, postCycleBoostHistory).family === "visual") {
    visualSelectionsBeforeCycleMarker++;
  }
  if (test.selectDirective(
    firstVisualOperator,
    randomValue,
    postCycleBoostHistory.concat(test.directiveFirstCycleMarker)
  ).family === "visual") {
    visualSelectionsAfterCycleMarker++;
  }
}
assert(
  visualSelectionsAfterCycleMarker > visualSelectionsBeforeCycleMarker * 1.1,
  "the completed first-cycle marker must materially increase 形象档案 selections"
);

// 珊瑚海岸计数只改变自身的阶段权重，不参与后续主题或五族轮换平衡。
const coralNeutralHistory = [coralTheme.id, "skill_auto_trigger", "battle_stun"];
const repeatedCoralHistory = [
  coralTheme.id,
  coralTheme.id,
  "skill_auto_trigger",
  "battle_stun",
];
for (let sample = 0; sample < 5000; sample++) {
  const randomValue = sample / 5000;
  assert.strictEqual(
    test.selectDirective(firstVisualOperator, randomValue, coralNeutralHistory).id,
    test.selectDirective(firstVisualOperator, randomValue, repeatedCoralHistory).id,
    "the first two 珊瑚海岸 entries must not alter theme or family rotation"
  );
}
const firstVisualRotationThemes = themeDefinitions
  .filter((theme) => theme.id !== coralTheme.id && test.directiveMatches(theme.id, firstVisualOperator))
  .map((theme) => theme.id);
const completeCoralHistory = [coralTheme.id].concat(firstVisualRotationThemes);
const completeTwoCoralHistory = [
  coralTheme.id,
  coralTheme.id,
  ...firstVisualRotationThemes,
];
assert(completeTwoCoralHistory.length <= 43, "complete coral rotation fixture must fit the history limit");
for (let sample = 0; sample < 5000; sample++) {
  const randomValue = sample / 5000;
  assert.strictEqual(
    test.selectDirective(firstVisualOperator, randomValue, completeCoralHistory).id,
    test.selectDirective(firstVisualOperator, randomValue, completeTwoCoralHistory).id,
    "珊瑚海岸 must stay rotation-neutral even after every other available theme has appeared"
  );
}

function coralHistorySelections(coralCount) {
  // 补入一个非珊瑚主题，使两次出现的样本处于第四局后的全局权重阶段。
  const history = Array(coralCount).fill(coralTheme.id).concat("skill_auto_trigger");
  let selected = 0;
  for (let sample = 0; sample < 10000; sample++) {
    if (test.selectDirective(firstVisualOperator, sample / 10000, history).id === coralTheme.id) selected++;
  }
  return selected;
}
const coralSelectionsBeforeReduction = coralHistorySelections(2);
const coralSelectionsAfterReduction = coralHistorySelections(3);
assert(
  coralSelectionsAfterReduction < coralSelectionsBeforeReduction * 0.5,
  "珊瑚海岸 must lose its 3.5x boost after its third appearance"
);
for (let sample = 0; sample < 5000; sample++) {
  const randomValue = sample / 5000;
  assert.strictEqual(
    test.selectDirective(firstVisualOperator, randomValue, Array(3).fill(coralTheme.id)).id,
    test.selectDirective(firstVisualOperator, randomValue, Array(4).fill(coralTheme.id)).id,
    "珊瑚海岸 appearance tracking must cap at the third occurrence"
  );
}

assert(test.directiveMatches("battle_concealment", test.data["守林人"]));
assert(!test.directiveMatches("battle_concealment", test.data["银灰"]));
assert(!test.directiveMatches("battle_concealment", test.data["极境"]));
assert(test.directiveMatches("battle_fast_redeploy", test.data["红"]));
assert(!test.directiveMatches("battle_fast_redeploy", test.data["银灰"]));
assert(test.directiveMatches("battle_forced_movement", test.data["阿消"]));
assert(test.directiveMatches("battle_elemental", test.data["蜜莓"]));

const progressTheme = test.themes.skill_attack_recovery;
const progressNames = progressTheme.members.map((operatorId) => namesById[operatorId]).filter(Boolean);
const progressSecret = progressNames[0];
const matchingGuesses = progressNames.slice(1, 4);
const nonMatchingGuess = names.find((name) =>
  name !== progressSecret
  && !matchingGuesses.includes(name)
  && !test.directiveMatches(progressTheme.id, test.data[name])
);
let progressToken = test.encrypt(v3Session(progressSecret, progressTheme.id));
const missResult = game.guess(progressToken, nonMatchingGuess);
assert.strictEqual(missResult.version, 3);
assert.strictEqual(missResult.themeResult.matched, false);
assert.strictEqual(missResult.themeResult.progress, 0);
assert.strictEqual(missResult.pendingClues.length, 0);
progressToken = missResult.token;
for (let index = 0; index < matchingGuesses.length; index++) {
  const hitResult = game.guess(progressToken, matchingGuesses[index]);
  assert.strictEqual(hitResult.themeResult.matched, true);
  assert.strictEqual(hitResult.themeResult.progress, index + 1);
  assert.strictEqual(hitResult.themeResult.newlyCompleted, index === 2);
  assert.strictEqual(hitResult.pendingClues.length, index === 2 ? 1 : 0);
  assert(
    hitResult.dims.deploymentTemplate.slots.every((slot) => slot.mechanic && slot.mechanic.activation),
    "skill range slots must include the guessed operator's mechanic labels"
  );
  assertNoKey(hitResult, "answer");
  assertNoStringValue(hitResult, progressSecret);
  progressToken = hitResult.token;
}
const completedSession = test.decrypt(progressToken);
assert.strictEqual(completedSession.clueStatus, "pending");
const v3ClueResult = game.revealClue(progressToken, completedSession.cluePlan.id);
assert.strictEqual(v3ClueResult.version, 3);
assert.strictEqual(v3ClueResult.theme.status, "revealed");
assert.strictEqual(v3ClueResult.assist, undefined);
const afterClueSession = test.decrypt(v3ClueResult.token);
const extraMatch = progressNames.find((name) =>
  name !== progressSecret
  && !matchingGuesses.includes(name)
  && name !== nonMatchingGuess
);
const afterClueGuess = game.guess(v3ClueResult.token, extraMatch);
assert.strictEqual(afterClueGuess.theme.progress, 3);
assert.strictEqual(afterClueGuess.pendingClues.length, 0);
assert.strictEqual(test.decrypt(afterClueGuess.token).clueStatus, "revealed");

const shortGoalSecret = progressNames[0];
const shortGoalSession = v3Session(shortGoalSecret, progressTheme.id, 1);
const shortGoalResult = game.guess(test.encrypt(shortGoalSession), progressNames[1]);
assert.strictEqual(shortGoalResult.themeResult.progress, 1);
assert.strictEqual(shortGoalResult.themeResult.completed, true);
assert.strictEqual(shortGoalResult.pendingClues.length, 1);

const amiya = test.data["阿米娅"];
const amiyaSkills = clues[amiya.id].skills;
assert.strictEqual(amiyaSkills.length, 3);
for (let sample = 0; sample < 200; sample++) {
  const plan = test.finalizeCluePlan(
    amiya,
    { id: `theme-dedup-${sample}`, seed: `theme-dedup-${sample}` },
    { targetStrength: 3.5, themeId: "skill_manual_auto", allSkills: true }
  );
  assert(
    plan.kind !== "skillBundle" || !plan.skillFields.includes("mechanic"),
    "skill mechanic directives must not repeat mechanic data in their paired reward"
  );
}

const directiveRewardFamilies = ["skill", "battle", "identity", "logistics", "visual"];
const directiveRewardBands = [
  { name: "cold", minimum: 0, maximum: 25 },
  { name: "cool", minimum: 26, maximum: 40 },
  { name: "middle", minimum: 41, maximum: 59 },
  { name: "warm", minimum: 60, maximum: 79 },
  { name: "hot", minimum: 80, maximum: 100 },
];
const silhouetteProfile = test.clueProfiles.find((profile) => profile.kind === "silhouette");
const quoteProfile = test.clueProfiles.find((profile) => profile.kind === "quote" && profile.quoteTier === "low");
const highQuoteProfile = test.clueProfiles.find((profile) => profile.kind === "quote" && profile.quoteTier === "high");
const smallFragmentProfile = test.clueProfiles.find((profile) =>
  profile.kind === "artFragment" && profile.itemIndex === 0
);
const largeFragmentProfile = test.clueProfiles.find((profile) =>
  profile.kind === "artFragment" && profile.itemIndex === 1
);
assert(silhouetteProfile.strength > smallFragmentProfile.strength);
assert(largeFragmentProfile.strength > silhouetteProfile.strength);
assert(silhouetteProfile.strength > quoteProfile.strength + 2.5);
assert(highQuoteProfile.strength > quoteProfile.strength + 1);
assert(silhouetteProfile.strength > highQuoteProfile.strength + 1.4);
assert(
  Object.values(test.multiSkillClueStrength).every((strength) => strength < silhouetteProfile.strength - 1.5),
  "every paired skill reward must rank materially below a full target silhouette"
);
assert.strictEqual(test.directiveRewardBandFactor(quoteProfile.strength, 20), 0.015);
assert.strictEqual(test.directiveRewardBandFactor(silhouetteProfile.strength, 20), 1);
assert.strictEqual(test.directiveRewardBandFactor(quoteProfile.strength, 90), 1);
assert.strictEqual(test.directiveRewardBandFactor(silhouetteProfile.strength, 90), 0.002);
assert.strictEqual(test.directiveRewardKindFactor("quote", true), 1.25);
assert.strictEqual(test.directiveRewardKindFactor("quote", false), 1);
assert.strictEqual(test.directiveRewardKindFactor("silhouette", true), 1);
assert.strictEqual(test.directiveQuoteTierFactor("high", 20), 0.3);
assert.strictEqual(test.directiveQuoteTierFactor("high", 50), 1);
assert.strictEqual(test.directiveQuoteTierFactor("high", 70), 0.15);
assert.strictEqual(test.directiveQuoteTierFactor("high", 90), 0.025);
assert.strictEqual(test.silhouetteRewardFactor({ rarity: 4, familiarityScore: 20 }, true), 2.4);
assert.strictEqual(test.silhouetteRewardFactor({ rarity: 4, familiarityScore: 50 }, true), 0.18);
assert.strictEqual(test.silhouetteRewardFactor({ rarity: 6, familiarityScore: 50 }, true), 0.025);
assert.strictEqual(test.silhouetteRewardFactor({ rarity: 4, familiarityScore: 90 }, true), 0.0002);
let directiveQuoteCount = 0;
let directiveRewardCount = 0;
const directiveRewardKinds = new Set();
for (const family of directiveRewardFamilies) {
  const familyThemes = themeDefinitions.filter((theme) => theme.family === family);
  const rewardStats = Object.fromEntries(directiveRewardBands.map((band) => [band.name, {
    count: 0,
    strength: 0,
    low: 0,
    high: 0,
    supportive: 0,
    top: 0,
    quotes: 0,
    lowQuotes: 0,
    highQuotes: 0,
    skills: 0,
    visual: 0,
    silhouettes: 0,
    kinds: new Set(),
  }]));
  for (const operator of Object.values(test.data)) {
    const band = directiveRewardBands.find(({ minimum, maximum }) =>
      operator.familiarityScore >= minimum && operator.familiarityScore <= maximum
    );
    assert(band, `${operator.id} familiarity must belong to an audited reward band`);
    for (const theme of familyThemes) {
      if (!theme.members.includes(operator.id)) continue;
      let pairStrength = 0;
      for (let sample = 0; sample < 12; sample++) {
        const plan = test.finalizeCluePlan(
          operator,
          {
            id: `directive-reward-${family}-${operator.id}-${theme.id}-${sample}`,
            seed: `directive-reward-${family}-${operator.id}-${theme.id}-${sample}`,
          },
          {
            targetStrength: test.directiveClueStrength(operator, theme),
            themeId: theme.id,
            allSkills: true,
          }
        );
        assert(plan, `${family}/${theme.id}/${operator.id} must have an unlockable intel reward`);
        const stats = rewardStats[band.name];
        stats.count++;
        stats.strength += plan.strength;
        pairStrength += plan.strength;
        stats.kinds.add(plan.kind);
        directiveRewardKinds.add(plan.kind);
        if (plan.strength <= 2.35) stats.low++;
        if (plan.strength >= 3.15) stats.high++;
        if (plan.strength >= highQuoteProfile.strength) stats.supportive++;
        if (plan.strength >= 4.15) stats.top++;
        if (plan.kind === "quote") {
          stats.quotes++;
          assert.strictEqual(
            clues[operator.id].quotes[plan.itemIndex].informationTier,
            plan.quoteTier,
            "the selected quote item must match the reward profile's information tier"
          );
          if (plan.quoteTier === "high") stats.highQuotes++;
          else stats.lowQuotes++;
          directiveQuoteCount++;
        }
        if (plan.kind === "skillBundle") stats.skills++;
        if (["silhouette", "artFragment"].includes(plan.kind)) stats.visual++;
        if (plan.kind === "silhouette") stats.silhouettes++;
        directiveRewardCount++;
      }
      const pairAverage = pairStrength / 12;
      if (band.name === "cold") {
        assert(pairAverage >= 3.4, `${theme.id}/${operator.id} cold reward average must stay strong`);
      } else if (band.name === "cool") {
        assert(pairAverage >= 2.75, `${theme.id}/${operator.id} cool reward average must not become weak`);
      } else if (band.name === "warm") {
        assert(pairAverage <= 2.4, `${theme.id}/${operator.id} warm reward average must stay low`);
      } else if (band.name === "hot") {
        assert(pairAverage <= 2, `${theme.id}/${operator.id} hot reward average must stay weak`);
      }
    }
  }
  const averages = directiveRewardBands.map((band) => {
    const stats = rewardStats[band.name];
    assert(stats.count > 0, `${family} must cover ${band.name} answers`);
    return stats.strength / stats.count;
  });
  for (let index = 1; index < averages.length; index++) {
    assert(
      averages[index - 1] > averages[index],
      `${family} reward strength must decrease through every familiarity band`
    );
  }
  assert(
    rewardStats.cold.low / rewardStats.cold.count < 0.004,
    `${family} cold answers must almost never receive quote or skill intel`
  );
  assert(
    rewardStats.cold.high / rewardStats.cold.count > 0.995,
    `${family} cold answers must overwhelmingly receive high visual intel`
  );
  assert(
    rewardStats.cold.top / rewardStats.cold.count > 0.75,
    `${family} cold answers must usually receive a silhouette or large color fragment`
  );
  assert(
    rewardStats.cold.silhouettes / rewardStats.cold.count > 0.65,
    `${family} cold answers must visibly favor full silhouettes`
  );
  assert(
    rewardStats.cool.low / rewardStats.cool.count < 0.02,
    `${family} cool answers must rarely receive low intel`
  );
  assert(
    rewardStats.cool.supportive / rewardStats.cool.count > 0.98,
    `${family} cool answers must strongly favor visual intel or high-information quotes`
  );
  assert(
    rewardStats.cool.high / rewardStats.cool.count > 0.9,
    `${family} cool answers must still primarily receive visual intel`
  );
  assert(
    rewardStats.cool.highQuotes / rewardStats.cool.count > 0.02
      && rewardStats.cool.highQuotes / rewardStats.cool.count < 0.12,
    `${family} cool answers must receive a bounded high-information quote pool`
  );
  assert(
    rewardStats.middle.low / rewardStats.middle.count > 0.12
      && rewardStats.middle.low / rewardStats.middle.count < 0.35,
    `${family} middle answers must retain low-information rewards`
  );
  assert(
    rewardStats.middle.supportive / rewardStats.middle.count > 0.65
      && rewardStats.middle.supportive / rewardStats.middle.count < 0.92,
    `${family} middle answers must retain high-information quotes and visual rewards`
  );
  assert(
    rewardStats.middle.highQuotes / rewardStats.middle.count > 0.25,
    `${family} middle answers must make meaningful use of high-information quotes`
  );
  assert(
    rewardStats.middle.silhouettes / rewardStats.middle.count < 0.02,
    `${family} middle answers must only rarely receive full silhouettes`
  );
  assert(
    rewardStats.warm.low / rewardStats.warm.count > 0.82,
    `${family} warm answers must strongly favor low-information quotes and paired skill intel`
  );
  assert(
    rewardStats.warm.high / rewardStats.warm.count < 0.06,
    `${family} warm answers must have a tightly bounded visual-intel tail`
  );
  assert(
    rewardStats.warm.highQuotes / rewardStats.warm.count < 0.15,
    `${family} warm answers must keep high-information quotes secondary`
  );
  assert(
    rewardStats.hot.low / rewardStats.hot.count > 0.99,
    `${family} hot answers must almost always receive quote or skill intel`
  );
  assert(
    rewardStats.hot.high / rewardStats.hot.count < 0.01,
    `${family} hot answers must almost never receive silhouettes or fragments`
  );
  assert(
    rewardStats.hot.highQuotes / rewardStats.hot.count < 0.01,
    `${family} hot answers must almost never receive high-information quotes`
  );
  assert.strictEqual(
    rewardStats.hot.silhouettes,
    0,
    `${family} hot answers must not receive full silhouettes in the audited sample`
  );
  assert(
    (rewardStats.hot.quotes + rewardStats.hot.skills) / rewardStats.hot.count > 0.99,
    `${family} hot rewards must resolve to the two low-information families`
  );
}
assert(
  directiveQuoteCount / directiveRewardCount > 0.2,
  "directive quote rewards must remain common while respecting cold-answer constraints"
);
assert.deepStrictEqual(
  Array.from(directiveRewardKinds).sort(),
  ["artFragment", "quote", "silhouette", "skillBundle"],
  "the familiarity audit must exercise every directive reward kind"
);

const artBrandTheme = brandThemes.find((theme) => Object.keys(brandArt.brands[theme.artBrand]).length > 0);
assert(artBrandTheme, "at least one outfit-brand directive must have mapped skin art");
const [artOperatorId, artOperatorRecord] = Object.entries(brandArt.brands[artBrandTheme.artBrand])[0];
const artOperatorName = namesById[artOperatorId];
const artSecretName = names.find((name) =>
  name !== artOperatorName && !test.directiveMatches(artBrandTheme.id, test.data[name])
);
const artHit = game.guess(test.encrypt(v3Session(artSecretName, artBrandTheme.id)), artOperatorName);
assert.strictEqual(artHit.themeResult.matched, true);
assert.strictEqual(artHit.operator.themeArtUrl, artOperatorRecord.imageUrl);
assert.strictEqual(artHit.operator.themeArtBrand, artBrandTheme.artBrand);
assert(artOperatorRecord.skinName && artHit.operator.themeArtSkinName === artOperatorRecord.skinName);
const artMissName = names.find((name) =>
  name !== artSecretName
  && name !== artOperatorName
  && !brandArt.brands[artBrandTheme.artBrand][test.data[name].id]
);
const artMiss = game.guess(artHit.token, artMissName);
assert.strictEqual(artMiss.themeResult.matched, false);
assert.strictEqual(artMiss.operator.themeArtUrl, undefined);
assert.strictEqual(artMiss.operator.themeArtBrand, undefined);

let legacySkillRewards = 0;
let directiveSkillBundles = 0;
const directiveSkillPairs = new Set();
for (let sample = 0; sample < 2000; sample++) {
  const candidatePlan = { id: `skill-weight-${sample}`, seed: `skill-weight-${sample}` };
  const legacyPlan = test.finalizeCluePlan(
    amiya,
    candidatePlan,
    { targetStrength: 3, themeId: "battle_fast_redeploy" }
  );
  const directivePlan = test.finalizeCluePlan(
    amiya,
    candidatePlan,
    { targetStrength: 3, themeId: "battle_fast_redeploy", allSkills: true }
  );
  if (["skillIcon", "skillMechanic", "skillName"].includes(legacyPlan.kind)) legacySkillRewards++;
  if (directivePlan.kind === "skillBundle") {
    directiveSkillBundles++;
    assert.strictEqual(directivePlan.skillFields.length, 2);
    directiveSkillPairs.add(directivePlan.skillFields.join("+"));
  }
}
assert(
  directiveSkillBundles < legacySkillRewards * 0.5,
  "paired V3 skill rewards should remain substantially less common"
);
assert.deepStrictEqual(
  Array.from(directiveSkillPairs).sort(),
  ["icon+mechanic", "icon+name", "name+mechanic"],
  "V3 must offer all three pairwise skill-intel combinations"
);

const allIconPlan = { id: "all-skill-icons", seed: "all-skill-icons", kind: "skillIcon", strength: 2 };
const allIconSession = v3Session("阿米娅", "skill_manual_auto", 3, {
  clueStatus: "pending",
  cluePlan: allIconPlan,
});
const allIconResult = game.revealClue(test.encrypt(allIconSession), allIconPlan.id);
assert.strictEqual(allIconResult.clue.kind, "skillBundle");
assert.strictEqual(allIconResult.clue.title, "全技能图标与名称");
assert.deepStrictEqual(allIconResult.clue.skillFields, ["icon", "name"]);
assert.strictEqual(allIconResult.clue.allSkills, true);
assert.strictEqual(allIconResult.clue.skillCount, 3);
assert.strictEqual(allIconResult.clue.skills.length, 3);
assert.deepStrictEqual(allIconResult.clue.skills.map((skill) => skill.slot), ["S1", "S2", "S3"]);
assert(allIconResult.clue.skills.every((skill) => skill.imageUrl));
assert.deepStrictEqual(allIconResult.clue.skills.map((skill) => skill.name), amiyaSkills.map((skill) => skill.name));

const allMechanicPlan = { id: "all-skill-mechanics", seed: "all-skill-mechanics", kind: "skillMechanic", strength: 3.5 };
const allMechanicSession = v3Session("阿米娅", "skill_distinct_ranges", 3, {
  clueStatus: "pending",
  cluePlan: allMechanicPlan,
});
const allMechanicResult = game.revealClue(test.encrypt(allMechanicSession), allMechanicPlan.id);
assert.strictEqual(allMechanicResult.clue.kind, "skillBundle");
assert.strictEqual(allMechanicResult.clue.title, "全技能图标与机制");
assert.deepStrictEqual(allMechanicResult.clue.skillFields, ["icon", "mechanic"]);
assert.strictEqual(allMechanicResult.clue.allSkills, true);
assert.strictEqual(allMechanicResult.clue.skillCount, 3);
assert.strictEqual(allMechanicResult.clue.skills.length, 3);
assert(allMechanicResult.clue.skills.every((skill) => skill.imageUrl));
assert.deepStrictEqual(allMechanicResult.clue.skills.map((skill) => skill.mechanic.activation), ["manual", "auto", "manual"]);

const allNamePlan = { id: "all-skill-names", seed: "all-skill-names", kind: "skillName", strength: 4.5 };
const allNameSession = v3Session("阿米娅", "battle_fast_redeploy", 3, {
  clueStatus: "pending",
  cluePlan: allNamePlan,
});
const allNameResult = game.revealClue(test.encrypt(allNameSession), allNamePlan.id);
assert.strictEqual(allNameResult.clue.kind, "skillBundle");
assert.strictEqual(allNameResult.clue.title, "全技能名称与机制");
assert.deepStrictEqual(allNameResult.clue.skillFields, ["name", "mechanic"]);
assert.deepStrictEqual(allNameResult.clue.skills.map((skill) => skill.name), amiyaSkills.map((skill) => skill.name));
assert.deepStrictEqual(allNameResult.clue.skills.map((skill) => skill.mechanic.activation), ["manual", "auto", "manual"]);

const twoSkillEntry = Object.entries(clues).find(([, source]) => (source.skills || []).length === 2);
const twoSkillName = namesById[twoSkillEntry[0]];
const twoSkillTheme = Object.values(test.themes).find((theme) => theme.members.includes(twoSkillEntry[0]));
const twoSkillPlan = { id: "two-skill-icons", seed: "two-skill-icons", kind: "skillIcon", strength: 2 };
const twoSkillSession = v3Session(twoSkillName, twoSkillTheme.id, 2, {
  clueStatus: "pending",
  cluePlan: twoSkillPlan,
});
const twoSkillResult = game.revealClue(test.encrypt(twoSkillSession), twoSkillPlan.id);
assert.deepStrictEqual(twoSkillResult.clue.skillFields, ["icon", "name"]);
assert.strictEqual(twoSkillResult.clue.skills.length, 2);
assert.strictEqual(twoSkillResult.clue.skillCount, 2);
assert.deepStrictEqual(twoSkillResult.clue.skills.map((skill) => skill.slot), ["S1", "S2"]);
assert(twoSkillResult.clue.skills.every((skill) => skill.imageUrl && skill.name));

const explicitAllIconPlan = { ...allIconPlan, id: "explicit-all-skill-icons", allSkills: true };
const explicitAllIconResult = game.revealClue(test.encrypt(v2Session("阿米娅", {
  clueStatus: "pending",
  cluePlan: explicitAllIconPlan,
})), explicitAllIconPlan.id);
assert.strictEqual(explicitAllIconResult.clue.skillCount, 3);
assert.deepStrictEqual(explicitAllIconResult.clue.skills.map((skill) => skill.slot), ["S1", "S2", "S3"]);

const explicitAllMechanicPlan = { ...allMechanicPlan, id: "explicit-all-skill-mechanics", allSkills: true };
const explicitAllMechanicResult = game.revealClue(test.encrypt(v2Session("阿米娅", {
  clueStatus: "pending",
  cluePlan: explicitAllMechanicPlan,
})), explicitAllMechanicPlan.id);
assert.strictEqual(explicitAllMechanicResult.clue.skillCount, 3);
assert.deepStrictEqual(explicitAllMechanicResult.clue.skills.map((skill) => skill.slot), ["S1", "S2", "S3"]);

const skillPairDefinitions = [
  ["icon", "name"],
  ["icon", "mechanic"],
  ["name", "mechanic"],
];
let auditedSkillBundles = 0;
for (const [operatorId, source] of Object.entries(clues)) {
  const sourceSkills = source.skills || [];
  if (!sourceSkills.length) continue;
  const operatorName = namesById[operatorId];
  const operatorTheme = themeDefinitions.find((theme) => theme.members.includes(operatorId));
  assert(operatorName && operatorTheme, `${operatorId} must have a playable skill-intel session`);
  for (const skillFields of skillPairDefinitions) {
    if (skillFields.includes("icon") && sourceSkills.some((skill) => !skill.iconUrl)) continue;
    const pairId = `all-skill-audit-${operatorId}-${skillFields.join("-")}`;
    const pairPlan = { id: pairId, kind: "skillBundle", skillFields, allSkills: true };
    const pairResult = game.revealClue(test.encrypt(v3Session(operatorName, operatorTheme.id, 3, {
      clueStatus: "pending",
      cluePlan: pairPlan,
    })), pairId);
    assert.strictEqual(pairResult.clue.kind, "skillBundle");
    assert.deepStrictEqual(pairResult.clue.skillFields, skillFields);
    assert.strictEqual(pairResult.clue.skillCount, sourceSkills.length);
    assert.strictEqual(pairResult.clue.skills.length, sourceSkills.length);
    pairResult.clue.skills.forEach((skill, index) => {
      const expected = sourceSkills[index];
      assert.strictEqual(skill.slot, expected.slot);
      assert.strictEqual(Object.hasOwn(skill, "imageUrl"), skillFields.includes("icon"));
      assert.strictEqual(Object.hasOwn(skill, "name"), skillFields.includes("name"));
      assert.strictEqual(Object.hasOwn(skill, "mechanic"), skillFields.includes("mechanic"));
      if (skillFields.includes("icon")) assert.strictEqual(skill.imageUrl, expected.iconUrl);
      if (skillFields.includes("name")) assert.strictEqual(skill.name, expected.name);
      if (skillFields.includes("mechanic")) assert.deepStrictEqual(skill.mechanic, expected.mechanic);
    });
    auditedSkillBundles++;
  }
}
assert(auditedSkillBundles > 1000, "all available operator skill pairs must be audited");

const clueReadyName = names.find((name) => {
  const source = clues[test.data[name].id];
  return source
    && source.fragmentUrls.length > 1
    && source.quotes.length > 0
    && source.skills.some((skill) => skill.iconUrl);
});
const clueReadyOperator = test.data[clueReadyName];
const hotContext = {
  attempts: 6,
  maxAttempts: 6,
  stallCount: 0,
  candidateCount: 10,
  confirmedCount: 6,
  recentProgress: 1,
  assistMomentum: 0,
};
const coldContext = {
  attempts: 5,
  maxAttempts: 6,
  stallCount: 3,
  candidateCount: 300,
  confirmedCount: 1,
  recentProgress: 0,
  assistMomentum: 80,
};
let hotStrength = 0;
let coldStrength = 0;
let hotSkillIcons = 0;
let coldSkillIcons = 0;
const hotKinds = new Set();
const coldKinds = new Set();
for (let sample = 0; sample < 400; sample++) {
  const plan = { id: `weighted-${sample}`, seed: `weighted-${sample}` };
  const hotPlan = test.finalizeCluePlan(
    { ...clueReadyOperator, familiarityScore: 95 },
    plan,
    hotContext
  );
  const coldPlan = test.finalizeCluePlan(
    { ...clueReadyOperator, familiarityScore: 20 },
    plan,
    coldContext
  );
  assert.deepStrictEqual(
    hotPlan,
    test.finalizeCluePlan({ ...clueReadyOperator, familiarityScore: 95 }, plan, hotContext),
    "the same encrypted clue seed must not reroll"
  );
  hotStrength += hotPlan.strength;
  coldStrength += coldPlan.strength;
  if (hotPlan.kind === "skillIcon") hotSkillIcons++;
  if (coldPlan.kind === "skillIcon") coldSkillIcons++;
  hotKinds.add(hotPlan.kind);
  coldKinds.add(coldPlan.kind);
}
assert(coldStrength / 400 > hotStrength / 400 + 0.8);
assert(hotSkillIcons > coldSkillIcons * 2);
assert(hotKinds.size >= 4 && coldKinds.size >= 4, "weighting should remain probabilistic");

const sixStarWithClues = Object.values(test.data).find((operator) => {
  const source = clues[operator.id] || {};
  return operator.rarity === 6
    && source.silhouetteUrl
    && source.quotes.length > 0
    && source.skills.every((skill) => skill.iconUrl);
});
let hotSixStarSilhouettes = 0;
let coldSixStarSilhouettes = 0;
for (let sample = 0; sample < 1200; sample++) {
  const plan = { id: `six-star-${sample}`, seed: `six-star-${sample}` };
  if (test.finalizeCluePlan(
    { ...sixStarWithClues, familiarityScore: 90 },
    plan,
    { ...coldContext, allSkills: true }
  ).kind === "silhouette") hotSixStarSilhouettes++;
  if (test.finalizeCluePlan(
    { ...sixStarWithClues, familiarityScore: 20 },
    plan,
    { ...coldContext, allSkills: true }
  ).kind === "silhouette") coldSixStarSilhouettes++;
}
assert(hotSixStarSilhouettes <= 3, "recognizable six-stars should almost never reveal a silhouette");
assert(coldSixStarSilhouettes >= 25, "exceptionally obscure six-stars should retain silhouette clues");
assert(coldSixStarSilhouettes > hotSixStarSilhouettes * 10);

const silhouettePlan = {
  id: "test-clue",
  kind: "silhouette",
  itemIndex: 0,
};
const pendingSession = v2Session(secretName, {
  clueStatus: "pending",
  cluePlan: silhouettePlan,
});
const clueResult = game.revealClue(test.encrypt(pendingSession), "test-clue");
assert.strictEqual(clueResult.clue.kind, "silhouette");
assert.strictEqual(clueResult.assist.status, "revealed");
assert(!clueResult.clue.imageUrl.includes(test.data[secretName].id));
assert(fs.existsSync(publicPath(clueResult.clue.imageUrl)));
assert.strictEqual(game.revealClue(test.encrypt(v2Session(secretName)), "wrong").error, "invalid_clue");

const sixGuesses = names.filter((name) => name !== secretName).slice(0, 6);
const exhaustedSession = v2Session(secretName, {
  guesses: sixGuesses,
  confirmedKeys: ["profession", "race"],
});
const choiceResult = game.choices(test.encrypt(exhaustedSession));
assert.strictEqual(choiceResult.options.length, 4);
assert(choiceResult.options.every((operator) => !Object.hasOwn(operator, "profession")));
assert(choiceResult.options.every((operator) => !Object.hasOwn(operator, "rarity")));
assert.strictEqual(game.pick(test.encrypt(v2Session(secretName)), secretName).error, "invalid_phase");
assert.strictEqual(game.pick(test.encrypt(exhaustedSession), secretName).win, true);

for (const prioritySecret of names.slice(0, 24)) {
  const secret = test.data[prioritySecret];
  const guesses = names.filter((name) => name !== prioritySecret).slice(0, 6);
  const session = v2Session(prioritySecret, { guesses });
  const result = game.choices(test.encrypt(session));
  const selected = new Set(result.options.map((option) => option.name));
  selected.delete(prioritySecret);
  const matchScore = (name) => {
    const operator = test.data[name];
    return (operator.rarity === secret.rarity ? 8 : 0)
      + (operator.gender === secret.gender ? 8 : 0)
      + (operator.profession === secret.profession ? 2 : 0)
      + (operator.race === secret.race ? 1 : 0);
  };
  const selectedScores = Array.from(selected, matchScore);
  const unselectedScores = names
    .filter((name) => name !== prioritySecret && !guesses.includes(name) && !selected.has(name))
    .map(matchScore);
  assert.strictEqual(selectedScores.length, 3);
  assert(
    Math.min(...selectedScores) >= Math.max(...unselectedScores),
    "final choices must prioritize rarity and gender equally, then profession, then race"
  );
}

const strictChoiceSecret = names.find((name) => {
  const secret = test.data[name];
  return names.filter((candidateName) => {
    const candidate = test.data[candidateName];
    return candidateName !== name
      && candidate.rarity === secret.rarity
      && candidate.gender === secret.gender
      && candidate.profession === secret.profession
      && candidate.race === secret.race;
  }).length >= 3;
});
assert(strictChoiceSecret, "test data must include a strict final-choice candidate group");
const strictChoiceOperator = test.data[strictChoiceSecret];
const protectedCandidates = new Set(names.filter((name) => {
  const operator = test.data[name];
  return name !== strictChoiceSecret
    && operator.rarity === strictChoiceOperator.rarity
    && operator.gender === strictChoiceOperator.gender
    && operator.profession === strictChoiceOperator.profession
    && operator.race === strictChoiceOperator.race;
}));
const strictChoiceSession = v2Session(strictChoiceSecret, {
  guesses: names.filter((name) => name !== strictChoiceSecret && !protectedCandidates.has(name)).slice(0, 6),
  confirmedKeys: ["race"],
});
const strictChoices = game.choices(test.encrypt(strictChoiceSession));
assert.strictEqual(strictChoices.options.length, 4);
for (const option of strictChoices.options) {
  const operator = test.data[option.name];
  assert.strictEqual(operator.rarity, strictChoiceOperator.rarity);
  assert.strictEqual(operator.gender, strictChoiceOperator.gender);
  assert.strictEqual(operator.profession, strictChoiceOperator.profession);
  assert.strictEqual(operator.race, strictChoiceOperator.race);
  assert.deepStrictEqual(Object.keys(option).sort(), ["id", "name"]);
}

const v3Exhausted = v3Session(progressSecret, progressTheme.id, 3, {
  guesses: names.filter((name) => name !== progressSecret).slice(0, 6),
  confirmedKeys: ["profession", "race"],
});
const v3Choices = game.choices(test.encrypt(v3Exhausted));
assert.strictEqual(v3Choices.version, 3);
assert.strictEqual(v3Choices.options.length, 4);
for (const option of v3Choices.options) {
  const operator = test.data[option.name];
  assert.strictEqual(operator.rarity, test.data[progressSecret].rarity);
  assert.strictEqual(operator.gender, test.data[progressSecret].gender);
  assert(!Object.hasOwn(option, "profession"));
  assert(!Object.hasOwn(option, "rarity"));
}
assert.strictEqual(v3Choices.choicePresentation, "operatorArt");
assert(v3Choices.options.every((operator) => !operator.choiceImageUrl));

const silhouetteChoices = game.choices(test.encrypt({
  ...v3Exhausted,
  clueStatus: "revealed",
  cluePlan: { id: "choice-silhouette", kind: "silhouette", itemIndex: 0 },
}));
assert.strictEqual(silhouetteChoices.choicePresentation, "silhouette");
assert(silhouetteChoices.options.every((operator) => operator.name && operator.choiceImageUrl));
assert(silhouetteChoices.options.every((operator) => fs.existsSync(publicPath(operator.choiceImageUrl))));
assert.strictEqual(new Set(silhouetteChoices.options.map((operator) => operator.choiceImageUrl)).size, 1);
assert.strictEqual(silhouetteChoices.options[0].choiceImageUrl, clues[test.data[progressSecret].id].silhouetteUrl);

const fragmentChoices = game.choices(test.encrypt({
  ...v3Exhausted,
  clueStatus: "revealed",
  cluePlan: { id: "choice-fragment", kind: "artFragment", itemIndex: 0 },
}));
assert.strictEqual(fragmentChoices.choicePresentation, "silhouette");
assert(fragmentChoices.options.every((operator) => operator.choiceImageUrl));
assert.strictEqual(new Set(fragmentChoices.options.map((operator) => operator.choiceImageUrl)).size, 1);

const quoteChoices = game.choices(test.encrypt({
  ...v3Exhausted,
  clueStatus: "revealed",
  cluePlan: { id: "choice-quote", kind: "quote", itemIndex: 0 },
}));
assert.strictEqual(quoteChoices.choicePresentation, "operatorArt");
assert(quoteChoices.options.every((operator) => !operator.choiceImageUrl));
for (const quoteTier of ["low", "high"]) {
  const quoteIndex = clues[test.data[progressSecret].id].quotes.findIndex(
    (quote) => quote.informationTier === quoteTier
  );
  assert(quoteIndex >= 0, `${progressSecret} must expose a ${quoteTier}-information quote pool`);
  const clueId = `quote-tier-${quoteTier}`;
  const quoteResult = game.revealClue(test.encrypt(v3Session(progressSecret, progressTheme.id, 3, {
    clueStatus: "pending",
    cluePlan: { id: clueId, kind: "quote", quoteTier, itemIndex: quoteIndex },
  })), clueId);
  assert.strictEqual(quoteResult.clue.kind, "quote");
  assert.strictEqual(quoteResult.clue.text, clues[test.data[progressSecret].id].quotes[quoteIndex].text);
  assert(!Object.hasOwn(quoteResult.clue, "informationTier"), "quote tiers must remain server-side tuning data");
}
assert.strictEqual(game.pick(test.encrypt(v3Session(progressSecret, progressTheme.id)), progressSecret).error, "invalid_phase");
assert.strictEqual(game.pick(test.encrypt(v3Exhausted), progressSecret).win, true);
const wrongV3Choice = v3Choices.options.find((operator) => operator.name !== progressSecret).name;
const wrongV3Pick = game.pick(test.encrypt(v3Exhausted), wrongV3Choice);
assert.strictEqual(wrongV3Pick.win, false);
assert.strictEqual(wrongV3Pick.answerName, progressSecret);
assert.strictEqual(wrongV3Pick.pickRecord.guessName, wrongV3Choice);
assert.strictEqual(wrongV3Pick.pickRecord.operator.id, test.data[wrongV3Choice].id);
assert(wrongV3Pick.pickRecord.dims.profession);
assert(wrongV3Pick.pickRecord.rotatingIntel);
assert.notStrictEqual(
  wrongV3Pick.pickRecord.rotatingIntel.key,
  v3Exhausted.rotationPlan[v3Exhausted.rotationPlan.length - 1],
  "the wrong final choice must receive the next non-repeating rotating comparison"
);
assert(!Object.hasOwn(wrongV3Pick.pickRecord, "archive"));

let artOperators = 0;
let skillIcons = 0;
let quoteCount = 0;
let expandedQuoteOperators = 0;
let dualTierQuoteOperators = 0;
for (const operator of Object.values(test.data)) {
  assert(Number.isFinite(operator.familiarityScore));
  assert(["S", "A", "B", "C"].includes(operator.familiarityTier));
  assert(Object.hasOwn(familiarityAudit[operator.id], "usageScore"));
  assert(
    familiarityAudit[operator.id].usageScore === null
      || Number.isFinite(familiarityAudit[operator.id].usageScore),
    "new operators without published usage data must keep an explicit null instead of a fabricated score"
  );
  assert(Number.isFinite(familiarityAudit[operator.id].structuralScore));
  assert.strictEqual(familiarityAudit[operator.id].signalsVersion, "2026-08-26-yituliu-1");
  assert(operator.power && operator.power.id);
  assert(Array.isArray(operator.rangeCells));
  assert(Array.isArray(operator.skillRanges));
  if (operator.power.logoUrl) assert(fs.existsSync(publicPath(operator.power.logoUrl)));
  const clue = clues[operator.id];
  assert(clue);
  assert.strictEqual(operator.skillRanges.length, clue.skills.length);
  for (let index = 0; index < operator.skillRanges.length; index++) {
    const skillRange = operator.skillRanges[index];
    assert.strictEqual(skillRange.slot, clue.skills[index].slot);
    assert(skillRange.rangeId);
    assert(skillRange.rangeCells.length > 0);
  }
  assert(fs.existsSync(publicPath(clue.silhouetteUrl)));
  for (const url of clue.fragmentUrls) assert(fs.existsSync(publicPath(url)));
  artOperators++;
  for (const skill of clue.skills) {
    if (!skill.iconUrl) continue;
    assert(fs.existsSync(publicPath(skill.iconUrl)));
    skillIcons++;
  }
  if (clue.quotes.length >= 16) expandedQuoteOperators++;
  const quoteTiers = new Set(clue.quotes.map((quote) => quote.informationTier));
  if (quoteTiers.has("low") && quoteTiers.has("high")) dualTierQuoteOperators++;
  for (const quote of clue.quotes) {
    if (operator.name.length > 1) assert(!quote.text.includes(operator.name));
    assert(!quote.title.includes("干员报到"));
    assert(["low", "high"].includes(quote.informationTier));
    assert(Number.isFinite(quote.informationScore));
    quoteCount++;
  }
}

assert.strictEqual(familiarityAudit[test.data["阿米娅"].id].communityScore, 98);
assert(familiarityAudit[test.data["史尔特尔"].id].score > familiarityAudit[test.data["佩德洛"].id].score + 50);

assert.strictEqual(artOperators, game.count);
assert(skillIcons > 800);
assert(
  expandedQuoteOperators / artOperators >= 0.99,
  "nearly every operator must receive the expanded 16-entry quote library"
);
assert.strictEqual(dualTierQuoteOperators, artOperators, "every operator must have both quote information tiers");
assert(quoteCount > 6700, "the quote library must remain materially larger than the previous eight-entry cap");
console.log(JSON.stringify({ tests: "passed", operators: artOperators, skillIcons, quoteCount }));
