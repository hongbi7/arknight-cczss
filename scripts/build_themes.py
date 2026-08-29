# -*- coding: utf-8 -*-
"""Generate the tactical directive theme bank and the brand skin art mapping.

Runs after build_data.py and build_anomaly_data.py: legacy mechanic themes are
recomputed from the generated clue archive, while room/limited/brand and new
battle-mechanic themes reuse the anomaly rule bank members instead of
duplicating their extraction logic.
"""
import hashlib
import json
import math
import os
import re
from collections import defaultdict
from pathlib import Path

from pypinyin import pinyin, Style

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT_PATH = Path(ROOT)

OUT_THEMES = ROOT_PATH / "server-data" / "operator-themes.json"
OUT_BRAND_ART = ROOT_PATH / "server-data" / "operator-brand-art.json"

FAMILIAR_SCORE = 50
ROOM_THEME_MIN_MEMBERS = 15
ROOM_THEME_MIN_FAMILIAR = 10
BRAND_THEME_MIN_MEMBERS = 15
BRAND_THEME_MIN_FAMILIAR = 12
IDENTITY_THEME_MIN_MEMBERS = 15
IDENTITY_THEME_MIN_FAMILIAR = 8


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
    ])
    required = ("character_table.json", "skill_table.json")
    for candidate in candidates:
        if all((candidate / name).is_file() for name in required):
            return candidate
    searched = "\n".join(f"- {path}" for path in candidates)
    raise FileNotFoundError(
        "Arknights GameData tables were not found. Set ARKNIGHTS_GAMEDATA_ROOT "
        f"to the excel directory or repository root.\nSearched:\n{searched}"
    )


EXCEL_ROOT = find_excel_root()


def clamp(value, low, high):
    return max(low, min(high, value))


def slugify(value):
    segments = []
    buffer = ""
    for ch in value:
        if ch.isascii() and ch.isalnum():
            buffer += ch.lower()
            continue
        if buffer:
            segments.append(buffer)
            buffer = ""
        syllables = pinyin(ch, style=Style.NORMAL)
        if syllables and syllables[0] and syllables[0][0]:
            segments.append(syllables[0][0].lower())
    if buffer:
        segments.append(buffer)
    slug = re.sub(r"[^a-z0-9-]+", "", "-".join(segments)).strip("-")
    return slug or hashlib.sha256(value.encode("utf-8")).hexdigest()[:12]


def character_gameplay_text(character_record):
    values = [character_record.get("description")]
    for talent in character_record.get("talents") or []:
        for candidate in talent.get("candidates") or []:
            values.extend((candidate.get("name"), candidate.get("description")))
    for candidate in (character_record.get("trait") or {}).get("candidates") or []:
        values.append(candidate.get("overrideDescripton"))
    for skill_ref in character_record.get("skills") or []:
        skill = skills.get(skill_ref.get("skillId")) or {}
        levels = skill.get("levels") or []
        if levels:
            values.extend((levels[-1].get("name"), levels[-1].get("description")))
    return "\n".join(str(value) for value in values if value)


def highest_respawn_time(character_record):
    phases = character_record.get("phases") or []
    if not phases:
        return None
    frames = phases[-1].get("attributesKeyFrames") or []
    if not frames:
        return None
    value = (frames[-1].get("data") or {}).get("respawnTime")
    return int(value) if value is not None else None


def has_force_mechanic(character_record):
    force_keys = {"force", "p_force", "attack@force", "base_force_level"}
    for skill_ref in character_record.get("skills") or []:
        skill = skills.get(skill_ref.get("skillId")) or {}
        levels = skill.get("levels") or []
        if not levels:
            continue
        if any(str(item.get("key")) in force_keys for item in levels[-1].get("blackboard") or []):
            return True
    return False


operators = json.loads((ROOT_PATH / "server-data" / "operators.json").read_text(encoding="utf-8"))
clues = json.loads((ROOT_PATH / "server-data" / "operator-clues.json").read_text(encoding="utf-8"))
anomaly_rules = json.loads((ROOT_PATH / "server-data" / "anomaly-rules.json").read_text(encoding="utf-8"))
anomaly_questions = json.loads((ROOT_PATH / "server-data" / "anomaly-questions.json").read_text(encoding="utf-8"))
identity_bank = json.loads((ROOT_PATH / "server-data" / "operator-identities.json").read_text(encoding="utf-8"))
theme_overrides = json.loads((ROOT_PATH / "scripts" / "theme-overrides.json").read_text(encoding="utf-8"))
character = json.load(open(EXCEL_ROOT / "character_table.json", encoding="utf-8"))
skills = json.load(open(EXCEL_ROOT / "skill_table.json", encoding="utf-8"))

rules = anomaly_rules.get("definitions") or {}
operator_by_id = {record["id"]: record for record in operators.values()}
operator_ids = set(operator_by_id)
identity_by_operator = identity_bank.get("byOperator") or {}


def familiar_count(members):
    return sum(1 for operator_id in members if operator_by_id[operator_id]["familiarityScore"] >= FAMILIAR_SCORE)


theme_specs = [
    ("skill_attack_recovery", "skill", "攻势蓄能", "至少一个技能采用攻击回复"),
    ("skill_auto_trigger", "skill", "自律响应", "至少一个技能会自动触发"),
    ("skill_passive", "skill", "被动响应", "至少拥有一个被动技能"),
    ("skill_all_manual", "skill", "指令响应", "所有技能均需手动触发"),
    ("skill_manual_auto", "skill", "双轨触发", "同时拥有手动与自动触发技能"),
    ("skill_chargeable", "skill", "多重蓄能", "至少一个技能可以充能"),
    ("skill_ammo", "skill", "弹药协议", "至少一个技能使用弹药机制"),
    ("skill_range_change", "skill", "火力域重构", "至少一个技能会改变攻击范围"),
    ("skill_distinct_ranges", "skill", "复合火力域", "不同技能使用不同攻击范围"),
    ("skill_none", "skill", "简式作战协议", "没有常规战斗技能"),
    ("battle_block_control", "battle", "阵线重构", "可以主动改变自身、友方或召唤物的阻挡数"),
    ("battle_fast_redeploy", "battle", "快速再投", "自身基础再部署时间不高于35秒"),
    ("battle_forced_movement", "battle", "位移干预", "能够推动、拖拽或强制移动目标"),
    ("battle_concealment", "battle", "光学遮蔽", "自身、友方或召唤物能够获得隐匿或迷彩"),
    ("battle_elemental", "battle", "元素干涉", "能够造成、治疗、减免或改变元素损伤机制"),
    ("identity_alter_family", "identity", "平行履历", "属于拥有异格形态的身份组"),
    ("identity_alter_form", "identity", "异格档案", "当前档案是一名异格干员"),
]

theme_members = {theme_id: set() for theme_id, _, _, _ in theme_specs}
for operator_id, record in operator_by_id.items():
    operator_skills = (clues.get(operator_id) or {}).get("skills") or []
    mechanics = [skill.get("mechanic") or {} for skill in operator_skills]
    if any(mechanic.get("spRecovery") == "attack" for mechanic in mechanics):
        theme_members["skill_attack_recovery"].add(operator_id)
    if any(mechanic.get("activation") == "auto" for mechanic in mechanics):
        theme_members["skill_auto_trigger"].add(operator_id)
    if any(mechanic.get("activation") == "passive" for mechanic in mechanics):
        theme_members["skill_passive"].add(operator_id)
    if mechanics and all(mechanic.get("activation") == "manual" for mechanic in mechanics):
        theme_members["skill_all_manual"].add(operator_id)
    if (
        any(mechanic.get("activation") == "manual" for mechanic in mechanics)
        and any(mechanic.get("activation") == "auto" for mechanic in mechanics)
    ):
        theme_members["skill_manual_auto"].add(operator_id)
    if any(mechanic.get("chargeable") for mechanic in mechanics):
        theme_members["skill_chargeable"].add(operator_id)
    if any(mechanic.get("ammo") for mechanic in mechanics):
        theme_members["skill_ammo"].add(operator_id)
    if any(skill.get("rangeOverridden") for skill in operator_skills):
        theme_members["skill_range_change"].add(operator_id)
    if len({skill.get("rangeId") for skill in operator_skills}) >= 2:
        theme_members["skill_distinct_ranges"].add(operator_id)
    if not operator_skills:
        theme_members["skill_none"].add(operator_id)

    character_record = character[operator_id]
    respawn_time = highest_respawn_time(character_record)
    if respawn_time is not None and respawn_time <= 35:
        theme_members["battle_fast_redeploy"].add(operator_id)
    if has_force_mechanic(character_record):
        theme_members["battle_forced_movement"].add(operator_id)
    if re.search(r"元素损伤|神经损伤|侵蚀损伤|灼燃损伤|凋亡损伤", character_gameplay_text(character_record)):
        theme_members["battle_elemental"].add(operator_id)

for theme_id in ("battle_block_control", "battle_concealment"):
    override = theme_overrides.get(theme_id) or {}
    included = set(override.get("include") or [])
    excluded = set(override.get("exclude") or [])
    unknown = sorted((included | excluded) - operator_ids)
    if unknown:
        raise ValueError(f"Theme override {theme_id} contains unknown operators: {unknown}")
    theme_members[theme_id].update(included)

block_candidates = {
    operator_id for operator_id in operator_ids
    if "阻挡数" in character_gameplay_text(character[operator_id])
}
concealment_candidates = {
    operator_id for operator_id in operator_ids
    if re.search(r"隐匿|迷彩", character_gameplay_text(character[operator_id]))
}
review_candidates = {}
for theme_id, candidates in (
    ("battle_block_control", block_candidates),
    ("battle_concealment", concealment_candidates),
):
    override = theme_overrides.get(theme_id) or {}
    reviewed = set(override.get("include") or []) | set(override.get("exclude") or [])
    review_candidates[theme_id] = sorted(candidates - reviewed)

theme_members["identity_alter_family"].update(identity_by_operator)
theme_members["identity_alter_form"].update(
    operator_id for operator_id, identity in identity_by_operator.items() if identity.get("role") == "alter"
)

extra_themes = []


def add_theme(theme_id, family, title, description, members, art_brand=None):
    extra_themes.append((theme_id, family, title, description, set(members), art_brand))


def rule_or_raise(rule_id):
    rule = rules.get(rule_id)
    if not rule:
        raise ValueError(f"Anomaly rule {rule_id} is required by the theme bank but missing")
    return rule


# 战斗机制：直接复用异类规则库已审计的成员集合。
for rule_id, theme_id in (
    ("battle.stun", "battle_stun"),
    ("battle.ally_heal", "battle_ally_heal"),
    ("battle.barrier", "battle_barrier"),
    ("battle.bind", "battle_bind"),
):
    rule = rule_or_raise(rule_id)
    add_theme(theme_id, "battle", rule["title"], rule["description"], rule["members"])

# 后勤：基建房间与限定寻访。
for rule_id in sorted((key for key in rules if key.startswith("logistics.base_room."))):
    rule = rule_or_raise(rule_id)
    if "：" not in rule["title"]:
        raise ValueError(f"Unexpected base room title: {rule['title']}")
    room = rule["title"].split("：", 1)[1]
    members = set(rule["members"])
    if len(members) < ROOM_THEME_MIN_MEMBERS or familiar_count(members) < ROOM_THEME_MIN_FAMILIAR:
        continue
    add_theme(
        f"logistics_base_room_{slugify(room)}",
        "logistics",
        f"基建：{room}",
        f"使用在{room}拥有基建技能的干员推进指令",
        members,
    )

limited_rule = rules.get("logistics.limited")
if not limited_rule:
    raise ValueError("Anomaly rule logistics.limited is required by the theme bank but missing")
add_theme(
    "logistics_limited",
    "logistics",
    "限定寻访",
    "使用通过限定寻访获得的干员推进指令",
    limited_rule["members"],
)

# 形象：服装品牌（皮肤立绘映射见下方 operator-brand-art.json）。
brand_candidates = []
for rule_id in sorted((key for key in rules if key.startswith("visual.outfit_brand."))):
    rule = rule_or_raise(rule_id)
    if "：" not in rule["title"]:
        raise ValueError(f"Unexpected outfit brand title: {rule['title']}")
    brand = rule["title"].split("：", 1)[1]
    members = set(rule["members"])
    if len(members) < BRAND_THEME_MIN_MEMBERS or familiar_count(members) < BRAND_THEME_MIN_FAMILIAR:
        continue
    brand_candidates.append((brand, members))
brand_candidates.sort(key=lambda item: (-len(item[1]), item[0]))
for brand, members in brand_candidates:
    add_theme(
        f"visual_brand_{slugify(brand)}",
        "visual",
        f"时装品牌：{brand}",
        f"使用拥有“{brand}”系列时装的干员推进指令，猜中时立绘会换上对应品牌皮肤",
        members,
        art_brand=brand,
    )
themed_brands = {art_brand for _, _, _, _, _, art_brand in extra_themes if art_brand}

# 身份：势力大系、所属势力、出身地、种族（玩家可报出成员的头部分组才纳入）。
IDENTITY_THEME_SPECS = [
    ("powerRoot", "identity_power_root", "所属大系", 4,
     lambda label: f"使用上级势力归属“{label}”的干员推进指令"),
    ("power", "identity_power", "所属势力", 8,
     lambda label: f"使用所属势力为“{label}”的干员推进指令"),
    ("origin", "identity_origin", "出身地", 6,
     lambda label: f"使用出身地为“{label}”的干员推进指令"),
    ("race", "identity_race", "种族", 5,
     lambda label: f"使用种族为“{label}”的干员推进指令"),
]


def identity_group_key(record, field):
    if field == "powerRoot":
        power = record.get("power") or {}
        return power.get("rootId"), power.get("rootName")
    if field == "power":
        power = record.get("power") or {}
        return power.get("id"), power.get("name")
    if field == "origin":
        if record.get("originSpecial") or not record.get("origin"):
            return None, None
        return record["origin"], record["origin"]
    if field == "race":
        if record.get("raceSpecial") or not record.get("race"):
            return None, None
        return record["race"], record["race"]
    raise ValueError(f"Unknown identity theme field: {field}")


for field, prefix, title_prefix, cap, describe in IDENTITY_THEME_SPECS:
    groups = defaultdict(set)
    group_labels = {}
    for operator_id, record in operator_by_id.items():
        key, label = identity_group_key(record, field)
        if not key or key == "none" or not label or label == "无团队":
            continue
        groups[key].add(operator_id)
        group_labels[key] = label
    candidates = []
    for key, members in groups.items():
        if len(members) < IDENTITY_THEME_MIN_MEMBERS or familiar_count(members) < IDENTITY_THEME_MIN_FAMILIAR:
            continue
        label = group_labels[key]
        candidates.append((-len(members), label, members))
    candidates.sort(key=lambda item: (item[0], item[1]))
    for _, label, members in candidates[:cap]:
        add_theme(
            f"{prefix}_{slugify(label)}",
            "identity",
            f"{title_prefix}：{label}",
            describe(label),
            members,
        )


theme_definitions = {}
themes_by_operator = {operator_id: [] for operator_id in sorted(operator_ids)}
combined_themes = [(theme_id, family, title, description, theme_members[theme_id], None)
                   for theme_id, family, title, description in theme_specs]
combined_themes.extend(extra_themes)
for theme_id, family, title, description, raw_members, art_brand in combined_themes:
    if theme_id in theme_definitions:
        raise ValueError(f"Duplicate theme id: {theme_id}")
    members = sorted(raw_members)
    if len(members) < 3:
        raise ValueError(f"Theme {theme_id} has fewer than three matching operators")
    scores = sorted((operator_by_id[operator_id]["familiarityScore"] for operator_id in members), reverse=True)
    anchor_familiarity = sum(scores[:3]) / min(3, len(scores))
    information = clamp(math.log2(len(operator_ids) / len(members)) / 5, 0, 1)
    challenge = clamp(1 - anchor_familiarity / 100, 0, 1)
    definition = {
        "id": theme_id,
        "family": family,
        "title": title,
        "description": description,
        "memberCount": len(members),
        "informationStrength": round(information, 4),
        "challengeDifficulty": round(challenge, 4),
        "members": members,
    }
    if art_brand:
        definition["artBrand"] = art_brand
    theme_definitions[theme_id] = definition
    for operator_id in members:
        themes_by_operator[operator_id].append(theme_id)

uncovered = sorted(operator_id for operator_id, theme_ids in themes_by_operator.items() if not theme_ids)
if uncovered:
    raise ValueError(f"Theme bank does not cover {len(uncovered)} operators: {uncovered[:8]}")

# 品牌皮肤立绘映射：聚合异类题库 optionArt 中“干员 × 品牌 × 立绘”三元组。
brand_art = {}
for question in anomaly_questions.get("questions") or []:
    rule = rules.get(question.get("ruleId") or "")
    if not rule or not rule["id"].startswith("visual.outfit_brand."):
        continue
    for entry in question.get("optionArt") or []:
        brand = entry.get("brand")
        operator_id = entry.get("operatorId")
        image_url = entry.get("imageUrl")
        if brand not in themed_brands or not operator_id or not image_url:
            continue
        if operator_id not in operator_ids:
            raise ValueError(f"Brand art entry references unknown operator: {operator_id}")
        previous = brand_art.setdefault(brand, {}).get(operator_id)
        if previous and previous != image_url:
            raise ValueError(
                f"Conflicting brand art for {operator_id} / {brand}: {previous} vs {image_url}"
            )
        brand_art[brand][operator_id] = image_url
for brand, urls in brand_art.items():
    missing = sorted(url for url in urls.values() if not (ROOT_PATH / "public" / url.lstrip("/")).is_file())
    if missing:
        raise ValueError(f"Brand art files are missing for {brand}: {missing[:4]}")
    members = next(
        definition["members"] for definition in theme_definitions.values()
        if definition.get("artBrand") == brand
    )
    covered = sum(1 for operator_id in members if operator_id in urls)
    print(f"brand art {brand}: {covered}/{len(members)} members covered")

theme_data = {
    "schemaVersion": 1,
    "definitions": theme_definitions,
    "byOperator": themes_by_operator,
    "manualReview": review_candidates,
}

os.makedirs(OUT_THEMES.parent, exist_ok=True)
json.dump(theme_data, open(OUT_THEMES, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
json.dump(brand_art, open(OUT_BRAND_ART, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

families = defaultdict(int)
for definition in theme_definitions.values():
    families[definition["family"]] += 1
print("themes:", len(theme_definitions), dict(sorted(families.items())))
print("themes by family:", {
    theme_id: definition["memberCount"]
    for theme_id, definition in theme_definitions.items()
})
