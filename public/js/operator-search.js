(function attachOperatorSearch(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.OperatorSearch = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createApi() {
  "use strict";

  function normalize(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]/gu, "");
  }

  function isSubsequence(query, target) {
    let queryIndex = 0;
    for (let targetIndex = 0; targetIndex < target.length && queryIndex < query.length; targetIndex++) {
      if (target[targetIndex] === query[queryIndex]) queryIndex++;
    }
    return queryIndex === query.length;
  }

  function scoreOfficial(record, query) {
    if (record.name === query) return 120;
    if (record.pinyin === query) return 116;
    if (record.initials === query) return 110;
    if (record.name.startsWith(query)) return 100;
    if (record.pinyin.startsWith(query)) return 94;
    if (record.initials.startsWith(query)) return 86;
    if (record.name.includes(query)) return 66;
    if (query.length >= 2 && record.pinyin.includes(query)) return 58;
    if (query.length >= 2 && isSubsequence(query, record.initials)) return 46;
    if (query.length >= 3 && isSubsequence(query, record.pinyin)) return 40;
    return 0;
  }

  function scoreAlias(alias, query) {
    if (alias.value === query) return 114;
    if (alias.pinyin === query) return 112;
    if (query.length >= 2 && alias.initials === query) return 108;
    if (alias.value.startsWith(query)) return 104;
    if (query.length >= 2 && alias.pinyin.startsWith(query)) return 102;
    if (query.length >= 2 && alias.initials.startsWith(query)) return 90;
    return 0;
  }

  function shuffle(values, random) {
    const shuffled = values.slice();
    for (let index = shuffled.length - 1; index > 0; index--) {
      const swapIndex = Math.floor(random() * (index + 1));
      const previous = shuffled[index];
      shuffled[index] = shuffled[swapIndex];
      shuffled[swapIndex] = previous;
    }
    return shuffled;
  }

  function createOperatorSearch(names, searchData, options) {
    const settings = options || {};
    const random = typeof settings.random === "function" ? settings.random : Math.random;
    const data = searchData || {};
    const aliasesByName = data.aliases || {};
    const byName = new Map(names.map((operator) => [operator.n, operator]));
    const index = names.map((operator) => ({
      operator,
      name: normalize(operator.n),
      pinyin: normalize(operator.p),
      initials: normalize(operator.i),
      aliases: (aliasesByName[operator.n] || []).map((alias) => ({
        value: normalize(alias.v),
        pinyin: normalize(alias.p),
        initials: normalize(alias.i),
      })),
    }));
    const blockedQueries = new Set((data.blockedQueries || []).map(normalize));
    const groups = data.specialGroups || {};
    const mamaNames = (groups.mama || []).filter((name) => byName.has(name));
    const electricNameMatches = names
      .filter((operator) => operator.n.includes("电"))
      .map((operator) => operator.n);
    const electricNames = Array.from(new Set(
      (groups.electricCandidates || []).filter((name) => byName.has(name)).concat(electricNameMatches)
    ));
    const sarkazFixed = (groups.sarkazFixed || []).filter((name) => byName.has(name));
    const sarkazFixedSet = new Set(sarkazFixed);
    const sarkazRandom = shuffle(
      (groups.sarkazPool || []).filter((name) => byName.has(name) && !sarkazFixedSet.has(name)),
      random
    );
    const sarkazNames = sarkazFixed.concat(sarkazRandom.slice(0, Math.max(0, 8 - sarkazFixed.length)));

    function specialResults(query) {
      let resultNames = null;
      if (query === "妈妈" || query === "mama") resultNames = mamaNames;
      if (query === "魔族佬" || query === "mozulao") resultNames = sarkazNames;
      if (query === "电" || query === "dian") resultNames = electricNames;
      if (!resultNames) return null;
      return resultNames.map((name) => ({ op: byName.get(name), s: 200 }));
    }

    function search(value, limit) {
      const query = normalize(value);
      if (!query || blockedQueries.has(query)) return [];
      const special = specialResults(query);
      if (special) return special;

      const scored = [];
      for (const record of index) {
        let score = scoreOfficial(record, query);
        for (const alias of record.aliases) score = Math.max(score, scoreAlias(alias, query));
        if (score > 0) scored.push({ op: record.operator, s: score });
      }
      scored.sort((left, right) =>
        right.s - left.s
        || Number(right.op.hot) - Number(left.op.hot)
        || Number(right.op.f || 0) - Number(left.op.f || 0)
        || left.op.n.localeCompare(right.op.n, "zh")
      );
      return scored.slice(0, limit || 8);
    }

    return { search };
  }

  return { createOperatorSearch, normalize };
});
