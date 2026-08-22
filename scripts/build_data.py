# -*- coding: utf-8 -*-
import json
import re
import os

from pypinyin import pinyin, Style

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHAR_PATH = r"H:\配置\下载\character_table.json"
HANDBOOK_PATH = r"H:\配置\下载\handbook_info_table.json"

OUT_SERVER = os.path.join(ROOT, "server-data", "operators.json")
OUT_NAMES = os.path.join(ROOT, "public", "data", "names.json")

EXP_KEYS = [
    "战斗经验", "格斗经验", "表演经验", "保镖经验", "偷窃经验", "向导经验",
    "家族活动经验", "工程经验", "打工经验", "打扫战场经验", "打架经验", "斗殴经验",
    "特工经验", "狱中斗殴经验", "直播经验", "骑士竞技经验", "迷宫经验",
]

PROFESSION_ZH = {
    "WARRIOR": "近卫", "CASTER": "术士", "SNIPER": "狙击", "SPECIAL": "特种",
    "TANK": "重装", "SUPPORT": "辅助", "PIONEER": "先锋", "MEDIC": "医疗",
}

SUBPROFESSION_ZH = {
    "agent": "情报官", "alchemist": "炼金师", "aoesniper": "炮手",
    "artsfghter": "术战者", "artsprotector": "驭法铁卫", "bard": "吟游者",
    "bearer": "执旗手", "blastcaster": "轰击术师", "blessing": "护佑者",
    "bombarder": "投掷手", "centurion": "强攻手", "chain": "链术师",
    "chainhealer": "链愈师", "charger": "冲锋手", "closerange": "重射手",
    "corecaster": "中坚术师", "counsellor": "策士", "craftsman": "工匠",
    "crusher": "重剑手", "dollkeeper": "傀儡师", "duelist": "决战者",
    "executor": "处决者", "fastshot": "速射手", "fearless": "无畏者",
    "fighter": "斗士", "fortress": "要塞", "funnel": "驭械术师", "geek": "怪杰",
    "guardian": "守护者", "hammer": "撼地者", "healer": "疗养师",
    "hookmaster": "钩索师", "hunter": "猎手", "incantationmedic": "咒愈师",
    "instructor": "教官", "librator": "解放者", "longrange": "神射手",
    "loopshooter": "回环射手", "lord": "领主", "mercenary": "佣兵",
    "merchant": "行商", "musha": "武者", "mystic": "秘术师", "phalanx": "阵法术师",
    "physician": "医师", "pioneer": "尖兵", "primcaster": "本源术师",
    "primguard": "本源近卫", "primprotector": "本源铁卫", "protector": "铁卫",
    "pusher": "推击手", "reaper": "收割者", "reaperrange": "散射手",
    "ringhealer": "群愈师", "ritualist": "巫役", "shotprotector": "哨戒铁卫",
    "siegesniper": "攻城手", "skybreaker": "裂空炮手", "skywalker": "巡空者",
    "slower": "凝滞师", "soulcaster": "塑灵术师", "splashcaster": "扩散术师",
    "stalker": "伏击客", "summoner": "召唤师", "supportiveranger": "游击手",
    "sword": "剑豪", "tactician": "战术家", "traper": "陷阱师",
    "underminer": "削弱者", "unyield": "不屈者", "wandermedic": "行医",
    "watchman": "守望者",
}

NUM_MAP = {"零": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5,
           "六": 6, "七": 7, "八": 8, "九": 9}


def cnum(s):
    if not s:
        return None
    if s.isdigit():
        return float(s)
    total = 0
    n = 0
    for ch in s:
        if ch in NUM_MAP:
            n = NUM_MAP[ch]
        elif ch == "十":
            total += n * 10 if n else 10
            n = 0
        elif ch == "百":
            total += n * 100 if n else 100
            n = 0
        else:
            break
    total += n
    return float(total)


def parse_exp(v):
    v = v.strip()
    if v in ("保密", "未知", "未公开", "——", "--", "-"):
        return None
    if "没有战斗经验" in v or v == "无":
        return 0.0
    if "少于一年" in v or "半" in v:
        return 0.5
    if "一个月" in v:
        return 0.1
    m = re.search(r"[零一二两三四五六七八九十百]+", v)
    if m:
        return cnum(m.group())
    return None


def parse_height(v):
    m = re.search(r"(\d+)\s*cm", v)
    if m:
        return int(m.group(1))
    return None


def parse_birthday(v):
    m = re.search(r"(\d{1,2})月(\d{1,2})日", v)
    if m:
        return {"month": int(m.group(1)), "day": int(m.group(2))}
    return None


def parse_infected(v):
    if "非感染者" in v:
        return False
    if "感染者" in v:
        return True
    return None


def clean_text(v):
    v = v.strip()
    if "。" in v:
        v = v.split("。")[0] + "。"
    return v.split("\r")[0].split("\n")[0].strip()


SPECIAL_ORIGIN_RACE = ("未知", "未公开", "不明", "机密")


def is_special_value(v):
    if not v:
        return False
    return any(v == x or v.startswith(x) for x in SPECIAL_ORIGIN_RACE)


def basic_archive_fields(k):
    fields = {}
    for s in handbook[k].get("storyTextAudio") or []:
        if s.get("storyTitle") != "基础档案":
            continue
        for st in s.get("stories") or []:
            for seg in st.get("storyText", "").split("【"):
                if not seg:
                    continue
                parts = seg.split("】", 1)
                if len(parts) < 2:
                    continue
                fields.setdefault(parts[0].strip(), parts[1].strip())
            return fields
    return fields


def name_pinyin(name):
    try:
        syl = [s[0] for s in pinyin(name, style=Style.NORMAL)]
        full = "".join(syl).lower()
        ini = "".join(s[0] for s in syl).lower()
        return full, ini
    except Exception:
        return "", ""


character = json.load(open(CHAR_PATH, encoding="utf-8"))
handbook = json.load(open(HANDBOOK_PATH, encoding="utf-8"))["handbookDict"]

result = {}
names = []

for cid, cv in character.items():
    if cid.startswith(("npc_", "token_", "trap_")):
        continue
    if cv.get("isNotObtainable"):
        continue
    if cid not in handbook:
        continue

    name = cv.get("name")
    if not name:
        continue

    f = basic_archive_fields(cid)

    exp = None
    exp_text = None
    exp_special = False
    for ek in EXP_KEYS:
        if ek in f:
            exp_text = f[ek]
            exp = parse_exp(exp_text)
            exp_special = ek != "战斗经验"
            break

    rarity = int(cv.get("rarity", "TIER_1")[-1])
    full_py, ini_py = name_pinyin(name)

    origin = f.get("出身地") or f.get("产地")
    race = f.get("种族")

    record = {
        "id": cid,
        "name": name,
        "hot": rarity >= 5,
        "rarity": rarity,
        "position": cv.get("position"),
        "profession": cv.get("profession"),
        "professionText": PROFESSION_ZH.get(cv.get("profession"), cv.get("profession")),
        "subProfessionId": cv.get("subProfessionId"),
        "subProfessionText": SUBPROFESSION_ZH.get(cv.get("subProfessionId"), cv.get("subProfessionId")),
        "tags": cv.get("tagList") or [],
        "gender": f.get("性别") or f.get("设定性别"),
        "exp": exp,
        "expText": exp_text,
        "expSpecial": exp_special,
        "origin": origin,
        "originSpecial": is_special_value(origin),
        "birthday": parse_birthday(f.get("生日", "")),
        "birthdayText": f.get("生日"),
        "race": race,
        "raceSpecial": is_special_value(race),
        "height": parse_height(f.get("身高") or f.get("高度") or ""),
        "heightText": f.get("身高") or f.get("高度"),
        "infected": parse_infected(f.get("矿石病感染情况", "")),
        "infectedText": clean_text(f.get("矿石病感染情况", "")),
    }
    result[name] = record
    names.append({
        "n": name,
        "p": full_py,
        "i": ini_py,
        "hot": rarity >= 5,
    })

names = sorted(names, key=lambda x: x["n"])
os.makedirs(os.path.dirname(OUT_SERVER), exist_ok=True)
os.makedirs(os.path.dirname(OUT_NAMES), exist_ok=True)
json.dump(result, open(OUT_SERVER, "w", encoding="utf-8"), ensure_ascii=False)
json.dump(names, open(OUT_NAMES, "w", encoding="utf-8"), ensure_ascii=False)

print("operators:", len(result))
print("hot:", sum(1 for r in result.values() if r["hot"]))
print("exp special:", sum(1 for r in result.values() if r.get("expSpecial")))
print("origin special:", sum(1 for r in result.values() if r.get("originSpecial")))
print("race special:", sum(1 for r in result.values() if r.get("raceSpecial")))
nulls = {k: 0 for k in ["gender", "exp", "origin", "birthday", "race", "height", "infected"]}
for r in result.values():
    for k in nulls:
        if r[k] is None:
            nulls[k] += 1
print("null counts:", nulls)
print("rarity sample:", sorted(set(r["rarity"] for r in result.values())))
print("position:", sorted(set(r["position"] for r in result.values())))
print("infected:", sorted({str(r["infected"]) for r in result.values()}))
