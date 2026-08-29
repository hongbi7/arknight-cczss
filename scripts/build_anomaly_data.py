# -*- coding: utf-8 -*-
"""Build the server-only anomaly-audit rule and question banks."""

import hashlib
import json
import math
import os
import random
import re
from collections import Counter, defaultdict
from itertools import combinations
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SERVER_DATA = ROOT / "server-data"
WORK_DIR = ROOT / ".update-work"
OUT_RULES = SERVER_DATA / "anomaly-rules.json"
OUT_QUESTIONS = SERVER_DATA / "anomaly-questions.json"
OUT_REPORT = WORK_DIR / "anomaly-report.json"

DOMAIN_LABELS = {
    "roster": ("作战编制", "ROSTER REVIEW"),
    "identity": ("身份归属", "IDENTITY TRACE"),
    "skill": ("技能协议", "SKILL PROTOCOL"),
    "battle": ("战术特性", "TACTICAL TRAIT"),
    "logistics": ("后勤履历", "LOGISTICS RECORD"),
    "visual": ("形象档案", "VISUAL ARCHIVE"),
}
DIFFICULTIES = {
    "trainee": {"level": 1, "min": 60, "min_average": 60, "max_below_30": 0},
    "standard": {"level": 2, "min": 45, "min_average": 45, "max_below_30": 0},
    "hazard": {"level": 3, "min": 20, "min_average": 40, "max_below_30": 1},
}
SPECIAL_VALUES = {
    "", "未知", "未公开", "不明", "无团队", "none", "None", "null",
    "自称", "自称雌性", "断罪", "女士",
}
MIN_MEMBERS = 3
MAX_MEMBER_FRACTION = 0.60
TARGET_PER_RULE_AND_DIFFICULTY = 40
CANDIDATE_POOL_PER_RULE_AND_DIFFICULTY = 120
MIN_QUESTIONS_PER_RULE = 1
MIN_QUESTIONS_PER_DOMAIN_DIFFICULTY = 60
MAX_GENERATION_ATTEMPTS = 24000
EXHAUSTIVE_MAJORITY_LIMIT = 24
BUILDER_VERSION = 4


def find_excel_root():
    configured = os.environ.get("ARKNIGHTS_GAMEDATA_ROOT")
    candidates = []
    if configured:
        path = Path(configured)
        candidates.extend((
            path,
            path / "zh_CN" / "gamedata" / "excel",
            path / "cn" / "gamedata" / "excel",
            path / "gamedata" / "excel",
        ))
    candidates.extend((
        ROOT / ".cache" / "arknights-gamedata" / "zh_CN" / "gamedata" / "excel",
        ROOT / ".gamedata" / "zh_CN" / "gamedata" / "excel",
        ROOT / ".gamedata" / "excel",
    ))
    required = (
        "character_table.json", "handbook_info_table.json", "handbook_team_table.json",
        "skill_table.json", "gacha_table.json", "uniequip_table.json",
        "building_data.json", "skin_table.json",
    )
    for candidate in candidates:
        if all((candidate / name).is_file() for name in required):
            return candidate
    raise FileNotFoundError("Anomaly audit requires the complete GameData table set")


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def clean_text(value):
    value = value or ""
    value = re.sub(r"<[^>]+>", "", value)
    value = value.replace("\\n", "\n")
    return value


def stable_fingerprint(excel_root):
    digest = hashlib.sha256()
    for name in (
        "character_table.json", "handbook_info_table.json", "handbook_team_table.json",
        "skill_table.json", "gacha_table.json", "uniequip_table.json",
        "building_data.json", "skin_table.json",
    ):
        digest.update(name.encode("utf-8"))
        digest.update((excel_root / name).read_bytes())
    for path in (
        SERVER_DATA / "operators.json",
        SERVER_DATA / "operator-themes.json",
        SERVER_DATA / "operator-identities.json",
        ROOT / "scripts" / "anomaly-rule-overrides.json",
    ):
        digest.update(str(path.relative_to(ROOT)).replace("\\", "/").encode("utf-8"))
        digest.update(path.read_bytes())
    digest.update(f"builder-version:{BUILDER_VERSION}".encode("utf-8"))
    return "sha256:" + digest.hexdigest()


def slug(value):
    raw = str(value)
    normalized = re.sub(r"[^a-zA-Z0-9_-]+", "-", raw).strip("-").lower()
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:12]
    return f"{normalized[:48]}-{digest}" if normalized else digest


class RuleBank:
    def __init__(self, operator_ids, overrides):
        self.operator_ids = set(operator_ids)
        self.overrides = overrides.get("rules") or {}
        self.rules = []
        self.rule_ids = set()
        self.disabled = []

    def add(self, rule_id, domain, title, description, members, values, difficulty, source,
            match_label=None, allow_broad=False, option_art=None, eligible_odd_ids=None):
        members = set(members)
        override = self.overrides.get(rule_id) or {}
        included = set(override.get("include") or [])
        excluded = set(override.get("exclude") or [])
        unknown = sorted((members | included | excluded) - self.operator_ids)
        if unknown:
            raise ValueError(f"Rule {rule_id} contains unknown operators: {unknown[:8]}")
        members.update(included)
        members.difference_update(excluded)
        if rule_id in self.rule_ids:
            raise ValueError(f"Duplicate anomaly rule id: {rule_id}")
        self.rule_ids.add(rule_id)
        count = len(members)
        reason = None
        if count < MIN_MEMBERS:
            reason = "fewer_than_three_members"
        elif not allow_broad and count / len(self.operator_ids) > MAX_MEMBER_FRACTION:
            reason = "member_group_too_broad"
        if reason:
            self.disabled.append({"id": rule_id, "domain": domain, "reason": reason, "memberCount": count})
            return
        normalized_values = {
            operator_id: str(values.get(operator_id, "未知") or "未知")
            for operator_id in self.operator_ids
        }
        rule = {
            "id": rule_id,
            "domain": domain,
            "title": title,
            "description": description,
            "difficulty": difficulty,
            "memberCount": count,
            "members": sorted(members),
            "source": source,
            "matchLabel": match_label or title,
            "_memberSet": members,
            "_values": normalized_values,
        }
        if option_art:
            rule["_optionArt"] = option_art
        if eligible_odd_ids is not None:
            rule["_eligibleOddIds"] = set(eligible_odd_ids)
        self.rules.append(rule)

    def categorical(self, domain, key, label, values, difficulty, source, excluded=None):
        excluded = set(excluded or ()) | SPECIAL_VALUES
        grouped = defaultdict(set)
        for operator_id, value in values.items():
            if value is None or str(value).strip() in excluded:
                continue
            grouped[str(value).strip()].add(operator_id)
        for value, members in sorted(grouped.items()):
            self.add(
                f"{domain}.{key}.{slug(value)}", domain,
                f"{label}：{value}", f"其余三名干员的{label}均为“{value}”",
                members, values, difficulty, f"{source}:{value}", match_label=value,
            )


def highest_attributes(record):
    phases = record.get("phases") or []
    if not phases:
        return {}
    frames = phases[-1].get("attributesKeyFrames") or []
    return (frames[-1].get("data") or {}) if frames else {}


def skill_records(character_record, skill_table):
    result = []
    for skill_ref in character_record.get("skills") or []:
        skill_id = skill_ref.get("skillId")
        levels = (skill_table.get(skill_id) or {}).get("levels") or []
        if not levels:
            continue
        level = levels[-1]
        sp_data = level.get("spData") or {}
        description = clean_text(level.get("description"))
        activation_value = str(level.get("skillType"))
        recovery_value = str(sp_data.get("spType"))
        result.append({
            "id": skill_id,
            "activation": {
                "0": "passive", "PASSIVE": "passive",
                "1": "manual", "MANUAL": "manual",
                "2": "auto", "AUTO": "auto",
            }.get(activation_value, "unknown"),
            "spRecovery": {
                "1": "time", "INCREASE_WITH_TIME": "time",
                "2": "attack", "INCREASE_WHEN_ATTACK": "attack",
                "4": "damaged", "INCREASE_WHEN_TAKEN_DAMAGE": "damaged",
                "8": "none",
            }.get(recovery_value, "unknown"),
            "description": description,
            "rangeChanged": bool(level.get("rangeId")),
            "chargeable": (sp_data.get("maxChargeTime") or 1) > 1,
            "ammo": "弹药" in description,
        })
    return result


def gameplay_text(character_record, operator_skills):
    parts = [character_record.get("description") or ""]
    trait = character_record.get("trait") or {}
    for candidate in trait.get("candidates") or []:
        parts.append(candidate.get("overrideDescripton") or "")
    for talent in character_record.get("talents") or []:
        for candidate in talent.get("candidates") or []:
            parts.append(candidate.get("description") or "")
    parts.extend(skill["description"] for skill in operator_skills)
    return clean_text("\n".join(parts))


def normalize_brand(value):
    return (value or "").split("/")[0].strip()


def skin_art_url(operator_id, portrait_id):
    digest = hashlib.sha256(portrait_id.encode("utf-8")).hexdigest()[:12]
    return f"/img/operators/skins/{operator_id}_{digest}.webp"


def parse_recruit_names(detail, operator_names):
    plain = clean_text(detail)
    if "※全部可能出现的干员※" in plain:
        plain = plain.split("※全部可能出现的干员※", 1)[1]
    names = set()
    for token in re.split(r"[/\n-]+", plain):
        candidate = token.strip().strip("★").strip()
        if candidate in operator_names:
            names.add(candidate)
    return names


def build_rules(excel_root, operators, themes, identities, overrides):
    character = load_json(excel_root / "character_table.json")
    handbook = load_json(excel_root / "handbook_info_table.json").get("handbookDict") or {}
    powers = load_json(excel_root / "handbook_team_table.json")
    skill_table = load_json(excel_root / "skill_table.json")
    gacha = load_json(excel_root / "gacha_table.json")
    uniequip = load_json(excel_root / "uniequip_table.json")
    building = load_json(excel_root / "building_data.json")
    skin_table = load_json(excel_root / "skin_table.json")
    operator_by_id = {record["id"]: record for record in operators.values()}
    operator_ids = set(operator_by_id)
    name_to_id = {record["name"]: record["id"] for record in operator_by_id.values()}
    bank = RuleBank(operator_ids, overrides)

    # 作战编制：明确不读取星级和标签。
    bank.categorical("roster", "profession", "主职业", {
        oid: operator_by_id[oid].get("professionText") for oid in operator_ids
    }, 1, "operators.profession")
    bank.categorical("roster", "subprofession", "子职业", {
        oid: operator_by_id[oid].get("subProfessionText") for oid in operator_ids
    }, 2, "operators.subProfession")
    bank.categorical("roster", "position", "部署站位", {
        oid: "远程位" if operator_by_id[oid].get("position") == "RANGED" else "近战位"
        for oid in operator_ids
    }, 1, "operators.position")

    # 身份归属。
    bank.categorical("identity", "power", "所属势力", {
        oid: (operator_by_id[oid].get("power") or {}).get("name") for oid in operator_ids
    }, 1, "operators.power")
    bank.categorical("identity", "power_root", "上级势力", {
        oid: (operator_by_id[oid].get("power") or {}).get("rootName") for oid in operator_ids
    }, 1, "operators.power.root")
    bank.categorical("identity", "origin", "出身地", {
        oid: operator_by_id[oid].get("origin") for oid in operator_ids
    }, 2, "operators.origin")
    bank.categorical("identity", "race", "种族", {
        oid: operator_by_id[oid].get("race") for oid in operator_ids
    }, 2, "operators.race")
    secondary_values = {}
    secondary_groups = defaultdict(set)
    for oid in operator_ids:
        names = []
        for power in (character.get(oid) or {}).get("subPower") or []:
            power_id = power.get("teamId") or power.get("groupId") or power.get("nationId")
            name = (powers.get(power_id) or {}).get("powerName")
            if name:
                names.append(name)
                secondary_groups[name].add(oid)
        secondary_values[oid] = "、".join(sorted(set(names))) or "无次级归属"
    for value, members in sorted(secondary_groups.items()):
        bank.add(
            f"identity.secondary_power.{slug(value)}", "identity",
            f"次级归属：{value}", f"其余三名干员均记录有“{value}”次级归属",
            members, secondary_values, 3, f"character.subPower:{value}", match_label=value,
        )
    identity_by_operator = identities.get("byOperator") or {}
    family_members = set(identity_by_operator)
    alter_members = {
        oid for oid, value in identity_by_operator.items() if value.get("role") == "alter"
    }
    family_values = {oid: "拥有异格身份" if oid in family_members else "无异格身份" for oid in operator_ids}
    alter_values = {oid: "异格干员" if oid in alter_members else "非异格干员" for oid in operator_ids}
    bank.add("identity.alter_family", "identity", "平行履历", "其余三名干员均拥有异格身份",
             family_members, family_values, 1, "operator-identities", "拥有异格身份")
    bank.add("identity.alter_form", "identity", "异格档案", "其余三名干员当前均为异格形态",
             alter_members, alter_values, 1, "operator-identities", "异格干员")

    # 技能协议：复用 V3 主题并补齐受击回复与技能数量。
    for definition in (themes.get("definitions") or {}).values():
        if definition.get("family") != "skill":
            continue
        member_set = set(definition.get("members") or [])
        values = {
            oid: definition["title"] if oid in member_set else "不符合该技能协议"
            for oid in operator_ids
        }
        difficulty = 1
        bank.add(
            f"skill.{definition['id']}", "skill", definition["title"], definition["description"],
            member_set, values, difficulty, f"operator-themes:{definition['id']}", definition["title"],
        )

    parsed_skills = {
        oid: skill_records(character.get(oid) or {}, skill_table) for oid in operator_ids
    }
    damaged_members = {
        oid for oid, records in parsed_skills.items()
        if any(record["spRecovery"] == "damaged" for record in records)
    }
    damaged_values = {
        oid: "拥有受击回复技能" if oid in damaged_members else "无受击回复技能" for oid in operator_ids
    }
    bank.add("skill.damaged_recovery", "skill", "受击蓄能", "其余三名干员至少一个技能采用受击回复",
             damaged_members, damaged_values, 2, "skill.spData.spType", "受击回复")
    skill_count_values = {oid: len(parsed_skills[oid]) for oid in operator_ids}
    for count in (1, 2, 3):
        members = {oid for oid, value in skill_count_values.items() if value == count}
        rendered = {oid: f"{value} 个常规技能" for oid, value in skill_count_values.items()}
        bank.add(f"skill.count.{count}", "skill", f"{count} 技档案",
                 f"其余三名干员均拥有 {count} 个常规技能", members, rendered,
                 1 if count == 1 else 2, "character.skills", f"{count} 个常规技能")

    # 战术特性：五条 V3 规则加十二条文本候选规则，支持人工覆盖。
    for definition in (themes.get("definitions") or {}).values():
        if definition.get("family") != "battle":
            continue
        member_set = set(definition.get("members") or [])
        values = {
            oid: definition["title"] if oid in member_set else "不具备该战术特性"
            for oid in operator_ids
        }
        bank.add(
            f"battle.{definition['id']}", "battle", definition["title"], definition["description"],
            member_set, values, 1,
            f"operator-themes:{definition['id']}", definition["title"],
        )
    gameplay = {
        oid: gameplay_text(character.get(oid) or {}, parsed_skills[oid]) for oid in operator_ids
    }
    text_specs = (
        ("summon", "战术召唤", "能够部署或召唤额外作战单位", r"召唤物|召唤一个|召唤.*单位|战术装备", 1),
        ("ally_heal", "友方治疗", "能够主动治疗或恢复友方单位生命", r"治疗友方|友方单位.{0,16}(?:恢复|回复).{0,8}生命|恢复.{0,12}友方.{0,8}生命", 1),
        ("true_damage", "真实损伤", "能够造成真实伤害", r"真实伤害", 1),
        ("aerial", "对空响应", "能力文本明确可以攻击或优先攻击空中单位", r"(?:可以|能够|优先)攻击空中单位", 1),
        ("silence", "静默干预", "能够使目标沉默", r"沉默", 1),
        ("stun", "晕眩干预", "能够使目标晕眩", r"晕眩", 1),
        ("sleep", "沉睡干预", "能够使目标进入沉睡", r"沉睡", 1),
        ("cold_frozen", "低温干预", "能够施加寒冷或冻结", r"寒冷|冻结", 1),
        ("bind", "束缚干预", "能够使目标束缚", r"束缚", 1),
        ("barrier", "屏障构筑", "能够提供护盾或屏障", r"护盾|屏障", 1),
        ("undying", "生存锁定", "能够获得无敌、不死或生命值锁定效果", r"无敌|不死|生命值不会低于", 1),
        ("self_cost", "生命代价", "技能或能力会主动消耗自身生命", r"(?:损失|消耗).{0,10}自身.{0,6}生命|自身.{0,10}(?:损失|消耗).{0,6}生命", 1),
    )
    for key, title, description, pattern, difficulty in text_specs:
        members = {oid for oid, text in gameplay.items() if re.search(pattern, text)}
        values = {oid: title if oid in members else "未记录该战术特性" for oid in operator_ids}
        bank.add(f"battle.{key}", "battle", title, description, members, values,
                 difficulty, f"gameplay-text:{pattern}", title)

    # 后勤履历。
    approach_values = {
        oid: (character.get(oid) or {}).get("itemObtainApproach") or "未知" for oid in operator_ids
    }
    for approach in ("活动获得", "凭证交易所", "集成战略获得", "信用交易所"):
        members = {oid for oid, value in approach_values.items() if value == approach}
        bank.add(f"logistics.obtain.{slug(approach)}", "logistics", f"获取方式：{approach}",
                 f"其余三名干员均通过“{approach}”获得", members, approach_values,
                 1 if approach == "活动获得" else 2, "character.itemObtainApproach", approach)
    limited_members = {oid for oid in operator_ids if (handbook.get(oid) or {}).get("isLimited")}
    limited_values = {oid: "限定干员" if oid in limited_members else "非限定干员" for oid in operator_ids}
    bank.add("logistics.limited", "logistics", "限定寻访", "其余三名干员均为限定干员",
             limited_members, limited_values, 1, "handbook.isLimited", "限定干员")
    recruit_names = parse_recruit_names(gacha.get("recruitDetail") or "", set(name_to_id))
    recruit_members = {name_to_id[name] for name in recruit_names}
    recruit_values = {oid: "公开招募可得" if oid in recruit_members else "公开招募不可得" for oid in operator_ids}
    bank.add("logistics.public_recruit", "logistics", "公开招募", "其余三名干员均可通过公开招募获得",
             recruit_members, recruit_values, 1, "gacha.recruitDetail", "公开招募可得")
    activity_members = {
        oid for oid in operator_ids if (character.get(oid) or {}).get("canUseActivityPotentialItem")
    }
    activity_values = {oid: "使用活动信物" if oid in activity_members else "不使用活动信物" for oid in operator_ids}
    bank.add("logistics.activity_potential", "logistics", "活动信物", "其余三名干员均使用活动专属信物提升潜能",
             activity_members, activity_values, 1, "character.canUseActivityPotentialItem", "活动信物")
    room_groups = defaultdict(set)
    room_values = {}
    room_labels = {
        "CONTROL": "控制中枢", "MANUFACTURE": "制造站", "TRADING": "贸易站",
        "DORMITORY": "宿舍", "MEETING": "会客室", "HIRE": "人力办公室",
        "TRAINING": "训练室", "WORKSHOP": "加工站", "POWER": "发电站",
    }
    for oid in operator_ids:
        rooms = set()
        for slot in ((building.get("chars") or {}).get(oid) or {}).get("buffChar") or []:
            for buff_data in slot.get("buffData") or []:
                room = ((building.get("buffs") or {}).get(buff_data.get("buffId")) or {}).get("roomType")
                if room in room_labels:
                    rooms.add(room_labels[room])
                    room_groups[room_labels[room]].add(oid)
        room_values[oid] = "、".join(sorted(rooms)) or "无基建技能"
    for room, members in sorted(room_groups.items()):
        bank.add(f"logistics.base_room.{slug(room)}", "logistics", f"基建房间：{room}",
                 f"其余三名干员均拥有适用于{room}的基建技能", members, room_values,
                 1, "building.buffs.roomType", room)

    # 形象档案：不读取 charword/CV 数据。
    skin_rows = [skin for skin in (skin_table.get("charSkins") or {}).values()
                 if skin.get("charId") in operator_ids]
    skins_by_operator = defaultdict(list)
    for skin in skin_rows:
        skins_by_operator[skin["charId"]].append(skin)
    paid_skin_by_operator_brand = defaultdict(dict)
    latest_paid_skin = {}
    for skin in skin_rows:
        if not skin.get("isBuySkin"):
            continue
        display = skin.get("displaySkin") or {}
        portrait_id = skin.get("portraitId") or skin.get("spPortraitId")
        brand = normalize_brand(display.get("skinGroupName"))
        if not portrait_id or not brand:
            continue
        rank = (display.get("getTime") or 0, display.get("sortId") or 0)
        record = {
            "portraitId": portrait_id,
            "imageUrl": skin_art_url(skin["charId"], portrait_id),
            "skinName": display.get("skinName") or "时装",
            "skinGroup": display.get("skinGroupName") or brand,
            "brand": brand,
            "rank": rank,
        }
        previous = paid_skin_by_operator_brand[skin["charId"]].get(brand)
        if not previous or rank > previous["rank"]:
            paid_skin_by_operator_brand[skin["charId"]][brand] = record
        previous = latest_paid_skin.get(skin["charId"])
        if not previous or rank > previous["rank"]:
            latest_paid_skin[skin["charId"]] = record
    illustrator_values = {}
    illustrator_groups = defaultdict(set)
    for oid in operator_ids:
        default_skins = [skin for skin in skins_by_operator[oid] if not skin.get("isBuySkin")]
        drawers = set()
        for skin in default_skins:
            drawers.update((skin.get("displaySkin") or {}).get("drawerList") or [])
        illustrator_values[oid] = "、".join(sorted(drawers)) or "未知画师"
        for drawer in drawers:
            illustrator_groups[drawer].add(oid)
    for drawer, members in sorted(illustrator_groups.items()):
        bank.add(f"visual.illustrator.{slug(drawer)}", "visual", f"默认画师：{drawer}",
                 f"其余三名干员的默认立绘画师均包含“{drawer}”", members, illustrator_values,
                 1, "skin.displaySkin.drawerList", drawer)
    dynamic_members = {
        oid for oid in operator_ids
        if any(skin.get("dynIllustId") or skin.get("spDynIllustId") for skin in skins_by_operator[oid])
    }
    dynamic_values = {oid: "拥有动态服装" if oid in dynamic_members else "无动态服装" for oid in operator_ids}
    bank.add("visual.dynamic_outfit", "visual", "动态服装", "其余三名干员均拥有动态服装",
             dynamic_members, dynamic_values, 1, "skin.dynIllustId", "拥有动态服装")
    brand_groups = defaultdict(set)
    brand_values = {}
    for oid in operator_ids:
        brands = set(paid_skin_by_operator_brand[oid])
        brand_values[oid] = "、".join(sorted(brands)) or "无付费服装品牌"
        for brand in brands:
            brand_groups[brand].add(oid)
    for brand, members in sorted(brand_groups.items()):
        option_art = {}
        for oid in operator_ids:
            skin = paid_skin_by_operator_brand[oid].get(brand) if oid in members else latest_paid_skin.get(oid)
            if not skin:
                continue
            option_art[oid] = {
                key: value for key, value in skin.items() if key != "rank"
            }
        bank.add(f"visual.outfit_brand.{slug(brand)}", "visual", f"服装品牌：{brand}",
                 f"其余三名干员均拥有“{brand}”品牌服装", members, brand_values,
                 1, "skin.displaySkin.skinGroupName", brand,
                 option_art=option_art, eligible_odd_ids=option_art)

    return bank, operator_by_id


def build_domain_audit(rules, operator_ids):
    rule_ids = [rule["id"] for rule in rules]
    all_bits = (1 << len(rules)) - 1
    operator_masks = {}
    for operator_id in operator_ids:
        mask = 0
        for index, rule in enumerate(rules):
            if operator_id in rule["_memberSet"]:
                mask |= 1 << index
        operator_masks[operator_id] = mask
    return {"ruleIds": rule_ids, "allBits": all_bits, "operatorMasks": operator_masks}


def tuple_odd_indexes(option_ids, audit, include_inverse=True):
    masks = [audit["operatorMasks"][operator_id] for operator_id in option_ids]
    all_bits = audit["allBits"]
    odd_indexes = set()
    supporting_bits = 0
    for index in range(4):
        others = [masks[other] for other in range(4) if other != index]
        majority_true = others[0] & others[1] & others[2] & ~masks[index] & all_bits
        majority_false = ~others[0] & ~others[1] & ~others[2] & masks[index] & all_bits
        if majority_true or (include_inverse and majority_false):
            odd_indexes.add(index)
        if index == 3:
            supporting_bits = majority_true
    supporting = [
        rule_id for index, rule_id in enumerate(audit["ruleIds"])
        if supporting_bits & (1 << index)
    ]
    return odd_indexes, supporting


def protected_facet_collisions(option_ids, operator_by_id):
    """Return salient 3:1 shortcuts that are intentionally not playable rules."""
    collisions = []
    rarity_counts = Counter(operator_by_id[oid].get("rarity") for oid in option_ids)
    if sorted(rarity_counts.values()) == [1, 3]:
        collisions.append("roster.rarity")
    return collisions


def candidate_option_ids(inside, outside, rng):
    """Yield deterministic candidates, enumerating small rule groups without replacement."""
    yielded = 0
    if len(inside) <= EXHAUSTIVE_MAJORITY_LIMIT:
        majorities = list(combinations(inside, 3))
        rng.shuffle(majorities)
        for majority in majorities:
            odd_candidates = outside[:]
            rng.shuffle(odd_candidates)
            for odd in odd_candidates:
                yield [*majority, odd]
                yielded += 1
                if yielded >= MAX_GENERATION_ATTEMPTS:
                    return
        return

    while yielded < MAX_GENERATION_ATTEMPTS:
        yield rng.sample(inside, 3) + [rng.choice(outside)]
        yielded += 1


def meets_difficulty(option_ids, operator_by_id, difficulty):
    config = DIFFICULTIES[difficulty]
    scores = [operator_by_id[oid].get("familiarityScore", 0) for oid in option_ids]
    return (
        min(scores) >= config["min"]
        and sum(scores) / len(scores) >= config["min_average"]
        and sum(score < 30 for score in scores) <= config["max_below_30"]
    )


def meets_rule_constraints(rule, option_ids, operator_by_id):
    """Keep a subprofession question inside one main-profession cohort."""
    if not rule["id"].startswith("roster.subprofession."):
        return True
    professions = {
        operator_by_id[operator_id].get("profession")
        for operator_id in option_ids
    }
    return len(professions) == 1 and None not in professions


def distractor_score(option_ids, operator_by_id):
    records = [operator_by_id[oid] for oid in option_ids]
    score = min(record.get("familiarityScore", 0) for record in records) * 4
    score -= max(record.get("familiarityScore", 0) for record in records) - min(
        record.get("familiarityScore", 0) for record in records
    )
    for key in ("profession", "position", "rarity"):
        frequency = Counter(record.get(key) for record in records)
        distribution = sorted(frequency.values(), reverse=True)
        score += {
            (4,): 48,
            (2, 2): 36,
            (2, 1, 1): 24,
            (1, 1, 1, 1): 12,
            (3, 1): -48,
        }.get(tuple(distribution), 0)
    return score


def select_diverse_questions(candidates, limit):
    """Prefer familiar distractors while spreading repeated operators across the bank."""
    remaining = list(candidates)
    selected = []
    operator_usage = Counter()
    while remaining and len(selected) < limit:
        question = min(
            remaining,
            key=lambda item: (
                max(operator_usage[oid] for oid in item["majorityIds"] + [item["oddId"]]),
                sum(operator_usage[oid] for oid in item["majorityIds"] + [item["oddId"]]),
                -item["distractorScore"],
                item["id"],
            ),
        )
        remaining.remove(question)
        selected.append(question)
        for operator_id in question["majorityIds"] + [question["oddId"]]:
            operator_usage[operator_id] += 1
    return selected


def make_question(rule, option_ids, difficulty, supporting, operator_by_id, fingerprint):
    odd_id = option_ids[3]
    evidence = [{
        "operatorId": oid,
        "match": oid in rule["_memberSet"],
        "value": rule["_values"].get(oid, "未知"),
    } for oid in option_ids]
    identity = "|".join((fingerprint, rule["id"], *sorted(option_ids[:3]), odd_id, difficulty))
    question = {
        "id": hashlib.sha256(identity.encode("utf-8")).hexdigest()[:20],
        "domain": rule["domain"],
        "difficulty": difficulty,
        "ruleId": rule["id"],
        "majorityIds": sorted(option_ids[:3]),
        "oddId": odd_id,
        "supportingRuleIds": sorted(rule_id for rule_id in supporting if rule_id != rule["id"])[:2],
        "evidence": evidence,
        "familiarityMin": min(operator_by_id[oid].get("familiarityScore", 0) for oid in option_ids),
        "familiarityAverage": round(sum(operator_by_id[oid].get("familiarityScore", 0) for oid in option_ids) / 4, 2),
        "distractorScore": distractor_score(option_ids, operator_by_id),
    }
    if rule.get("_optionArt"):
        question["optionArt"] = [
            {"operatorId": oid, **rule["_optionArt"][oid]}
            for oid in option_ids
        ]
    return question


def generate_questions(bank, operator_by_id, fingerprint):
    rules_by_domain = defaultdict(list)
    for rule in bank.rules:
        rules_by_domain[rule["domain"]].append(rule)
    operator_ids = sorted(operator_by_id)
    audits = {
        domain: build_domain_audit(rules, operator_ids)
        for domain, rules in rules_by_domain.items()
    }
    global_audit = build_domain_audit(bank.rules, operator_ids)
    seed = int(hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()[:16], 16)
    rng = random.Random(seed)
    questions = []
    rule_question_counts = Counter()
    generation_failures = []
    collision_rejections_by_facet = Counter()
    collision_rejections_by_rule = Counter()

    for rule in bank.rules:
        domain_rules = rules_by_domain[rule["domain"]]
        for difficulty, config in DIFFICULTIES.items():
            if rule["difficulty"] > config["level"]:
                continue
            eligible = [oid for oid in operator_ids if operator_by_id[oid].get("familiarityScore", 0) >= config["min"]]
            inside = [oid for oid in eligible if oid in rule["_memberSet"]]
            outside = [oid for oid in eligible if oid not in rule["_memberSet"]]
            if rule.get("_eligibleOddIds") is not None:
                outside = [oid for oid in outside if oid in rule["_eligibleOddIds"]]
            if len(inside) < 3 or not outside:
                continue
            found = {}
            attempts = 0
            for option_ids in candidate_option_ids(inside, outside, rng):
                attempts += 1
                majority = option_ids[:3]
                odd = option_ids[3]
                if not meets_rule_constraints(rule, option_ids, operator_by_id):
                    continue
                if not meets_difficulty(option_ids, operator_by_id, difficulty):
                    continue
                protected_collisions = protected_facet_collisions(option_ids, operator_by_id)
                if protected_collisions:
                    collision_rejections_by_rule[rule["id"]] += 1
                    collision_rejections_by_facet.update(protected_collisions)
                    continue
                odd_indexes, supporting = tuple_odd_indexes(option_ids, audits[rule["domain"]])
                if odd_indexes != {3}:
                    collision_rejections_by_rule[rule["id"]] += 1
                    collision_rejections_by_facet["same_domain_rule"] += 1
                    continue
                global_odd_indexes, _ = tuple_odd_indexes(
                    option_ids, global_audit, include_inverse=False
                )
                if global_odd_indexes != {3}:
                    collision_rejections_by_rule[rule["id"]] += 1
                    collision_rejections_by_facet["cross_domain_rule"] += 1
                    continue
                key = (tuple(sorted(majority)), odd)
                question = make_question(rule, option_ids, difficulty, supporting, operator_by_id, fingerprint)
                previous = found.get(key)
                if not previous or question["distractorScore"] > previous["distractorScore"]:
                    found[key] = question
                if len(found) >= CANDIDATE_POOL_PER_RULE_AND_DIFFICULTY:
                    break
            selected = select_diverse_questions(
                found.values(), TARGET_PER_RULE_AND_DIFFICULTY
            )
            questions.extend(selected)
            rule_question_counts[rule["id"]] += len(selected)
            if not selected:
                generation_failures.append({
                    "ruleId": rule["id"], "difficulty": difficulty,
                    "reason": "no_unambiguous_question", "attempts": attempts,
                })

    disabled_rule_ids = {
        rule["id"] for rule in bank.rules if rule_question_counts[rule["id"]] < MIN_QUESTIONS_PER_RULE
    }
    for rule_id in sorted(disabled_rule_ids):
        rule = next(rule for rule in bank.rules if rule["id"] == rule_id)
        bank.disabled.append({
            "id": rule_id, "domain": rule["domain"], "reason": "insufficient_unambiguous_questions",
            "questionCount": rule_question_counts[rule_id],
        })
    bank.rules = [rule for rule in bank.rules if rule["id"] not in disabled_rule_ids]
    questions = [question for question in questions if question["ruleId"] not in disabled_rule_ids]
    valid_rule_ids = {rule["id"] for rule in bank.rules}
    for question in questions:
        question["supportingRuleIds"] = [
            rule_id for rule_id in question["supportingRuleIds"] if rule_id in valid_rule_ids
        ]
    collision_report = {
        "total": sum(collision_rejections_by_facet.values()),
        "byFacet": dict(sorted(collision_rejections_by_facet.items())),
        "byTargetRule": dict(sorted(collision_rejections_by_rule.items())),
    }
    return questions, rule_question_counts, generation_failures, collision_report


def public_rule(rule):
    return {key: value for key, value in rule.items() if not key.startswith("_")}


def main():
    excel_root = find_excel_root()
    operators = load_json(SERVER_DATA / "operators.json")
    themes = load_json(SERVER_DATA / "operator-themes.json")
    identities = load_json(SERVER_DATA / "operator-identities.json")
    overrides = load_json(ROOT / "scripts" / "anomaly-rule-overrides.json")
    fingerprint = stable_fingerprint(excel_root)
    bank, operator_by_id = build_rules(excel_root, operators, themes, identities, overrides)
    questions, rule_question_counts, generation_failures, collision_report = generate_questions(
        bank, operator_by_id, fingerprint
    )

    counts_by_domain = Counter(rule["domain"] for rule in bank.rules)
    counts_by_bucket = Counter((question["domain"], question["difficulty"]) for question in questions)
    insufficient_buckets = [
        {"domain": domain, "difficulty": difficulty, "count": counts_by_bucket[(domain, difficulty)]}
        for domain in DOMAIN_LABELS for difficulty in DIFFICULTIES
        if counts_by_bucket[(domain, difficulty)] < MIN_QUESTIONS_PER_DOMAIN_DIFFICULTY
    ]
    if insufficient_buckets:
        raise ValueError(f"Anomaly question bank has insufficient coverage: {insufficient_buckets}")

    rule_output = {
        "schemaVersion": 1,
        "sourceFingerprint": fingerprint,
        "domains": {
            domain: {"id": domain, "label": labels[0], "labelEn": labels[1]}
            for domain, labels in DOMAIN_LABELS.items()
        },
        "difficulties": DIFFICULTIES,
        "definitions": {rule["id"]: public_rule(rule) for rule in bank.rules},
    }
    question_output = {
        "schemaVersion": 1,
        "sourceFingerprint": fingerprint,
        "questions": sorted(questions, key=lambda item: item["id"]),
    }
    report = {
        "schemaVersion": 1,
        "sourceFingerprint": fingerprint,
        "rules": len(bank.rules),
        "questions": len(questions),
        "rulesByDomain": dict(sorted(counts_by_domain.items())),
        "questionsByDomainDifficulty": {
            f"{domain}:{difficulty}": counts_by_bucket[(domain, difficulty)]
            for domain in DOMAIN_LABELS for difficulty in DIFFICULTIES
        },
        "disabledRules": sorted(bank.disabled, key=lambda item: (item.get("domain", ""), item["id"])),
        "generationFailures": generation_failures,
        "collisionRejections": collision_report,
    }
    write_json(OUT_RULES, rule_output)
    write_json(OUT_QUESTIONS, question_output)
    write_json(OUT_REPORT, report)
    print(json.dumps({
        "rules": len(bank.rules), "questions": len(questions),
        "rulesByDomain": report["rulesByDomain"],
        "questionsByDomainDifficulty": report["questionsByDomainDifficulty"],
        "disabledRules": len(bank.disabled),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
