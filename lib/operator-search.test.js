const assert = require("assert");

const { createOperatorSearch } = require("../public/js/operator-search.js");
const names = require("../public/data/names.json");
const searchData = require("../public/data/operator-search.json");
const searchSource = require("../scripts/operator-search-aliases.json");
const operators = require("../server-data/operators.json");

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function resultNames(engine, query) {
  return engine.search(query).map((result) => result.op.n);
}

function assertFinds(engine, query, expectedNames) {
  const actual = resultNames(engine, query);
  for (const expected of expectedNames) {
    assert(actual.includes(expected), `${JSON.stringify(query)} should suggest ${expected}; got ${actual.join(", ")}`);
  }
}

const engine = createOperatorSearch(names, searchData, { random: seededRandom(42) });

assertFinds(engine, "小火龙", ["伊芙利特"]);
assertFinds(engine, "xiaohuo", ["伊芙利特"]);
assertFinds(engine, "阿尔", ["塑心"]);
assertFinds(engine, "aertu", ["塑心"]);
assertFinds(engine, "恩希欧", ["银灰"]);
assertFinds(engine, "enxiou", ["银灰"]);
assertFinds(engine, "玛嘉烈", ["临光", "耀骑士临光"]);
assertFinds(engine, "majialie", ["临光", "耀骑士临光"]);
assertFinds(engine, "陈晖", ["陈", "假日威龙陈", "赤刃明霄陈"]);

assertFinds(engine, "鲨鲨", ["幽灵鲨", "归溟幽灵鲨"]);
assertFinds(engine, "shasha", ["幽灵鲨", "归溟幽灵鲨"]);
assertFinds(engine, "didi", ["斯卡蒂", "浊心斯卡蒂", "温蒂"]);
assertFinds(engine, "fupo", ["杰西卡", "诗怀雅", "鞭刃"]);
assertFinds(engine, "阿米驴", ["阿米娅"]);
assertFinds(engine, "amilv", ["阿米娅"]);
assertFinds(engine, "xiangjiaojie", ["死芒"]);

for (const query of [
  "银老板", "异刀", "夹子姐", "夹子妹", "蓝天使", "鬼姐", "脆脆蛙", "凯太后", "孑哥", "驴",
  "yinlaoban", "yidao", "jiazimei", "lantianshi", "guijie", "cuicuiwa", "kaitaihou", "lv",
]) {
  assert.deepStrictEqual(resultNames(engine, query), [], `${JSON.stringify(query)} must remain excluded`);
}
assertFinds(engine, "jiege", ["安洁莉娜"]);

const fiammettaLabels = ["菲亚梅塔", ...searchSource.specialGroups.aliasCandidates["菲亚梅塔"]];
const assertTitlesLocked = (engineInstance, label) => {
  const results = engineInstance.search(label);
  assert.strictEqual(results.length, 1, "locked titles show only the canonical operator");
  assert.strictEqual(results[0].op.n, "菲亚梅塔");
  assert(results.every((result) => !result.label), "titles stay hidden until three different titles are typed");
};
for (const label of fiammettaLabels.slice(1)) {
  assertTitlesLocked(createOperatorSearch(names, searchData), label);
}

const titleEngine = createOperatorSearch(names, searchData);
for (const query of ["肥鸭", "feiya", "菲亚梅塔", "feiyameita"]) titleEngine.search(query);
assert.deepStrictEqual(titleEngine.consumeGroupUnlocks(), [], "canonical name and 肥鸭 never unlock titles");
assertTitlesLocked(titleEngine, "苦难陈述者");
titleEngine.search("kunanchenshuzhe");
assert.strictEqual(titleEngine.search("微光守夜人").length, 1, "retyped pinyin and a second title stay locked");
const unlockResults = titleEngine.search("独臂电锯侠");
assert.deepStrictEqual(
  unlockResults.map((result) => result.label || result.op.n),
  fiammettaLabels,
  "typing the third distinct title expands every title candidate immediately"
);
assert.deepStrictEqual(titleEngine.consumeGroupUnlocks(), ["菲亚梅塔"]);
assert.deepStrictEqual(titleEngine.consumeGroupUnlocks(), [], "unlock event fires only once");

const uniqueTitleEngine = createOperatorSearch(names, searchData);
for (const query of ["苦", "微", "神", "kun"]) {
  const results = uniqueTitleEngine.search(query);
  assert(results.length > 1 && results.some((result) => result.op.n === "菲亚梅塔"), `${query} should keep its other visible candidates`);
  assert.deepStrictEqual(uniqueTitleEngine.consumeGroupUnlocks(), [], `${query} must not count when 菲亚梅塔 is not the only visible candidate`);
}
assert.deepStrictEqual(resultNames(uniqueTitleEngine, "毁"), ["菲亚梅塔"], "a unique one-character title prefix remains a visible association");
uniqueTitleEngine.search("huimi");
uniqueTitleEngine.search("kunan");
const shortPinyinUnlock = uniqueTitleEngine.search("weigu");
assert.strictEqual(shortPinyinUnlock.length, 15, "the third unique short pinyin title expands all candidates immediately");
assert.deepStrictEqual(uniqueTitleEngine.consumeGroupUnlocks(), ["菲亚梅塔"]);

const repeatTitleEngine = createOperatorSearch(names, searchData);
repeatTitleEngine.search("kunan");
repeatTitleEngine.search("苦难");
repeatTitleEngine.search("kunanchenshuzhe");
repeatTitleEngine.search("weigu");
assert.deepStrictEqual(repeatTitleEngine.consumeGroupUnlocks(), [], "one title only counts once across Chinese and pinyin inputs");
repeatTitleEngine.search("huimi");
assert.deepStrictEqual(repeatTitleEngine.consumeGroupUnlocks(), ["菲亚梅塔"]);
for (const label of fiammettaLabels.slice(1)) {
  const alias = searchData.aliases["菲亚梅塔"].find((record) => record.v === label);
  for (const query of [label, alias ? alias.p : "feiyameita"]) {
    const results = titleEngine.search(query, 8);
    assert.deepStrictEqual(results.map((result) => result.label || result.op.n), fiammettaLabels);
    assert(results.every((result) => result.op.n === "菲亚梅塔"), "alias choices must submit the canonical operator");
  }
}
assert.strictEqual(titleEngine.search("苦难陈")[0].op.n, "菲亚梅塔");
assert.strictEqual(titleEngine.search("kunanchenshu").length, 15);
for (const label of fiammettaLabels.slice(1)) {
  const results = titleEngine.search(label.slice(0, 2));
  assert.deepStrictEqual(
    results.map((result) => result.label || result.op.n),
    fiammettaLabels,
    "unlocked two-character title prefix expands every title candidate"
  );
}
for (const query of ["肥鸭", "feiya", "菲亚梅塔", "feiyameita", "菲亚梅", "feiyame"]) {
  const results = titleEngine.search(query);
  assert.strictEqual(results[0].op.n, "菲亚梅塔");
  assert(results.every((result) => !result.label), "ordinary operator names must not expand nickname candidates");
}
const freshEngine = createOperatorSearch(names, searchData);
assert(freshEngine.search("苦难陈述者").every((result) => !result.label));

const lockedPrefixEngine = createOperatorSearch(names, searchData);
assert(
  lockedPrefixEngine.search("苦难").every((result) => !result.label),
  "locked two-character title prefix must not expand titles"
);
lockedPrefixEngine.search("毁灭");
assert.strictEqual(
  lockedPrefixEngine.search("苦难陈述者").length,
  1,
  "two distinct titles stay locked even when one is typed in full"
);
const prefixUnlockResults = lockedPrefixEngine.search("毛绒");
assert.strictEqual(
  prefixUnlockResults.length,
  15,
  "third distinct two-character prefix triggers the association and unlocks"
);
assert.deepStrictEqual(lockedPrefixEngine.consumeGroupUnlocks(), ["菲亚梅塔"]);

for (const label of fiammettaLabels.slice(1)) {
  assert.strictEqual(freshEngine.resolveGroupSubmission(label), "菲亚梅塔");
  const alias = searchData.aliases["菲亚梅塔"].find((record) => record.v === label);
  if (alias) assert.strictEqual(freshEngine.resolveGroupSubmission(alias.p), "菲亚梅塔");
}
for (const query of ["肥鸭", "菲亚梅塔", "能天使", "苦难", ""]) {
  assert.strictEqual(freshEngine.resolveGroupSubmission(query), null);
}

assert.deepStrictEqual(resultNames(engine, "W").slice(0, 2), ["W", "维什戴尔"]);

const mamaExpected = [
  "乌啾", "电弧", "铃兰", "迷迭香", "巫恋", "瑰盐",
  "桃金娘", "苏苏洛", "伊芙利特", "泡普卡", "红云", "温米",
];
assert.deepStrictEqual(resultNames(engine, "妈妈"), mamaExpected);
assert.deepStrictEqual(resultNames(engine, "mama"), mamaExpected);

const electricExpected = [
  "电弧", "司霆惊蛰", "异客", "雷蛇", "澄闪",
  "承曦格雷伊", "布丁", "惊蛰", "格雷伊",
];
assert.deepStrictEqual(resultNames(engine, "电"), electricExpected);
assert.deepStrictEqual(resultNames(engine, "dian"), electricExpected);

const sarkazChinese = resultNames(engine, "魔族佬");
const sarkazPinyin = resultNames(engine, "mozulao");
assert.deepStrictEqual(sarkazChinese, sarkazPinyin, "special random choices should stay stable for the page session");
assert.deepStrictEqual(sarkazChinese.slice(0, 4), ["史尔特尔", "维什戴尔", "泥岩", "逻各斯"]);
assert.strictEqual(sarkazChinese.length, 8);
assert.strictEqual(new Set(sarkazChinese).size, 8);
assert(sarkazChinese.every((name) => searchData.specialGroups.sarkazPool.includes(name)));
assert(searchData.specialGroups.sarkazPool.every((name) => operators[name].race === "萨卡兹"));
const anotherSarkazSet = resultNames(
  createOperatorSearch(names, searchData, { random: seededRandom(7) }),
  "魔族佬"
);
assert.notDeepStrictEqual(
  anotherSarkazSet.slice(4),
  sarkazChinese.slice(4),
  "a new search session should randomize the non-fixed Sarkaz choices"
);

const configuredAliases = Object.entries(searchSource.aliases).flatMap(([name, aliases]) =>
  aliases.map((alias) => ({ name, alias }))
);
for (const { name, alias } of configuredAliases) {
  const record = searchData.aliases[name].find((candidate) => candidate.v === alias);
  assert(record, `generated alias record is missing: ${name} <- ${alias}`);
  assertFinds(engine, alias, [name]);
  assertFinds(engine, record.p, [name]);
}

const allConfiguredAliases = new Set(configuredAliases.map(({ alias }) => alias));
for (const forbidden of searchSource.forbiddenAliases) {
  assert(!allConfiguredAliases.has(forbidden), `forbidden alias was configured: ${forbidden}`);
}

console.log("operator search tests passed");
