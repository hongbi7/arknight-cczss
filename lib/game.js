const crypto = require("crypto");
const data = require("../server-data/operators.json");

const SECRET = process.env.GAME_SECRET || "local-dev-secret";
const KEY = crypto.createHash("sha256").update(SECRET).digest();
const SUDDEN_MAX = 5;

const ALL_NAMES = Object.keys(data);

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

function newGame(mode) {
  const pool = poolFor(mode);
  const secretName = pool[Math.floor(Math.random() * pool.length)];
  const token = encrypt({ name: secretName, mode, guesses: [] });
  return { token, total: pool.length };
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
    },
    origin: {
      state: originState(guess.origin, secret.origin),
      guess: guess.origin,
      answer: secret.origin,
    },
    birthday: birthdayState(guess.birthday, secret.birthday, guess.birthdayText, secret.birthdayText),
    race: {
      state: guess.race === secret.race ? "exact" : "wrong",
      guess: guess.race,
      answer: secret.race,
    },
    height: {
      state: heightState(guess.height, secret.height),
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

function birthdayState(g, s, gt, st) {
  if (!g || !s) return "unknown";
  const gn = g.month * 100 + g.day;
  const sn = s.month * 100 + s.day;
  if (gn === sn) return { state: "exact", guess: g, answer: s, guessText: gt, answerText: st };
  return {
    state: gn < sn ? "after" : "before",
    guess: g,
    answer: s,
    guessText: gt,
    answerText: st,
  };
}

function heightState(g, s) {
  if (g === null || s === null) return "unknown";
  if (g === s) return "exact";
  return g > s ? "high" : "low";
}

function infectedState(g, s) {
  if (g === null || s === null) return "unknown";
  if (g === s) return "exact";
  return "wrong";
}

function matches(operator, secret, key) {
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
  const pool = poolFor(session.mode).filter((n) => n !== session.name && !(session.guesses || []).includes(n));
  const green = greenKeys(secret, session.guesses || []);
  const scored = pool.map((n) => {
    const op = data[n];
    return { n, score: green.filter((k) => matches(op, secret, k)).length };
  });
  const ranked = shuffle(scored).sort((a, b) => b.score - a.score);
  const distractors = ranked.slice(0, 3).map((x) => x.n);
  return { options: shuffle([session.name].concat(distractors)), remaining: 0 };
}

function pick(token, pickName) {
  const session = decrypt(token);
  if (!session) return { error: "invalid_session" };
  const secret = data[session.name];
  if (!secret) return { error: "invalid_session" };
  const won = pickName === session.name;
  return { win: won, answerName: secret.name, pickName };
}

function guess(token, guessName) {
  const session = decrypt(token);
  if (!session) return { error: "invalid_session" };
  const secret = data[session.name];
  if (!secret) return { error: "invalid_session" };
  const guessOp = data[guessName];
  if (!guessOp) return { error: "unknown_operator" };
  const won = guessName === session.name;
  const dims = dimResult(secret, guessOp);
  if (won) {
    for (const key of Object.keys(dims)) dims[key].state = "exact";
  }
  const guesses = (session.guesses || []).concat([guessName]);
  const remaining = session.mode === "sudden" ? SUDDEN_MAX - guesses.length : null;
  const out = {
    win: won,
    guessName: guessOp.name,
    mode: session.mode,
    total: poolFor(session.mode).length,
    remaining,
    dims,
    token: encrypt({ name: session.name, mode: session.mode, guesses }),
  };
  if (won) out.answerName = secret.name;
  return out;
}

function reveal(token) {
  const session = decrypt(token);
  if (!session) return { error: "invalid_session" };
  const secret = data[session.name];
  if (!secret) return { error: "invalid_session" };
  return { answerName: secret.name };
}

module.exports = { newGame, guess, reveal, choices, pick, SUDDEN_MAX, count: Object.keys(data).length };
