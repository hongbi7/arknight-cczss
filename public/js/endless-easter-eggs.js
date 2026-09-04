(function attachEndlessEasterEggs(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.EndlessEasterEggs = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createApi() {
  "use strict";

  const MUSIC_TEXT = "需要我帮你穷举下一次抢票日期吗？";
  const RUA_TEXT = "还是希望大家有种";
  const HAIMAO_MEDIA = "img/endless-easter-eggs/haimao.gif";
  const MAMA_MEDIA = [
    "img/endless-easter-eggs/mama-01.jpg",
    "img/endless-easter-eggs/mama-02.png",
    "img/endless-easter-eggs/mama-03.gif",
  ];

  // Classification is deliberately stateless. Haimao wins when a string has
  // more than one marker (for example, "海猫 rua").
  function classifyInput(value) {
    const input = String(value == null ? "" : value);
    if (input.includes("海猫")) return { type: "media", value: HAIMAO_MEDIA };
    if (input.trim() === "音律联觉") return { type: "text", value: MUSIC_TEXT };
    if (input.toLowerCase().includes("rua")) return { type: "text", value: RUA_TEXT };
    return null;
  }

  function createEndlessEasterEggs(mamaNames) {
    const mamaSet = mamaNames instanceof Set ? new Set(mamaNames) : new Set(mamaNames || []);
    let streak = 0;
    let mediaIndex = 0;

    function resetStreak() {
      streak = 0;
    }

    function recordGuess(value) {
      const guess = String(value == null ? "" : value);
      if (guess !== "电弧" && mamaSet.has(guess)) {
        streak++;
        if (streak === 3) {
          const media = MAMA_MEDIA[mediaIndex];
          mediaIndex = (mediaIndex + 1) % MAMA_MEDIA.length;
          streak = 0;
          return { type: "media", value: media };
        }
        return null;
      }
      resetStreak();
      return null;
    }

    return {
      recordGuess,
      resetStreak,
      getStreak: () => streak,
      getMediaIndex: () => mediaIndex,
    };
  }

  return {
    classifyInput,
    createEndlessEasterEggs,
    constants: {
      MUSIC_TEXT,
      RUA_TEXT,
      HAIMAO_MEDIA,
      MAMA_MEDIA: MAMA_MEDIA.slice(),
    },
  };
});
