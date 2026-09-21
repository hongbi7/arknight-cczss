const assert = require("assert");
const fs = require("fs");
const path = require("path");

process.env.NODE_ENV = "test";
const anomaly = require("./anomaly.js");
const ruleData = require("../server-data/anomaly-rules.json");
const questionData = require("../server-data/anomaly-questions.json");
const operatorData = require("../server-data/operators.json");

const DOMAINS = ["roster", "identity", "skill", "battle", "logistics", "visual"];
const DIFFICULTIES = ["trainee", "standard", "hazard"];
const operatorsById = new Map(
  Object.values(operatorData).map((operator) => [operator.id, operator])
);

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function collectKeys(value, keys = new Set()) {
  if (!value || typeof value !== "object") return keys;
  for (const [key, child] of Object.entries(value)) {
    keys.add(key);
    collectKeys(child, keys);
  }
  return keys;
}

function currentQuestion(token) {
  const session = anomaly._test.decrypt(token);
  return anomaly._test.questionsById[session.run[session.roundIndex].id];
}

function testGeneratedBank() {
  assert.deepStrictEqual(Object.keys(ruleData.domains).sort(), DOMAINS.slice().sort());
  assert.deepStrictEqual(Object.keys(ruleData.difficulties).sort(), DIFFICULTIES.slice().sort());
  assert.strictEqual(ruleData.sourceFingerprint, questionData.sourceFingerprint);
  assert(Object.keys(ruleData.definitions).length >= 100);

  const rules = Object.values(ruleData.definitions).map((rule) => ({
    id: rule.id,
    members: new Set(rule.members),
  }));
  const counts = new Map();
  for (const question of questionData.questions) {
    const key = `${question.domain}:${question.difficulty}`;
    counts.set(key, (counts.get(key) || 0) + 1);

    const optionIds = [...question.majorityIds, question.oddId];
    const rarityCounts = new Map();
    for (const operatorId of optionIds) {
      const rarity = operatorsById.get(operatorId).rarity;
      rarityCounts.set(rarity, (rarityCounts.get(rarity) || 0) + 1);
    }
    assert(
      !Array.from(rarityCounts.values()).includes(3),
      `${question.id} contains a protected rarity 3:1 shortcut`
    );

    for (const rule of rules) {
      const matching = optionIds.filter((operatorId) => rule.members.has(operatorId));
      if (matching.length !== 3) continue;
      const competingOdd = optionIds.find((operatorId) => !rule.members.has(operatorId));
      assert.strictEqual(
        competingOdd,
        question.oddId,
        `${question.id} conflicts with ${rule.id}`
      );
    }

    const targetRule = ruleData.definitions[question.ruleId];
    if (question.ruleId.startsWith("identity.race.")) {
      assert.notStrictEqual(targetRule.matchLabel, "未录入", "Missing archive values are not races");
    }
    assert(!question.ruleId.includes("module_branch"), question.ruleId);
    assert(!question.ruleId.includes("paid_outfit_count"), question.ruleId);
    if (question.ruleId.startsWith("roster.subprofession.")) {
      assert.strictEqual(
        new Set(optionIds.map((operatorId) => operatorsById.get(operatorId).profession)).size,
        1,
        `${question.id} mixes main professions in a subprofession question`
      );
    }
    if (String(targetRule.source || "").startsWith("skin.displaySkin.skinGroupName")) {
      assert.strictEqual(question.optionArt.length, 4, `${question.id} needs four skin artworks`);
      const artById = new Map(question.optionArt.map((entry) => [entry.operatorId, entry]));
      for (const operatorId of optionIds) {
        const art = artById.get(operatorId);
        assert(art && art.imageUrl.startsWith("/img/operators/skins/"));
        assert.strictEqual(
          art.brand === targetRule.matchLabel,
          question.majorityIds.includes(operatorId),
          `${question.id} uses the wrong outfit brand for ${operatorId}`
        );
        assert(fs.existsSync(path.join(__dirname, "..", "public", art.imageUrl)));
      }
    }
  }
  for (const domain of DOMAINS) {
    for (const difficulty of DIFFICULTIES) {
      assert(
        (counts.get(`${domain}:${difficulty}`) || 0) >= 60,
        `${domain}:${difficulty} must contain at least 60 questions`
      );
    }
  }

  const forbidden = new Set([
    "rarity", "tag", "tags", "cv", "voice", "charword",
    "birthday", "height", "combat_experience", "battle_experience",
  ]);
  for (const rule of Object.values(ruleData.definitions)) {
    const sourceHead = String(rule.source || "").toLowerCase().split(":", 1)[0];
    const parts = new Set(
      `${rule.id}.${sourceHead}`.toLowerCase().replaceAll("-", "_").split(".")
    );
    assert(!Array.from(forbidden).some((part) => parts.has(part)), rule.id);
    assert(!rule.id.includes("module_count"), rule.id);
    assert(!rule.id.includes("module_branch"), rule.id);
    assert(!rule.id.includes("paid_outfit_count"), rule.id);
  }
}

function testRunSelection() {
  const configs = ["mixed", ...DOMAINS];
  let seed = 1;
  for (const domain of configs) {
    const runSeed = seed++;
    let out = anomaly.newAudit(domain, seededRandom(runSeed), 1000);
    assert(!out.error, `${domain} failed to start`);
    assert.strictEqual(out.question.round, 1);
    assert.strictEqual(out.question.totalRounds, 10);

    const operatorCounts = new Map();
    const oddPositions = [];
    const domains = [];
    const difficulties = [];
    let previousOptions = new Set();
    for (let index = 0; index < 10; index++) {
      const session = anomaly._test.decrypt(out.token);
      assert.strictEqual(session.run.length, index + 1);
      const entry = session.run[index];
      const question = anomaly._test.questionsById[entry.id];
      domains.push(question.domain);
      difficulties.push(question.difficulty);
      oddPositions.push(entry.optionIds.indexOf(question.oddId));
      for (const id of entry.optionIds) {
        operatorCounts.set(id, (operatorCounts.get(id) || 0) + 1);
      }
      if (index) {
        assert(!entry.optionIds.some((id) => previousOptions.has(id)), "adjacent rounds repeat an operator");
      }
      previousOptions = new Set(entry.optionIds);
      out = anomaly.answer(out.token, question.oddId, session.startedAt + 1000);
      if (index < 9) out = anomaly.next(out.token, 3000 + index * 1000, seededRandom(runSeed * 100 + index));
    }
    const completedSession = anomaly._test.decrypt(out.token);
    assert.strictEqual(completedSession.run.length, 10);
    assert.strictEqual(new Set(completedSession.run.map((entry) => entry.id)).size, 10);
    assert(Math.max(...operatorCounts.values()) <= 2);
    assert.deepStrictEqual(difficulties, [
      "standard", "standard", "standard",
      "hazard", "hazard", "hazard", "hazard", "hazard", "hazard", "hazard",
    ]);
    const positionCounts = [0, 0, 0, 0];
    for (const position of oddPositions) positionCounts[position]++;
    assert(Math.max(...positionCounts) - Math.min(...positionCounts) <= 1);
    if (domain === "mixed") {
      const actual = Object.fromEntries(DOMAINS.map((id) => [id, domains.filter((x) => x === id).length]));
      assert.deepStrictEqual(actual, {
        roster: 1,
        identity: 2,
        skill: 2,
        battle: 2,
        logistics: 2,
        visual: 1,
      });
    } else {
      assert(domains.every((id) => id === domain));
    }
  }
}

function testSparseBucketRunStability() {
  for (let seed = 1; seed <= 50; seed++) {
    assert(
      anomaly._test.selectRun("visual", "trainee", seededRandom(seed)),
      `visual:trainee could not assemble a complete run for seed ${seed}`
    );
    assert(
      anomaly._test.selectRun("visual", anomaly.RUNTIME_QUESTION_POOL, seededRandom(seed)),
      `visual:all could not assemble a complete run for seed ${seed}`
    );
  }
}

function testPublicQuestionPrivacy() {
  const out = anomaly.newAudit("mixed", seededRandom(99), 1000);
  assert.strictEqual(out.question.id, undefined, "new audit leaked a stable question id");
  assert.strictEqual(out.question.questionId, undefined, "new audit leaked a question id");
  const keys = collectKeys({ ...out, token: "opaque" });
  for (const forbidden of [
    "ruleId", "oddId", "majorityIds", "evidence", "supportingRuleIds",
    "members", "memberCount", "match",
  ]) {
    assert(!keys.has(forbidden), `new audit leaked ${forbidden}`);
  }
  assert.strictEqual(out.question.options.length, 4);
  assert(out.question.options.every((option) => option.id && option.name && option.imageUrl));
}

function testActionsAndScoring() {
  const started = anomaly.newAudit("mixed", seededRandom(42), 10000);
  assert.deepStrictEqual(anomaly.answer(started.token, "not-an-option", 11000), { error: "invalid_pick" });
  assert.deepStrictEqual(anomaly.next(started.token, 11000), { error: "invalid_phase" });

  const scanned = anomaly.scan(started.token);
  assert.strictEqual(scanned.scannerAvailable, false);
  assert.strictEqual(scanned.scansRemaining, 1);
  assert(scanned.hint.title && scanned.hint.description);
  assert.deepStrictEqual(anomaly.scan(scanned.token), { error: "scan_unavailable" });
  const question = currentQuestion(scanned.token);
  const answered = anomaly.answer(scanned.token, question.oddId, 10000);
  assert.strictEqual(answered.result.correct, true);
  assert.strictEqual(answered.result.points.hintMultiplier, 0.6);
  assert.strictEqual(answered.result.points.total, 126);
  assert.strictEqual(answered.result.evidence.length, 4);
  assert.strictEqual(answered.result.evidence.filter((entry) => entry.match).length, 3);
  assert.deepStrictEqual(anomaly.answer(answered.token, question.oddId), { error: "invalid_phase" });

  const next = anomaly.next(answered.token, 20000);
  assert.strictEqual(next.question.round, 2);
  assert.strictEqual(next.question.scannerAvailable, true);
  assert.strictEqual(next.question.scansRemaining, 1);

  const scannedTwice = anomaly.scan(next.token);
  assert.strictEqual(scannedTwice.scansRemaining, 0);
  const secondQuestion = currentQuestion(scannedTwice.token);
  const secondAnswer = anomaly.answer(scannedTwice.token, secondQuestion.oddId, 20000);
  const thirdRound = anomaly.next(secondAnswer.token, 30000);
  assert.strictEqual(thirdRound.question.scannerAvailable, false);
  const thirdQuestion = currentQuestion(thirdRound.token);
  const thirdAnswer = anomaly.answer(thirdRound.token, thirdQuestion.oddId, 30000);
  assert.strictEqual(thirdAnswer.result.scannerReward, 1);
  assert.strictEqual(thirdAnswer.scansRemaining, 1);
  const fourthRound = anomaly.next(thirdAnswer.token, 40000);
  assert.strictEqual(fourthRound.question.scannerAvailable, true);
  assert.strictEqual(fourthRound.question.scansRemaining, 1);
  assert.strictEqual(anomaly.scan(fourthRound.token).scansRemaining, 0);

  const singleDomain = anomaly.newAudit("battle", seededRandom(43), 10000);
  assert.strictEqual(singleDomain.question.scannerAvailable, false);
  assert.strictEqual(singleDomain.question.scansRemaining, 0);
  assert.deepStrictEqual(anomaly.scan(singleDomain.token), { error: "scan_unavailable" });

  assert.deepStrictEqual(anomaly._test.scoreRound("standard", false, 1000, 3, false), {
    base: 150,
    timeBonus: 0,
    streakMultiplier: 1,
    hintMultiplier: 1,
    total: 0,
  });
  assert.deepStrictEqual(anomaly._test.scoreRound("standard", true, 0, 0, false), {
    base: 150,
    timeBonus: 60,
    streakMultiplier: 1,
    hintMultiplier: 1,
    total: 210,
  });
}

function testAdaptiveDifficultyGrowthAndRecovery() {
  let out = anomaly.newAudit("battle", seededRandom(909), 1000);
  assert.strictEqual(out.question.difficulty.id, "standard");

  for (let index = 0; index < 3; index++) {
    const session = anomaly._test.decrypt(out.token);
    const question = currentQuestion(out.token);
    out = anomaly.answer(out.token, question.oddId, session.startedAt + 1000);
    assert.strictEqual(out.result.difficulty.id, "standard");
    assert.strictEqual(out.result.difficultyChange, index === 2 ? 1 : 0);
    if (index < 2) out = anomaly.next(out.token, 3000 + index * 1000, seededRandom(920 + index));
  }
  out = anomaly.next(out.token, 6000, seededRandom(930));
  assert.strictEqual(out.question.difficulty.id, "hazard");

  for (let index = 0; index < 2; index++) {
    const session = anomaly._test.decrypt(out.token);
    const question = currentQuestion(out.token);
    out = anomaly.answer(out.token, question.majorityIds[0], session.startedAt + 1000);
    assert.strictEqual(out.result.difficulty.id, "hazard");
    assert.strictEqual(out.result.difficultyChange, index === 1 ? -1 : 0);
    if (index === 0) out = anomaly.next(out.token, 8000, seededRandom(940));
  }
  out = anomaly.next(out.token, 10000, seededRandom(950));
  assert.strictEqual(out.question.difficulty.id, "standard");
}

function testCompleteRun() {
  let out = anomaly.newAudit("mixed", seededRandom(2026), 1000);
  for (let round = 0; round < 10; round++) {
    const session = anomaly._test.decrypt(out.token);
    const question = currentQuestion(out.token);
    out = anomaly.answer(out.token, question.oddId, session.startedAt + 1000);
    assert.strictEqual(out.result.correct, true);
    assert.strictEqual(out.result.scannerReward, [2, 5, 8].includes(round) ? 1 : 0);
    if (round < 9) out = anomaly.next(out.token, 10000 + round * 1000);
  }
  assert.strictEqual(out.finished, true);
  assert.strictEqual(out.summary.rating, "S");
  assert.strictEqual(out.summary.correctCount, 10);
  assert.strictEqual(out.summary.accuracy, 100);
  assert.strictEqual(out.scansRemaining, 5);
  assert.strictEqual(Object.values(out.summary.domains).reduce((sum, item) => sum + item.answered, 0), 10);
  assert.deepStrictEqual(anomaly.next(out.token), { error: "invalid_phase" });
}

function testScannerRewardRequiresConsecutiveAnswers() {
  let out = anomaly.newAudit("mixed", seededRandom(303), 1000);
  const expectedCorrect = [true, true, false, true, true, true];
  for (let round = 0; round < expectedCorrect.length; round++) {
    const session = anomaly._test.decrypt(out.token);
    const question = currentQuestion(out.token);
    const pickId = expectedCorrect[round] ? question.oddId : question.majorityIds[0];
    out = anomaly.answer(out.token, pickId, session.startedAt + 1000);
    assert.strictEqual(out.result.scannerReward, round === 5 ? 1 : 0);
    if (round < expectedCorrect.length - 1) out = anomaly.next(out.token, 2000 + round * 1000);
  }
  assert.strictEqual(out.streak, 3);
  assert.strictEqual(out.scansRemaining, 3);
}

function testRatingAccountsForPlayedDifficulty() {
  const answers = [false, false, true, true, true, true, true, true, true, true];
  let out = anomaly.newAudit("roster", seededRandom(1200), 1000);
  for (let round = 0; round < answers.length; round++) {
    const session = anomaly._test.decrypt(out.token);
    const question = currentQuestion(out.token);
    const pickId = answers[round] ? question.oddId : question.majorityIds[0];
    out = anomaly.answer(out.token, pickId, session.startedAt + 1000);
    if (round < answers.length - 1) {
      out = anomaly.next(out.token, 3000 + round * 1000, seededRandom(1300 + round));
    }
  }
  assert.strictEqual(out.summary.correctCount, 8);
  assert.strictEqual(out.summary.challengeIndex, 60);
  assert.strictEqual(out.summary.ratingIndex, 71);
  assert.strictEqual(out.summary.rating, "B");
  assert.deepStrictEqual(
    Object.fromEntries(Object.entries(out.summary.difficulties).map(([id, value]) => [id, value.answered])),
    { trainee: 3, standard: 5, hazard: 2 }
  );
}

function testInvalidInputs() {
  assert.deepStrictEqual(anomaly.newAudit("secret"), { error: "invalid_domain" });
  assert.deepStrictEqual(anomaly.scan("invalid"), { error: "invalid_session" });
  assert.deepStrictEqual(anomaly.answer("invalid", "x"), { error: "invalid_session" });
  assert.deepStrictEqual(anomaly.next("invalid"), { error: "invalid_session" });
}

function testThemeCatalog() {
  const catalog = anomaly.auditThemes();
  assert.strictEqual(catalog.themes.length, 7);
  assert.strictEqual(catalog.themes[0].id, "mixed");
  assert.strictEqual(catalog.themes[0].tag, "高难");
  assert.strictEqual(catalog.themes[0].scannerLimit, 2);
  assert.strictEqual(catalog.themes[0].scannerRewardEvery, 3);
  assert(catalog.themes[0].groups.every((group) => group.description && group.countLabel));
  assert.match(
    catalog.themes[0].groups.find((group) => group.title === "作战编制").description,
    /职业|子职业/
  );
  assert.strictEqual(
    catalog.themes[0].itemCount,
    Object.keys(ruleData.definitions).length,
    "theme catalog must expose every playable rule as a subtopic"
  );
  for (const theme of catalog.themes.slice(1)) {
    assert(theme.items.length > 0, `${theme.id} has no visible subtopics`);
    assert(theme.groups.length > 0, `${theme.id} has no visible topic groups`);
    assert.strictEqual(theme.groupCount, theme.groups.length);
    assert.strictEqual(theme.scannerLimit, 0);
    assert(theme.items.every((item) => item.id === undefined), `${theme.id} leaked rule ids`);
    assert(theme.groups.every((group) => group.id === undefined), `${theme.id} leaked group ids`);
    assert(theme.groups.every((group) => group.description && group.countLabel), `${theme.id} has unexplained groups`);
    assert(!theme.items.some((item) => /模组数量/.test(item.title + item.description)));
  }
  assert.deepStrictEqual(
    catalog.themes.find((theme) => theme.id === "roster").groups.map((group) => group.title),
    ["职业", "子职业", "部署位置"]
  );
  assert.deepStrictEqual(
    catalog.themes.find((theme) => theme.id === "logistics").groups.map((group) => group.title),
    ["获取方式", "基建技能"]
  );
  assert.deepStrictEqual(
    catalog.themes.find((theme) => theme.id === "visual").groups.map((group) => group.title),
    ["画师", "服装品牌"]
  );
}

testGeneratedBank();
testRunSelection();
testSparseBucketRunStability();
testPublicQuestionPrivacy();
testActionsAndScoring();
testAdaptiveDifficultyGrowthAndRecovery();
testCompleteRun();
testScannerRewardRequiresConsecutiveAnswers();
testRatingAccountsForPlayedDifficulty();
testInvalidInputs();
testThemeCatalog();

console.log("anomaly tests passed");
