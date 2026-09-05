# -*- coding: utf-8 -*-
import json
import re
import os
import hashlib
import math
from collections import Counter, defaultdict
from pathlib import Path

from pypinyin import pinyin, Style

from atomic_write import atomic_write_json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT_PATH = Path(ROOT)


def find_excel_root():
    configured = os.environ.get("ARKNIGHTS_GAMEDATA_ROOT")
    candidates = []
    if configured:
        configured_path = Path(configured)
        candidates.extend([
            configured_path,
            configured_path / "zh_CN" / "gamedata" / "excel",
            configured_path / "cn" / "gamedata" / "excel",
            configured_path / "gamedata" / "excel",
        ])
    candidates.extend([
        ROOT_PATH / ".gamedata" / "excel",
        ROOT_PATH / ".gamedata" / "zh_CN" / "gamedata" / "excel",
        ROOT_PATH / ".gamedata" / "cn" / "gamedata" / "excel",
        ROOT_PATH / ".cache" / "arknights-gamedata" / "zh_CN" / "gamedata" / "excel",
        Path(r"H:\配置\下载"),
    ])
    required = ("character_table.json", "handbook_info_table.json", "range_table.json")
    for candidate in candidates:
        if all((candidate / name).is_file() for name in required):
            return candidate
    searched = "\n".join(f"- {path}" for path in candidates)
    raise FileNotFoundError(
        "Arknights GameData tables were not found. Set ARKNIGHTS_GAMEDATA_ROOT "
        f"to the excel directory or repository root.\nSearched:\n{searched}"
    )


EXCEL_ROOT = find_excel_root()
CHAR_PATH = EXCEL_ROOT / "character_table.json"
HANDBOOK_PATH = EXCEL_ROOT / "handbook_info_table.json"

OUT_SERVER = os.path.join(ROOT, "server-data", "operators.json")
OUT_NAMES = os.path.join(ROOT, "public", "data", "names.json")
OUT_CLUES = os.path.join(ROOT, "server-data", "operator-clues.json")
OUT_FAMILIARITY = os.path.join(ROOT, "server-data", "operator-familiarity.json")
OUT_IDENTITIES = os.path.join(ROOT, "server-data", "operator-identities.json")



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


SP_RECOVERY = {
    "INCREASE_WITH_TIME": "time",
    "INCREASE_WHEN_ATTACK": "attack",
    "INCREASE_WHEN_TAKEN_DAMAGE": "damaged",
    "8": "none",
}

ACTIVATION = {
    "MANUAL": "manual",
    "AUTO": "auto",
    "PASSIVE": "passive",
}

QUOTE_TITLE_HINTS = (
    "交谈", "信赖", "任命助理", "闲置", "观看作战记录", "精英化晋升",
    "编入队伍", "任命队长", "行动出发", "行动开始", "选中干员", "部署",
    "作战中", "结束行动", "完成高难", "行动失败", "进驻设施", "戳一下",
)
QUOTE_TITLE_EXCLUDES = ("干员报到", "标题", "问候", "生日", "周年")
QUOTE_HIGH_TITLE_HINTS = ("信赖提升后交谈", "晋升后交谈", "精英化晋升")
QUOTE_LOW_TITLE_HINTS = (
    "编入队伍", "任命队长", "行动出发", "行动开始", "选中干员", "部署",
    "作战中", "结束行动", "行动失败", "进驻设施", "戳一下",
)
QUOTE_DISTINCTIVE_TERMS = (
    "父亲", "母亲", "家人", "家族", "故乡", "过去", "以前", "小时候", "同事",
    "小队", "族裔", "职责", "代号", "武器", "法杖", "铳", "剑", "盾", "实验",
    "研究", "骑士", "感染者", "矿石病", "源石", "深海", "罗德岛", "龙门",
    "乌萨斯", "维多利亚", "拉特兰", "卡兹戴尔", "莱塔尼亚", "哥伦比亚",
    "炎国", "叙拉古", "谢拉格", "萨米", "玻利瓦尔", "伊比利亚", "米诺斯",
)
QUOTE_LIBRARY_LIMIT = 16
QUOTE_TIER_LIMIT = QUOTE_LIBRARY_LIMIT // 2


def clamp(value, low, high):
    return max(low, min(high, value))


def familiarity_tier(score):
    if score >= 80:
        return "S"
    if score >= 60:
        return "A"
    if score >= 35:
        return "B"
    return "C"


def structural_familiarity_score(character_record, skin_count):
    rarity = int(character_record.get("rarity", "TIER_1")[-1])
    rarity_score = {1: 1, 2: 2, 3: 6, 4: 5, 5: 5, 6: 8}.get(rarity, 0)
    approach = character_record.get("itemObtainApproach") or ""
    exposure = 0
    if "主题曲" in approach:
        exposure = 15
    elif "招募" in approach:
        exposure = 8
    elif "活动" in approach:
        exposure = 5
    elif approach:
        exposure = 4
    if rarity <= 3 and "招募" in approach:
        exposure += 8
    identity = 7 if character_record.get("isSpChar") else 0
    skin_exposure = min(12, skin_count * 3)
    rhodes_exposure = 3 if (character_record.get("mainPower") or {}).get("nationId") == "rhodes" else 0
    return clamp(10 + rarity_score + exposure + identity + skin_exposure + rhodes_exposure, 10, 79)


def progression_usage_score(character_record, progression):
    if not progression:
        return None
    rarity = int(character_record.get("rarity", "TIER_1")[-1])
    ownership = clamp(float(progression.get("ownership", 0)), 0, 100)
    elite2 = clamp(float(progression.get("elite2", 0)), 0, 100)
    mastery = clamp(float(progression.get("mastery", 0)), 0, 100)
    if rarity <= 3:
        return round(0.82 * ownership + 0.18 * max(elite2, mastery))
    return round(0.25 * ownership + 0.50 * elite2 + 0.25 * mastery)


def attention_signal_score(attention_record, community_score, provider_weights, active_providers):
    weighted_total = 0
    total_weight = 0
    used_sources = {}
    for provider in sorted(active_providers):
        weight = float((provider_weights.get(provider) or {}).get("weight", 0))
        if weight <= 0:
            continue
        source_record = (attention_record or {}).get(provider) or {}
        value = source_record.get("index")
        if not isinstance(value, (int, float)) or not math.isfinite(value):
            value = 50
        else:
            used_sources[provider] = round(clamp(float(value), 0, 100), 1)
        weighted_total += weight * clamp(float(value), 0, 100)
        total_weight += weight
    if community_score is not None:
        weight = float((provider_weights.get("communityAnchor") or {}).get("weight", 0))
        value = clamp(float(community_score), 0, 100)
        if weight > 0:
            weighted_total += weight * value
            total_weight += weight
            used_sources["communityAnchor"] = round(value, 1)
    if total_weight <= 0:
        return {"score": None, "sources": {}, "confidence": 0}
    active_weight = sum(
        float((provider_weights.get(provider) or {}).get("weight", 0))
        for provider in active_providers
    )
    confidence = clamp(0.5 + 0.7 * active_weight + (0.08 if community_score is not None else 0), 0, 0.95)
    return {
        "score": round(weighted_total / total_weight),
        "sources": used_sources,
        "confidence": round(confidence, 2),
    }


def familiarity_score(character_record, skin_count, progression, attention):
    structural_score = structural_familiarity_score(character_record, skin_count)
    usage_score = progression_usage_score(character_record, progression)
    attention_score = attention.get("score")
    if usage_score is not None and attention_score is not None:
        score = round(0.15 * structural_score + 0.52 * usage_score + 0.33 * attention_score)
        confidence = round(0.82 + 0.12 * attention.get("confidence", 0), 2)
    elif usage_score is not None:
        score = round(0.25 * structural_score + 0.75 * usage_score)
        confidence = 0.78
    elif attention_score is not None:
        score = round(0.35 * structural_score + 0.65 * attention_score)
        confidence = round(0.52 + 0.15 * attention.get("confidence", 0), 2)
    else:
        score = structural_score
        confidence = 0.35
    return {
        "score": clamp(score, 0, 100),
        "structuralScore": structural_score,
        "usageScore": usage_score,
        "attentionScore": attention_score,
        "attentionSources": attention.get("sources", {}),
        "confidence": confidence,
    }


def opaque_asset_url(kind, identity, suffix=""):
    digest = hashlib.sha256(f"sudden-v2:{kind}:{identity}:{suffix}".encode("utf-8")).hexdigest()[:20]
    return f"/img/clues/{kind}/{digest}.webp"


def strip_markup(value):
    value = value or ""
    value = re.sub(r"\{@nickname\}", "博士", value, flags=re.IGNORECASE)
    value = re.sub(r"\{@[^}]+\}", "", value)
    value = value.replace("\\n", " ").replace("\r", " ").replace("\n", " ")
    value = re.sub(r"<[^>]+>", "", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def mask_quote(text, operator_name, power_names):
    if not text:
        return ""
    if operator_name and operator_name in text:
        if len(operator_name) <= 1:
            return ""
        text = text.replace(operator_name, "■■")
    for value in power_names:
        if value and len(value) >= 2:
            text = text.replace(value, "■■")
    return text


def quote_information_score(title, text, operator_name, known_operator_names):
    length = len(text)
    score = 0.0
    if length >= 90:
        score += 1.5
    elif length >= 64:
        score += 1.1
    elif length >= 42:
        score += 0.7
    elif length >= 26:
        score += 0.25
    elif length < 18:
        score -= 1.1

    if any(hint in title for hint in QUOTE_HIGH_TITLE_HINTS):
        score += 0.9
    if any(hint in title for hint in QUOTE_LOW_TITLE_HINTS):
        score -= 1.25

    distinctive_hits = sum(1 for term in QUOTE_DISTINCTIVE_TERMS if term in text)
    score += min(1.5, distinctive_hits * 0.38)
    if any(
        name != operator_name and len(name) >= 2 and name in text
        for name in known_operator_names
    ):
        score += 1.45
    if re.search(r"我的|我曾|我们当时|来自|出生|遗物|真正的|记忆|故乡|家乡", text):
        score += 0.55
    if re.search(r"准备|出发|听从命令|敌人|任务开始|行动开始|作战开始", text):
        score -= 0.35
    return round(score, 2)


def quote_candidates(operator_id, operator_name, power_names, known_operator_names):
    candidates = []
    seen = set()
    for source_index, word in enumerate(words_by_operator.get(operator_id, [])):
        title = word.get("voiceTitle") or ""
        if not any(hint in title for hint in QUOTE_TITLE_HINTS):
            continue
        if any(blocked in title for blocked in QUOTE_TITLE_EXCLUDES):
            continue
        text = mask_quote(strip_markup(word.get("voiceText")), operator_name, power_names)
        if len(text) < 8 or text in seen:
            continue
        if len(text) > 120:
            text = text[:117].rstrip() + "……"
        seen.add(text)
        score = quote_information_score(title, text, operator_name, known_operator_names)
        candidates.append({
            "title": title,
            "text": text,
            "informationScore": score,
            "informationTier": "high" if score >= 2.15 else "low",
            "_sourceIndex": source_index,
        })

    if len(candidates) >= 2:
        if not any(item["informationTier"] == "high" for item in candidates):
            max(candidates, key=lambda item: (item["informationScore"], -item["_sourceIndex"]))[
                "informationTier"
            ] = "high"
        if not any(item["informationTier"] == "low" for item in candidates):
            min(candidates, key=lambda item: (item["informationScore"], item["_sourceIndex"]))[
                "informationTier"
            ] = "low"

    high = sorted(
        (item for item in candidates if item["informationTier"] == "high"),
        key=lambda item: (-item["informationScore"], item["_sourceIndex"]),
    )[:QUOTE_TIER_LIMIT]
    low = sorted(
        (item for item in candidates if item["informationTier"] == "low"),
        key=lambda item: (item["informationScore"], item["_sourceIndex"]),
    )[:QUOTE_TIER_LIMIT]
    selected = high + low
    if len(selected) < min(QUOTE_LIBRARY_LIMIT, len(candidates)):
        selected_ids = {id(item) for item in selected}
        remainder = sorted(
            (item for item in candidates if id(item) not in selected_ids),
            key=lambda item: (-item["informationScore"], item["_sourceIndex"]),
        )
        selected.extend(remainder[:QUOTE_LIBRARY_LIMIT - len(selected)])
    selected.sort(key=lambda item: item["_sourceIndex"])
    return [{key: value for key, value in item.items() if key != "_sourceIndex"} for item in selected]


def highest_phase_data(character_record):
    phases = character_record.get("phases") or []
    if not phases:
        return None, None
    phase = phases[-1]
    frames = phase.get("attributesKeyFrames") or []
    attributes = (frames[0].get("data") if frames else None) or {}
    return phase, attributes


def range_cells_for(range_id):
    range_entry = ranges.get(range_id) or {}
    return sorted(
        ({"x": int(grid.get("col") or 0), "y": int(grid.get("row") or 0)} for grid in range_entry.get("grids") or []),
        key=lambda cell: (cell["x"], cell["y"]),
    )


def skill_candidates(character_record, base_range_id):
    result = []
    for index, skill_ref in enumerate(character_record.get("skills") or [], 1):
        skill_id = skill_ref.get("skillId")
        skill = skills.get(skill_id)
        if not skill or not skill.get("levels"):
            continue
        level = skill["levels"][-1]
        name = strip_markup(level.get("name"))
        if not name:
            continue
        sp_data = level.get("spData") or {}
        charge_count = int(sp_data.get("maxChargeTime") or 0)
        description = strip_markup(level.get("description"))
        blackboard_keys = {str(item.get("key")) for item in level.get("blackboard") or []}
        is_ammo = "弹药" in description and (
            "attack@trigger_time" in blackboard_keys or "发弹药" in description
        )
        skill_range_id = level.get("rangeId")
        effective_range_id = skill_range_id or base_range_id
        prefab_id = level.get("prefabId") or skill_id
        icon_candidates = []
        for value in (skill_ref.get("overridePrefabKey"), skill_id, prefab_id):
            if not value:
                continue
            base = re.sub(r"\[[^\]]+\]$", "", value)
            for candidate in (value, base):
                asset_name = f"skill_icon_{candidate}"
                if asset_name not in icon_candidates:
                    icon_candidates.append(asset_name)
        icon_target_url = opaque_asset_url("skill", skill_id)
        icon_exists = (ROOT_PATH / "public" / icon_target_url.lstrip("/")).is_file()
        result.append({
            "slot": f"S{index}",
            "name": name,
            "skillId": skill_id,
            "iconCandidates": icon_candidates,
            "iconTargetUrl": icon_target_url,
            "iconUrl": icon_target_url if icon_exists else None,
            "rangeId": effective_range_id,
            "rangeCells": range_cells_for(effective_range_id),
            "rangeOverridden": bool(skill_range_id),
            "mechanic": {
                "slot": f"S{index}",
                "activation": ACTIVATION.get(str(level.get("skillType")), "unknown"),
                "spRecovery": SP_RECOVERY.get(str(sp_data.get("spType")), "unknown"),
                "chargeable": charge_count > 1,
                "maxChargeTime": charge_count if charge_count > 1 else 1,
                "ammo": is_ammo,
            },
        })
    return result


def power_record(character_record):
    main_power = character_record.get("mainPower") or {}
    nation_id = main_power.get("nationId") or character_record.get("nationId")
    group_id = main_power.get("groupId") or character_record.get("groupId")
    team_id = main_power.get("teamId") or character_record.get("teamId")
    power_id = team_id or group_id or nation_id or "none"
    parent_id = group_id if team_id and group_id else nation_id if power_id != nation_id else None
    root_id = nation_id or power_id
    logo_id = next((item for item in (power_id, parent_id, root_id) if item in faction_logo_ids), None)

    def power_name(value):
        return (powers.get(value) or {}).get("powerName") if value else None

    return {
        "id": power_id,
        "name": power_name(power_id) or "无团队",
        "parentId": parent_id,
        "parentName": power_name(parent_id),
        "rootId": root_id,
        "rootName": power_name(root_id) or "无团队",
        "logoId": logo_id,
        "logoUrl": f"/img/factions/{logo_id}.webp" if logo_id else None,
    }


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
powers = json.load(open(EXCEL_ROOT / "handbook_team_table.json", encoding="utf-8"))
ranges = json.load(open(EXCEL_ROOT / "range_table.json", encoding="utf-8"))
skills = json.load(open(EXCEL_ROOT / "skill_table.json", encoding="utf-8"))
charwords = json.load(open(EXCEL_ROOT / "charword_table.json", encoding="utf-8"))
skin_table = json.load(open(EXCEL_ROOT / "skin_table.json", encoding="utf-8"))
identity_source = json.loads((ROOT_PATH / "scripts" / "operator-identities.json").read_text(encoding="utf-8"))

override_path = ROOT_PATH / "scripts" / "familiarity-overrides.json"
familiarity_overrides = json.loads(override_path.read_text(encoding="utf-8")) if override_path.is_file() else {}
popularity_path = ROOT_PATH / "scripts" / "operator-popularity-signals.json"
popularity_source = json.loads(popularity_path.read_text(encoding="utf-8")) if popularity_path.is_file() else {}
progression_by_operator = popularity_source.get("operators", {})
popularity_meta = popularity_source.get("_meta", {})
attention_path = ROOT_PATH / "scripts" / "operator-attention-signals.json"
attention_source = json.loads(attention_path.read_text(encoding="utf-8")) if attention_path.is_file() else {}
attention_by_operator = attention_source.get("operators", {})
attention_meta = attention_source.get("_meta", {})
attention_weight_path = ROOT_PATH / "scripts" / "popularity-source-weights.json"
attention_weight_source = (
    json.loads(attention_weight_path.read_text(encoding="utf-8"))
    if attention_weight_path.is_file() else {}
)
attention_provider_weights = attention_weight_source.get("providers", {})
logo_manifest_path = ROOT_PATH / "public" / "data" / "faction-logos.json"
logo_manifest = json.loads(logo_manifest_path.read_text(encoding="utf-8")) if logo_manifest_path.is_file() else {}
faction_logo_ids = set(logo_manifest)

eligible_operator_ids = {
    operator_id for operator_id, record in character.items()
    if not operator_id.startswith(("npc_", "token_", "trap_"))
    and not record.get("isNotObtainable")
    and operator_id in handbook
    and record.get("name")
}
eligible_operator_names = tuple(
    character[operator_id]["name"]
    for operator_id in eligible_operator_ids
)
attention_provider_coverage = {}
active_attention_providers = set()
for provider in attention_provider_weights:
    if provider == "communityAnchor":
        continue
    valid_count = 0
    for operator_id in eligible_operator_ids:
        provider_record = (attention_by_operator.get(operator_id) or {}).get(provider) or {}
        value = provider_record.get("index")
        if not isinstance(value, (int, float)) or not math.isfinite(value):
            continue
        if provider == "bilibiliVideo" and provider_record.get("resultCount", 0) <= 0:
            continue
        valid_count += 1
    coverage = valid_count / len(eligible_operator_ids) if eligible_operator_ids else 0
    attention_provider_coverage[provider] = {
        "valid": valid_count,
        "expected": len(eligible_operator_ids),
        "coverage": round(coverage, 4),
        "enabled": coverage >= 0.9,
    }
    if coverage >= 0.9:
        active_attention_providers.add(provider)

skin_counts = Counter()
for skin in skin_table.get("charSkins", {}).values():
    operator_id = skin.get("charId")
    if operator_id:
        skin_counts[operator_id] += 1

words_by_operator = defaultdict(list)
for word in charwords.get("charWords", {}).values():
    operator_id = word.get("charId")
    if operator_id:
        words_by_operator[operator_id].append(word)
for operator_words in words_by_operator.values():
    operator_words.sort(key=lambda item: item.get("voiceIndex") or 999)

result = {}
names = []
clue_data = {}
familiarity_data = {}

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
    power = power_record(cv)
    phase, phase_attributes = highest_phase_data(cv)
    phase_attributes = phase_attributes or {}
    range_id = phase.get("rangeId") if phase else None
    range_cells = range_cells_for(range_id)
    attention_signals = attention_signal_score(
        attention_by_operator.get(cid),
        familiarity_overrides.get(name),
        attention_provider_weights,
        active_attention_providers,
    )
    familiarity_signals = familiarity_score(
        cv,
        skin_counts[cid],
        progression_by_operator.get(cid),
        attention_signals,
    )
    familiarity = familiarity_signals["score"]
    tier = familiarity_tier(familiarity)
    operator_skills = skill_candidates(cv, range_id)
    skill_ranges = [{
        "slot": skill["slot"],
        "rangeId": skill["rangeId"],
        "rangeCells": skill["rangeCells"],
        "rangeOverridden": skill["rangeOverridden"],
    } for skill in operator_skills]
    power_names = [power.get("name"), power.get("parentName"), power.get("rootName")]
    quotes = quote_candidates(cid, name, power_names, eligible_operator_names)

    record = {
        "id": cid,
        "name": name,
        # Kept during the frontend migration. New game logic uses the score.
        "hot": familiarity >= 60,
        "familiarityScore": familiarity,
        "familiarityTier": tier,
        "familiarityConfidence": familiarity_signals["confidence"],
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
        "power": power,
        "deploymentCost": int(phase_attributes.get("cost")) if phase_attributes.get("cost") is not None else None,
        "rangeId": range_id,
        "rangeCells": range_cells,
        "skillRanges": skill_ranges,
    }
    result[name] = record
    names.append({
        "n": name,
        "p": full_py,
        "i": ini_py,
        "hot": familiarity >= 60,
        "f": familiarity,
        "tier": tier,
    })
    clue_data[cid] = {
        "silhouetteUrl": opaque_asset_url("art", cid, "silhouette"),
        "fragmentUrls": [
            opaque_asset_url("art", cid, "fragment-small"),
            opaque_asset_url("art", cid, "fragment-medium"),
        ],
        "skills": operator_skills,
        "quotes": quotes,
    }
    familiarity_data[cid] = {
        "name": name,
        "score": familiarity,
        "tier": tier,
        "confidence": record["familiarityConfidence"],
        "structuralScore": familiarity_signals["structuralScore"],
        "usageScore": familiarity_signals["usageScore"],
        "communityScore": familiarity_overrides.get(name),
        "attentionScore": familiarity_signals["attentionScore"],
        "attentionSources": familiarity_signals["attentionSources"],
        "progressionSignalsVersion": popularity_meta.get("version"),
        "signalsVersion": popularity_meta.get("version"),
        "attentionSignalsVersion": attention_meta.get("version"),
        "activeAttentionProviders": sorted(active_attention_providers),
        "version": "2026-08-popularity-3",
    }

names = sorted(names, key=lambda x: x["n"])

operator_ids = {record["id"] for record in result.values()}
operator_by_id = {record["id"]: record for record in result.values()}

identity_groups = []
identity_by_operator = {}
for group in identity_source.get("groups") or []:
    base_id = group.get("baseId")
    member_ids = list(dict.fromkeys(group.get("memberIds") or []))
    missing_ids = [operator_id for operator_id in member_ids if operator_id not in operator_ids]
    if base_id not in member_ids:
        raise ValueError(f"Identity group {group.get('id')} does not include its base operator {base_id}")
    if missing_ids:
        raise ValueError(f"Identity group {group.get('id')} contains unknown operators: {missing_ids}")
    normalized = {
        "id": group["id"],
        "type": "alter",
        "baseId": base_id,
        "memberIds": member_ids,
        "alterIds": [operator_id for operator_id in member_ids if operator_id != base_id],
        "memberNames": [operator_by_id[operator_id]["name"] for operator_id in member_ids],
    }
    identity_groups.append(normalized)
    for operator_id in member_ids:
        if operator_id in identity_by_operator:
            raise ValueError(f"Operator {operator_id} occurs in multiple identity groups")
        identity_by_operator[operator_id] = {
            "groupId": group["id"],
            "role": "base" if operator_id == base_id else "alter",
        }

identity_data = {
    "schemaVersion": 1,
    "groups": identity_groups,
    "byOperator": identity_by_operator,
}

os.makedirs(os.path.dirname(OUT_SERVER), exist_ok=True)
os.makedirs(os.path.dirname(OUT_NAMES), exist_ok=True)
atomic_write_json(OUT_SERVER, result, separators=(",", ":"))
atomic_write_json(OUT_NAMES, names, separators=(",", ":"))
atomic_write_json(OUT_CLUES, clue_data, separators=(",", ":"))
atomic_write_json(OUT_IDENTITIES, identity_data, indent=2)
atomic_write_json(OUT_FAMILIARITY, familiarity_data, indent=2)

print("operators:", len(result))
print("hot:", sum(1 for r in result.values() if r["hot"]))
print("familiarity tiers:", dict(sorted(Counter(r["familiarityTier"] for r in result.values()).items())))
print("attention provider coverage:", attention_provider_coverage)
print("power coverage:", sum(1 for r in result.values() if r["power"]["id"] != "none"))
print("range coverage:", sum(1 for r in result.values() if r["rangeCells"]))
print("skill coverage:", sum(1 for r in result.values() if clue_data[r["id"]]["skills"]))
print("quote coverage:", sum(1 for r in result.values() if clue_data[r["id"]]["quotes"]))
print("identity groups:", len(identity_groups))
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
