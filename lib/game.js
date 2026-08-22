const crypto = require("crypto");
const data = require("../server-data/operators.json");
const archives = require("../server-data/operator-archives.json");

const SECRET = process.env.GAME_SECRET || "local-dev-secret";
const KEY = crypto.createHash("sha256").update(SECRET).digest();
const SUDDEN_MAX = 6;
const SUDDEN_MIN = 1;
const SUDDEN_LIMIT = 20;
const HEIGHT_CLOSE_CM = 15;
const BIRTHDAY_CLOSE_DAYS = 60;

const ALL_NAMES = Object.keys(data);

function publicProfile(operator) {
  return {
    id: operator.id,
    name: operator.name,
    profession: operator.profession,
    professionText: operator.professionText,
    subProfessionId: operator.subProfessionId,
    subProfessionText: operator.subProfessionText,
    rarity: operator.rarity,
    position: operator.position,
    gender: operator.gender,
    expText: operator.expText,
    origin: operator.origin,
    birthdayText: operator.birthdayText,
    race: operator.race,
    heightText: operator.heightText,
    infectedText: operator.infectedText,
    tags: operator.tags,
  };
}

function personnelArchive(operator) {
  return archives[operator.id] || [];
}

function poolFor() {
  return ALL_NAMES;
}

function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

function decrypt(token) {
  try {
    const buf = Buffer.from(token, "base64url");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const d = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
    d.setAuthTag(tag);
    return JSON.parse(Buffer.concat([d.update(enc), d.final()]).toString("utf8"));
  } catch (e) {
    return null;
  }
}

function normalizeSuddenMax(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return SUDDEN_MAX;
  return Math.min(SUDDEN_LIMIT, Math.max(SUDDEN_MIN, parsed));
}

function sessionSuddenMax(session) {
  return normalizeSuddenMax(session && session.maxAttempts);
}

function newGame(mode, requestedMax) {
  const pool = poolFor(mode);
  const secretName = pool[Math.floor(Math.random() * pool.length)];
  const maxAttempts = mode === "sudden" ? normalizeSuddenMax(requestedMax) : null;
  const token = encrypt({ name: secretName, mode, guesses: [], maxAttempts });
  return { token, total: pool.length, maxAttempts };
}

function cmp(a, b) {
  if (a === b) return 0;
  return a > b ? 1 : -1;
}

function dimResult(secret, guess) {
  return {
    profession: {
      state: guess.profession === secret.profession ? "exact" : "wrong",
      guess: guess.profession,
      answer: secret.profession,
      guessText: guess.professionText,
      answerText: secret.professionText,
    },
    subProfession: {
      state: guess.subProfessionId === secret.subProfessionId ? "exact" : "wrong",
      guess: guess.subProfessionId,
      answer: secret.subProfessionId,
      guessText: guess.subProfessionText,
      answerText: secret.subProfessionText,
    },
    rarity: {
      state: guess.rarity === secret.rarity ? "exact" : cmp(guess.rarity, secret.rarity) > 0 ? "high" : "low",
      guess: guess.rarity,
      answer: secret.rarity,
      guessText: guess.rarity + "星",
      answerText: secret.rarity + "星",
    },
    position: {
      state: guess.position === secret.position ? "exact" : "wrong",
      guess: guess.position,
      answer: secret.position,
      guessText: guess.position === "RANGED" ? "远程" : "近战",
      answerText: secret.position === "RANGED" ? "远程" : "近战",
    },
    tags: {
      state: "hint",
      shared: guess.tags.filter((t) => secret.tags.includes(t)),
      guess: guess.tags,
      answer: secret.tags,
    },
    gender: {
      state: guess.gender === secret.gender ? "exact" : "wrong",
      guess: guess.gender,
      answer: secret.gender,
    },
    exp: {
      state: expState(guess.exp, secret.exp),
      guess: guess.exp,
      answer: secret.exp,
      guessText: guess.expText,
      answerText: secret.expText,
      special: !!guess.expSpecial,
    },
    origin: {
      state: originState(guess.origin, secret.origin),
      guess: guess.origin,
      answer: secret.origin,
      special: !!guess.originSpecial,
    },
    birthday: birthdayState(guess.birthday, secret.birthday, guess.birthdayText, secret.birthdayText),
    race: {
      state: guess.race === secret.race ? "exact" : "wrong",
      guess: guess.race,
      answer: secret.race,
      special: !!guess.raceSpecial,
    },
    height: {
      ...heightState(guess.height, secret.height),
      guess: guess.height,
      answer: secret.height,
      guessText: guess.heightText,
      answerText: secret.heightText,
    },
    infected: {
      state: infectedState(guess.infected, secret.infected),
      guess: guess.infected,
      answer: secret.infected,
    },
  };
}

function expState(g, s) {
  if (g === null || s === null) return "unknown";
  if (g === s) return "exact";
  return g > s ? "high" : "low";
}

function originState(g, s) {
  if (!g || !s) return "unknown";
  return g === s ? "exact" : "wrong";
}

function signedDayDiff(g, s) {
  const da = new Date(2000, g.month - 1, g.day);
  const db = new Date(2000, s.month - 1, s.day);
  const raw = (db - da) / 86400000;
  const fwd = ((raw % 366) + 366) % 366;
  return fwd > 183 ? fwd - 366 : fwd;
}

function birthdayState(g, s, gt, st) {
  if (!g || !s) return { state: "unknown", close: false, guess: g, answer: s, guessText: gt, answerText: st };
  const d = signedDayDiff(g, s);
  const base = { guess: g, answer: s, guessText: gt, answerText: st };
  if (d === 0) return { state: "exact", close: false, ...base };
  return { state: d > 0 ? "after" : "before", close: Math.abs(d) <= BIRTHDAY_CLOSE_DAYS, ...base };
}

function heightState(g, s) {
  if (g === null || s === null) return { state: "unknown", close: false };
  if (g === s) return { state: "exact", close: false };
  return { state: g > s ? "high" : "low", close: Math.abs(g - s) <= HEIGHT_CLOSE_CM };
}

function infectedState(g, s) {
  if (g === null || s === null) return "unknown";
  if (g === s) return "exact";
  return "wrong";
}

function matches(operator, secret, key) {
  if (key === "subProfession") return operator.subProfessionId === secret.subProfessionId;
  if (key === "exp") return operator.exp === secret.exp && operator.exp !== null;
  if (key === "height") return operator.height === secret.height && operator.height !== null;
  if (key === "birthday") {
    return !!(operator.birthday && secret.birthday) &&
      operator.birthday.month === secret.birthday.month && operator.birthday.day === secret.birthday.day;
  }
  return operator[key] === secret[key];
}

const DIM_KEYS = ["profession", "subProfession", "rarity", "position", "gender", "exp", "origin", "birthday", "race", "height", "infected"];

function greenKeys(secret, guessNames) {
  const green = [];
  for (const gn of guessNames) {
    const g = data[gn];
    if (!g) continue;
    const dr = dimResult(secret, g);
    for (const k of DIM_KEYS) {
      if (dr[k].state === "exact" && !green.includes(k)) green.push(k);
    }
  }
  return green;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function choices(token) {
  const session = decrypt(token);
  if (!session) return { error: "invalid_session" };
  const secret = data[session.name];
  if (!secret) return { error: "invalid_session" };
  const maxAttempts = sessionSuddenMax(session);
  if (session.mode !== "sudden" || (session.guesses || []).length < maxAttempts) {
    return { error: "invalid_phase" };
  }
  const pool = poolFor(session.mode).filter((n) => n !== session.name && !(session.guesses || []).includes(n));
  const green = greenKeys(secret, session.guesses || []);
  const fullyMatched = shuffle(pool.filter((n) => green.every((k) => matches(data[n], secret, k))));
  const distractors = fullyMatched.slice(0, 3);

  if (distractors.length < 3) {
    const used = new Set(distractors);
    const strictFallback = shuffle(pool.filter((n) => {
      const op = data[n];
      return !used.has(n) && op.profession === secret.profession && op.gender === secret.gender;
    })).map((n) => {
      const op = data[n];
      return { n, greenScore: green.filter((k) => matches(op, secret, k)).length };
    }).sort((a, b) => b.greenScore - a.greenScore);

    for (const candidate of strictFallback) {
      distractors.push(candidate.n);
      if (distractors.length === 3) break;
    }
  }

  if (distractors.length < 2) {
    const used = new Set(distractors);
    const looseFallback = shuffle(pool.filter((n) => !used.has(n))).map((n) => {
      const op = data[n];
      return {
        n,
        priorityScore: (op.profession === secret.profession ? 120 : 0) + (op.gender === secret.gender ? 100 : 0),
        greenScore: green.filter((k) => matches(op, secret, k)).length,
      };
    }).sort((a, b) => b.priorityScore - a.priorityScore || b.greenScore - a.greenScore);

    for (const candidate of looseFallback) {
      distractors.push(candidate.n);
      if (distractors.length === 2) break;
    }
  }

  const optionNames = shuffle([session.name].concat(distractors));
  const full = green.length;
  const fullMatches = optionNames.filter((n) =>
    green.filter((k) => matches(data[n], secret, k)).length === full
  ).length;
  return {
    options: optionNames.map((name) => publicProfile(data[name])),
    remaining: 0,
    fullMatches,
    relaxedCount: optionNames.length - fullMatches,
  };
}

function pick(token, pickName) {
  const session = decrypt(token);
  if (!session) return { error: "invalid_session" };
  const secret = data[session.name];
  if (!secret) return { error: "invalid_session" };
  const won = pickName === session.name;
  const dims = dimResult(secret, secret);
  for (const key of Object.keys(dims)) dims[key].state = "exact";
  return {
    win: won,
    answerName: secret.name,
    pickName,
    dims,
    operator: publicProfile(secret),
    archive: personnelArchive(secret),
  };
}

function guess(token, guessName) {
  const session = decrypt(token);
  if (!session) return { error: "invalid_session" };
  const secret = data[session.name];
  if (!secret) return { error: "invalid_session" };
  const maxAttempts = session.mode === "sudden" ? sessionSuddenMax(session) : null;
  if (session.mode === "sudden" && (session.guesses || []).length >= maxAttempts) {
    return { error: "attempts_exhausted" };
  }
  const guessOp = data[guessName];
  if (!guessOp) return { error: "unknown_operator" };
  const won = guessName === session.name;
  const dims = dimResult(secret, guessOp);
  if (won) {
    for (const key of Object.keys(dims)) dims[key].state = "exact";
  }
  const guesses = (session.guesses || []).concat([guessName]);
  const remaining = session.mode === "sudden" ? Math.max(0, maxAttempts - guesses.length) : null;
  const out = {
    win: won,
    guessName: guessOp.name,
    mode: session.mode,
    total: poolFor(session.mode).length,
    remaining,
    dims,
    operator: publicProfile(guessOp),
    token: encrypt({ name: session.name, mode: session.mode, guesses, maxAttempts }),
  };
  if (won) {
    out.answerName = secret.name;
    out.archive = personnelArchive(secret);
  }
  return out;
}

function reveal(token) {
  const session = decrypt(token);
  if (!session) return { error: "invalid_session" };
  const secret = data[session.name];
  if (!secret) return { error: "invalid_session" };
  const dims = dimResult(secret, secret);
  for (const key of Object.keys(dims)) dims[key].state = "exact";
  return {
    answerName: secret.name,
    dims,
    operator: publicProfile(secret),
    archive: personnelArchive(secret),
  };
}

module.exports = { newGame, guess, reveal, choices, pick, SUDDEN_MAX, count: Object.keys(data).length };
