const assert = require("assert");
const fs = require("fs");
const path = require("path");

process.env.NODE_ENV = "test";
const game = require("./game.js");
const clues = require("../server-data/operator-clues.json");

const test = game._test;
const names = Object.keys(test.data);

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
assert.strictEqual(game.pick(test.encrypt(v2Session(secretName)), secretName).error, "invalid_phase");
assert.strictEqual(game.pick(test.encrypt(exhaustedSession), secretName).win, true);

let artOperators = 0;
let skillIcons = 0;
for (const operator of Object.values(test.data)) {
  assert(Number.isFinite(operator.familiarityScore));
  assert(["S", "A", "B", "C"].includes(operator.familiarityTier));
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

assert.strictEqual(artOperators, 425);
assert(skillIcons > 800);
console.log(JSON.stringify({ tests: "passed", operators: artOperators, skillIcons }));
