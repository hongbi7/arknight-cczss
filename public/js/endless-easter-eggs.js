(function attachEndlessEasterEggs(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.EndlessEasterEggs = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createApi() {
  "use strict";

  const MUSIC_TEXT = "需要我帮你穷举下一次抢票日期吗？";
  const RUA_TEXT = "还是希望大家有种";
  const LINUO_TEXT = "魔族佬也能当偶像了？";
  const ADMIN_TEXT = "咕咕嘎嘎？";
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
    if (input.includes("梨诺")) return { type: "text", value: LINUO_TEXT };
    if (input.includes("管理员")) return { type: "text", value: ADMIN_TEXT };
    return null;
  }

  function createEndlessEasterEggs(mamaNames, options = {}) {
    const mamaSet = mamaNames instanceof Set ? new Set(mamaNames) : new Set(mamaNames || []);
    const random = options.random || Math.random;
    let streak = 0;
    let mediaQueue = [];
    let lastMedia = null;

    function nextMedia() {
      if (!mediaQueue.length) {
        mediaQueue = MAMA_MEDIA.slice();
        for (let index = mediaQueue.length - 1; index > 0; index--) {
          const swapIndex = Math.floor(random() * (index + 1));
          [mediaQueue[index], mediaQueue[swapIndex]] = [mediaQueue[swapIndex], mediaQueue[index]];
        }
        // Each cycle shows every image once; adjacent cycles must not repeat.
        if (mediaQueue[0] === lastMedia) {
          const swapIndex = 1 + Math.floor(random() * (mediaQueue.length - 1));
          [mediaQueue[0], mediaQueue[swapIndex]] = [mediaQueue[swapIndex], mediaQueue[0]];
        }
      }
      lastMedia = mediaQueue.shift();
      return lastMedia;
    }

    function resetStreak() {
      streak = 0;
    }

    function recordGuess(value) {
      const guess = String(value == null ? "" : value);
      if (guess !== "电弧" && mamaSet.has(guess)) {
        streak++;
        if (streak >= 3) {
          return { type: "media", value: nextMedia() };
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
    };
  }

  return {
    classifyInput,
    createEndlessEasterEggs,
    constants: {
      MUSIC_TEXT,
      RUA_TEXT,
      LINUO_TEXT,
      ADMIN_TEXT,
      HAIMAO_MEDIA,
      MAMA_MEDIA: MAMA_MEDIA.slice(),
    },
  };
});
