const assert = require("assert");
const fs = require("fs");
const path = require("path");

process.env.NODE_ENV = "test";
const game = require("./game.js");
const clues = require("../server-data/operator-clues.json");
const identities = require("../server-data/operator-identities.json");
const familiarityAudit = require("../server-data/operator-familiarity.json");

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
assert.strictEqual(themeDefinitions.length, 17);
assert.strictEqual(identities.groups.length, 37);
assert.strictEqual(test.themes.identity_alter_family.memberCount, 75);
assert.strictEqual(test.themes.identity_alter_form.memberCount, 38);
for (const operator of Object.values(test.data)) {
  assert(
    themeDefinitions.some((theme) => test.directiveMatches(theme.id, operator)),
    `${operator.name} must be covered by at least one tactical directive`
  );
}
for (const theme of themeDefinitions) {
  assert(theme.memberCount >= 3);
  assert.strictEqual(theme.memberCount, theme.members.length);
}

const rotationOperator = test.data["假日威龙陈"];
const rotationThemeIds = themeDefinitions
  .filter((theme) => test.directiveMatches(theme.id, rotationOperator))
  .map((theme) => theme.id);
const rotationUnseenTheme = rotationThemeIds[0];
const rotationHistory = rotationThemeIds.slice(1);
let unseenThemeSelections = 0;
for (let sample = 0; sample < 1000; sample++) {
  const selectedTheme = test.selectDirective(rotationOperator, sample / 1000, rotationHistory);
  if (selectedTheme.id === rotationUnseenTheme) unseenThemeSelections++;
}
assert(unseenThemeSelections > 600, "an unseen compatible directive should be strongly preferred");
assert(unseenThemeSelections < 1000, "directive rotation should retain a small repeat chance");

assert.strictEqual(test.directiveGoal({ familiarityScore: 30 }, { challengeDifficulty: 1 }), 3);
assert.strictEqual(test.directiveGoal({ familiarityScore: 29 }, { challengeDifficulty: 0 }), 2);
assert.strictEqual(test.directiveGoal({ familiarityScore: 28 }, { challengeDifficulty: 0.44 }), 2);
assert.strictEqual(test.directiveGoal({ familiarityScore: 28 }, { challengeDifficulty: 0.45 }), 1);

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
  assert.notStrictEqual(plan.kind, "skillMechanic", "skill mechanic directive must not repeat as its reward");
}

let legacySkillIconRewards = 0;
let legacySkillMechanicRewards = 0;
let directiveSkillIconRewards = 0;
let directiveSkillMechanicRewards = 0;
for (let sample = 0; sample < 1000; sample++) {
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
  if (legacyPlan.kind === "skillIcon") legacySkillIconRewards++;
  if (legacyPlan.kind === "skillMechanic") legacySkillMechanicRewards++;
  if (directivePlan.kind === "skillIcon") directiveSkillIconRewards++;
  if (directivePlan.kind === "skillMechanic") directiveSkillMechanicRewards++;
}
assert(directiveSkillIconRewards < legacySkillIconRewards, "V3 should reduce skill icon reward frequency");
assert(directiveSkillMechanicRewards < legacySkillMechanicRewards, "V3 should reduce skill mechanic reward frequency");
assert(
  directiveSkillIconRewards + directiveSkillMechanicRewards
    < (legacySkillIconRewards + legacySkillMechanicRewards) * 0.5,
  "V3 skill rewards should be substantially less common"
);

const allIconPlan = { id: "all-skill-icons", seed: "all-skill-icons", kind: "skillIcon", strength: 2 };
const allIconSession = v3Session("阿米娅", "skill_manual_auto", 3, {
  clueStatus: "pending",
  cluePlan: allIconPlan,
});
const allIconResult = game.revealClue(test.encrypt(allIconSession), allIconPlan.id);
assert.strictEqual(allIconResult.clue.title, "全技能图标");
assert.strictEqual(allIconResult.clue.allSkills, true);
assert.strictEqual(allIconResult.clue.skillCount, 3);
assert.strictEqual(allIconResult.clue.skills.length, 3);
assert.deepStrictEqual(allIconResult.clue.skills.map((skill) => skill.slot), ["S1", "S2", "S3"]);
assert(allIconResult.clue.skills.every((skill) => skill.imageUrl));

const allMechanicPlan = { id: "all-skill-mechanics", seed: "all-skill-mechanics", kind: "skillMechanic", strength: 3.5 };
const allMechanicSession = v3Session("阿米娅", "skill_distinct_ranges", 3, {
  clueStatus: "pending",
  cluePlan: allMechanicPlan,
});
const allMechanicResult = game.revealClue(test.encrypt(allMechanicSession), allMechanicPlan.id);
assert.strictEqual(allMechanicResult.clue.title, "全技能机制档案");
assert.strictEqual(allMechanicResult.clue.allSkills, true);
assert.strictEqual(allMechanicResult.clue.skillCount, 3);
assert.strictEqual(allMechanicResult.clue.skills.length, 3);
assert.deepStrictEqual(allMechanicResult.clue.skills.map((skill) => skill.mechanic.activation), ["manual", "auto", "manual"]);

const twoSkillEntry = Object.entries(clues).find(([, source]) => (source.skills || []).length === 2);
const twoSkillName = namesById[twoSkillEntry[0]];
const twoSkillTheme = Object.values(test.themes).find((theme) => theme.members.includes(twoSkillEntry[0]));
const twoSkillPlan = { id: "two-skill-icons", seed: "two-skill-icons", kind: "skillIcon", strength: 2 };
const twoSkillSession = v3Session(twoSkillName, twoSkillTheme.id, 2, {
  clueStatus: "pending",
  cluePlan: twoSkillPlan,
});
const twoSkillResult = game.revealClue(test.encrypt(twoSkillSession), twoSkillPlan.id);
assert.strictEqual(twoSkillResult.clue.skills.length, 2);
assert.strictEqual(twoSkillResult.clue.skillCount, 2);
assert.deepStrictEqual(twoSkillResult.clue.skills.map((skill) => skill.slot), ["S1", "S2"]);

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

const strictChoiceSecret = names.find((name) => {
  const secret = test.data[name];
  return names.filter((candidateName) => {
    const candidate = test.data[candidateName];
    return candidateName !== name
      && candidate.profession === secret.profession
      && candidate.gender === secret.gender
      && candidate.race === secret.race;
  }).length >= 6;
});
const strictChoiceOperator = test.data[strictChoiceSecret];
const protectedCandidates = new Set(names.filter((name) => {
  const operator = test.data[name];
  return name !== strictChoiceSecret
    && operator.profession === strictChoiceOperator.profession
    && operator.gender === strictChoiceOperator.gender
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
  assert.strictEqual(operator.profession, strictChoiceOperator.profession);
  assert.strictEqual(operator.gender, strictChoiceOperator.gender);
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
  assert.strictEqual(operator.profession, test.data[progressSecret].profession);
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

const fragmentChoices = game.choices(test.encrypt({
  ...v3Exhausted,
  clueStatus: "revealed",
  cluePlan: { id: "choice-fragment", kind: "artFragment", itemIndex: 0 },
}));
assert.strictEqual(fragmentChoices.choicePresentation, "silhouette");
assert(fragmentChoices.options.every((operator) => operator.choiceImageUrl));

const quoteChoices = game.choices(test.encrypt({
  ...v3Exhausted,
  clueStatus: "revealed",
  cluePlan: { id: "choice-quote", kind: "quote", itemIndex: 0 },
}));
assert.strictEqual(quoteChoices.choicePresentation, "operatorArt");
assert(quoteChoices.options.every((operator) => !operator.choiceImageUrl));
assert.strictEqual(game.pick(test.encrypt(v3Session(progressSecret, progressTheme.id)), progressSecret).error, "invalid_phase");
assert.strictEqual(game.pick(test.encrypt(v3Exhausted), progressSecret).win, true);

let artOperators = 0;
let skillIcons = 0;
for (const operator of Object.values(test.data)) {
  assert(Number.isFinite(operator.familiarityScore));
  assert(["S", "A", "B", "C"].includes(operator.familiarityTier));
  assert(Number.isFinite(familiarityAudit[operator.id].usageScore));
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
  for (const quote of clue.quotes) {
    if (operator.name.length > 1) assert(!quote.text.includes(operator.name));
    assert(!quote.title.includes("干员报到"));
  }
}

assert.strictEqual(familiarityAudit[test.data["阿米娅"].id].communityScore, 98);
assert(familiarityAudit[test.data["史尔特尔"].id].score > familiarityAudit[test.data["佩德洛"].id].score + 50);

assert.strictEqual(artOperators, 425);
assert(skillIcons > 800);
console.log(JSON.stringify({ tests: "passed", operators: artOperators, skillIcons }));
