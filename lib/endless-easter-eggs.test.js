const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  classifyInput,
  createEndlessEasterEggs,
  constants,
} = require("../public/js/endless-easter-eggs.js");

[constants.HAIMAO_MEDIA, ...constants.MAMA_MEDIA].forEach((source) => {
  const assetPath = path.join(__dirname, "..", "public", source);
  assert.ok(fs.statSync(assetPath).size > 0, source + " should be a non-empty public asset");
});

assert.deepStrictEqual(classifyInput("  音律联觉\t"), {
  type: "text",
  value: constants.MUSIC_TEXT,
});
assert.deepStrictEqual(classifyInput("前缀RUa牛后缀"), {
  type: "text",
  value: constants.RUA_TEXT,
});
assert.deepStrictEqual(classifyInput("rua 海猫"), {
  type: "media",
  value: constants.HAIMAO_MEDIA,
});

const eggs = createEndlessEasterEggs(["妈妈A", "妈妈B", "电弧"]);
assert.strictEqual(eggs.recordGuess("妈妈A"), null);
assert.strictEqual(eggs.recordGuess("妈妈B"), null);
assert.deepStrictEqual(eggs.recordGuess("妈妈A"), {
  type: "media",
  value: constants.MAMA_MEDIA[0],
});
assert.strictEqual(eggs.getStreak(), 0);
assert.strictEqual(eggs.recordGuess("妈妈A"), null);
assert.strictEqual(eggs.recordGuess("妈妈A"), null);
assert.deepStrictEqual(eggs.recordGuess("妈妈B"), {
  type: "media",
  value: constants.MAMA_MEDIA[1],
});

eggs.recordGuess("妈妈A");
eggs.recordGuess("电弧");
assert.strictEqual(eggs.getStreak(), 0);
eggs.recordGuess("妈妈A");
eggs.resetStreak();
assert.strictEqual(eggs.getStreak(), 0);
assert.strictEqual(eggs.recordGuess("妈妈A"), null);
assert.strictEqual(eggs.recordGuess("妈妈A"), null);
assert.deepStrictEqual(eggs.recordGuess("妈妈A"), {
  type: "media",
  value: constants.MAMA_MEDIA[2],
});

assert.strictEqual(eggs.recordGuess("妈妈A"), null);
assert.strictEqual(eggs.recordGuess("妈妈A"), null);
assert.deepStrictEqual(eggs.recordGuess("妈妈A"), {
  type: "media",
  value: constants.MAMA_MEDIA[0],
});
assert.strictEqual(eggs.recordGuess("妈妈A"), null);
assert.strictEqual(eggs.recordGuess("普通干员"), null);
assert.strictEqual(eggs.getStreak(), 0);

console.log("endless easter egg tests passed");
