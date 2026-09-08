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

function collectMedia(random) {
  const eggs = createEndlessEasterEggs(["妈妈A", "妈妈B", "电弧"], { random });
  assert.strictEqual(eggs.recordGuess("妈妈A"), null);
  assert.strictEqual(eggs.recordGuess("妈妈B"), null);
  const media = Array.from({ length: 12 }, () => {
    const presentation = eggs.recordGuess("妈妈A");
    assert.strictEqual(presentation.type, "media");
    return presentation.value;
  });
  assert.strictEqual(eggs.getStreak(), 14);
  for (let index = 0; index < media.length; index += 3) {
    assert.deepStrictEqual(new Set(media.slice(index, index + 3)), new Set(constants.MAMA_MEDIA));
  }
  media.slice(1).forEach((value, index) => assert.notStrictEqual(value, media[index]));
  for (const interruption of ["电弧", "普通干员"]) {
    assert.strictEqual(eggs.recordGuess(interruption), null);
    assert.strictEqual(eggs.getStreak(), 0);
    assert.strictEqual(eggs.recordGuess("妈妈A"), null);
    assert.strictEqual(eggs.recordGuess("妈妈B"), null);
    assert.strictEqual(eggs.recordGuess("妈妈A").type, "media");
  }
  eggs.resetStreak();
  assert.strictEqual(eggs.getStreak(), 0);
  assert.strictEqual(eggs.recordGuess("妈妈A"), null);
  return media;
}
assert.notDeepStrictEqual(collectMedia(() => 0), collectMedia(() => 0.999));

console.log("endless easter egg tests passed");
