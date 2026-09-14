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

from atomic_write import atomic_write_json
from canonical_theme_members import CANONICAL_THEME_SPECS, build_theme_members

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
BUILDER_VERSION = 7


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
    required = ("character_table.json", "skill_table.json", "skin_table.json")
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


def skin_art_url(operator_id, portrait_id):
    digest = hashlib.sha256(portrait_id.encode("utf-8")).hexdigest()[:12]
    return f"/img/operators/skins/{operator_id}_{digest}.webp"


def normalize_brand(value):
    return (value or "").split("/")[0].strip()


operators = json.loads((ROOT_PATH / "server-data" / "operators.json").read_text(encoding="utf-8"))
clues = json.loads((ROOT_PATH / "server-data" / "operator-clues.json").read_text(encoding="utf-8"))
anomaly_rules = json.loads((ROOT_PATH / "server-data" / "anomaly-rules.json").read_text(encoding="utf-8"))
identity_bank = json.loads((ROOT_PATH / "server-data" / "operator-identities.json").read_text(encoding="utf-8"))
theme_overrides = json.loads((ROOT_PATH / "scripts" / "theme-overrides.json").read_text(encoding="utf-8"))
character = json.load(open(EXCEL_ROOT / "character_table.json", encoding="utf-8"))
skills = json.load(open(EXCEL_ROOT / "skill_table.json", encoding="utf-8"))
skin_table = json.load(open(EXCEL_ROOT / "skin_table.json", encoding="utf-8"))

rules = anomaly_rules.get("definitions") or {}
operator_by_id = {record["id"]: record for record in operators.values()}
operator_ids = set(operator_by_id)
identity_by_operator = identity_bank.get("byOperator") or {}


def familiar_count(members):
    return sum(1 for operator_id in members if operator_by_id[operator_id]["familiarityScore"] >= FAMILIAR_SCORE)


theme_specs = [
    *CANONICAL_THEME_SPECS,
    ("identity_alter_family", "identity", "平行履历", "属于拥有异格形态的身份组"),
    ("identity_alter_form", "identity", "异格档案", "当前档案是一名异格干员"),
]

theme_members = {theme_id: set() for theme_id, _, _, _ in theme_specs}
theme_members.update(build_theme_members(
    operators, clues, character, skills, theme_overrides,
))

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


def add_theme(theme_id, family, title, description, members, art_brand=None, directive_goal=None, weight_boost=None):
    extra_themes.append((theme_id, family, title, description, set(members), art_brand, directive_goal, weight_boost))


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

# 形象：从皮肤源表生成品牌主题，不能依赖某条异类规则是否恰好有可出题组合。
# 每个成员使用该品牌下最新的一套付费皮肤；选取规则与异类题库 optionArt 一致。
latest_paid_skin_by_brand = defaultdict(dict)
for skin in (skin_table.get("charSkins") or {}).values():
    operator_id = skin.get("charId")
    if operator_id not in operator_ids or not skin.get("isBuySkin"):
        continue
    display = skin.get("displaySkin") or {}
    portrait_id = skin.get("portraitId") or skin.get("spPortraitId")
    brand = normalize_brand(display.get("skinGroupName"))
    if not portrait_id or not brand:
        continue
    rank = (display.get("getTime") or 0, display.get("sortId") or 0)
    previous = latest_paid_skin_by_brand[operator_id].get(brand)
    if not previous or rank > previous["rank"]:
        latest_paid_skin_by_brand[operator_id][brand] = {
            "rank": rank,
            "portraitId": portrait_id,
            "imageUrl": skin_art_url(operator_id, portrait_id),
            "skinName": display.get("skinName") or "时装",
        }

# 个别品牌按维护判断固定解锁次数：覆盖“成员 ≤25 或冷门品牌降为 1、其余 2 次”的默认规则。
BRAND_DIRECTIVE_GOALS = {"珊瑚海岸": 3}
# 个别品牌在全部主题中的出现权重乘数（不是族内权重）。
BRAND_WEIGHT_BOOSTS = {"珊瑚海岸": 3.5}
brand_groups = defaultdict(set)
for operator_id, records in latest_paid_skin_by_brand.items():
    for brand in records:
        brand_groups[brand].add(operator_id)
brand_candidates = [
    (brand, members)
    for brand, members in brand_groups.items()
    if len(members) >= BRAND_THEME_MIN_MEMBERS
    and familiar_count(members) >= BRAND_THEME_MIN_FAMILIAR
]
brand_candidates.sort(key=lambda item: (-len(item[1]), item[0]))
for brand, members in brand_candidates:
    add_theme(
        f"visual_brand_{slugify(brand)}",
        "visual",
        f"时装品牌：{brand}",
        f"使用拥有“{brand}”系列时装的干员推进指令",
        members,
        art_brand=brand,
        directive_goal=BRAND_DIRECTIVE_GOALS.get(brand),
        weight_boost=BRAND_WEIGHT_BOOSTS.get(brand),
    )

# 身份：势力大系、所属势力、出身地、种族（玩家可报出成员的头部分组才纳入）。
IDENTITY_THEME_SPECS = [
    ("powerRoot", "identity_power_root", "所属大系", 4,
     lambda label: f"使用上级势力归属“{label}”的干员推进指令"),
    ("power", "identity_power", "所属势力", 8,
     lambda label: (f"使用归属“{label}”或其下属编制的干员推进指令" if label == "罗德岛"
                    else f"使用所属势力为“{label}”的干员推进指令")),
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
        keys = [identity_group_key(record, field)]
        power = record.get("power") or {}
        if field == "power" and power.get("rootId") == "rhodes":
            # Rhodes Island includes its elite operators and subordinate teams.
            keys.append((power["rootId"], power["rootName"]))
        for key, label in keys:
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
combined_themes = [(theme_id, family, title, description, theme_members[theme_id], None, None, None)
                   for theme_id, family, title, description in theme_specs]
combined_themes.extend(extra_themes)
for theme_id, family, title, description, raw_members, art_brand, directive_goal, weight_boost in combined_themes:
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
    if directive_goal:
        definition["directiveGoal"] = directive_goal
    if weight_boost:
        definition["weightBoost"] = weight_boost
    theme_definitions[theme_id] = definition
    for operator_id in members:
        themes_by_operator[operator_id].append(theme_id)

uncovered = sorted(operator_id for operator_id, theme_ids in themes_by_operator.items() if not theme_ids)
if uncovered:
    raise ValueError(f"Theme bank does not cover {len(uncovered)} operators: {uncovered[:8]}")

# 品牌皮肤立绘映射：覆盖品牌主题的全部成员（不止异类题库引用过的那些），
# 猜测行换装与皮肤提取都以这份映射为准。
brand_art = {}
for brand, members in brand_candidates:
    records = {}
    for operator_id in sorted(members):
        record = latest_paid_skin_by_brand.get(operator_id, {}).get(brand)
        if not record:
            raise ValueError(f"Brand theme member {operator_id} has no {brand} skin record")
        records[operator_id] = {
            "imageUrl": record["imageUrl"],
            "portraitId": record["portraitId"],
            "skinName": record["skinName"],
        }
    brand_art[brand] = records
brand_art_payload = {"schemaVersion": 1, "brands": brand_art}
missing_art_files = sorted(
    record["imageUrl"]
    for records in brand_art.values()
    for record in records.values()
    if not (ROOT_PATH / "public" / record["imageUrl"].lstrip("/")).is_file()
)
if missing_art_files:
    print(
        f"brand art: {len(missing_art_files)} skin portraits not extracted yet "
        "(run scripts/extract_anomaly_skin_art.py)"
    )
for brand, records in brand_art.items():
    covered = sum(
        1 for record in records.values()
        if (ROOT_PATH / "public" / record["imageUrl"].lstrip("/")).is_file()
    )
    print(f"brand art {brand}: {covered}/{len(records)} members covered")

theme_data = {
    "schemaVersion": 1,
    "builderVersion": BUILDER_VERSION,
    "definitions": theme_definitions,
    "byOperator": themes_by_operator,
    "manualReview": review_candidates,
}

os.makedirs(OUT_THEMES.parent, exist_ok=True)
atomic_write_json(
    OUT_THEMES,
    theme_data,
    indent=2,
    trailing_newline=True,
)
atomic_write_json(
    OUT_BRAND_ART,
    brand_art_payload,
    separators=(",", ":"),
    trailing_newline=True,
)

families = defaultdict(int)
for definition in theme_definitions.values():
    families[definition["family"]] += 1
print("themes:", len(theme_definitions), dict(sorted(families.items())))
print("themes by family:", {
    theme_id: definition["memberCount"]
    for theme_id, definition in theme_definitions.items()
})
