"""Canonical skill/battle theme membership derived only from source archives."""

import re


CANONICAL_THEME_SPECS = (
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
)


def gameplay_text(character_record, skills):
    values = [character_record.get("description")]
    for talent in character_record.get("talents") or []:
        for candidate in talent.get("candidates") or []:
            values.extend((candidate.get("name"), candidate.get("description")))
    for candidate in (character_record.get("trait") or {}).get("candidates") or []:
        values.append(candidate.get("overrideDescripton"))
    for skill_ref in character_record.get("skills") or []:
        levels = (skills.get(skill_ref.get("skillId")) or {}).get("levels") or []
        if levels:
            values.extend((levels[-1].get("name"), levels[-1].get("description")))
    return "\n".join(str(value) for value in values if value)


def build_theme_members(operators, clues, character, skills, overrides=None):
    """Return the stable legacy skill/battle member sets used by both builders."""
    if isinstance(operators, dict):
        operator_ids = {record["id"] for record in operators.values()}
    else:
        operator_ids = set(operators)
    result = {theme_id: set() for theme_id, _, _, _ in CANONICAL_THEME_SPECS}
    for operator_id in operator_ids:
        operator_skills = (clues.get(operator_id) or {}).get("skills") or []
        mechanics = [skill.get("mechanic") or {} for skill in operator_skills]
        if any(item.get("spRecovery") == "attack" for item in mechanics):
            result["skill_attack_recovery"].add(operator_id)
        if any(item.get("activation") == "auto" for item in mechanics):
            result["skill_auto_trigger"].add(operator_id)
        if any(item.get("activation") == "passive" for item in mechanics):
            result["skill_passive"].add(operator_id)
        if mechanics and all(item.get("activation") == "manual" for item in mechanics):
            result["skill_all_manual"].add(operator_id)
        has_manual = any(item.get("activation") == "manual" for item in mechanics)
        has_auto = any(item.get("activation") == "auto" for item in mechanics)
        if has_manual and has_auto:
            result["skill_manual_auto"].add(operator_id)
        if any(item.get("chargeable") for item in mechanics):
            result["skill_chargeable"].add(operator_id)
        if any(item.get("ammo") for item in mechanics):
            result["skill_ammo"].add(operator_id)
        if any(item.get("rangeOverridden") for item in operator_skills):
            result["skill_range_change"].add(operator_id)
        if len({item.get("rangeId") for item in operator_skills}) >= 2:
            result["skill_distinct_ranges"].add(operator_id)
        if not operator_skills:
            result["skill_none"].add(operator_id)

        record = character[operator_id]
        phases = record.get("phases") or []
        frames = phases[-1].get("attributesKeyFrames") or [] if phases else []
        respawn = (frames[-1].get("data") or {}).get("respawnTime") if frames else None
        if respawn is not None and int(respawn) <= 35:
            result["battle_fast_redeploy"].add(operator_id)
        force_keys = {"force", "p_force", "attack@force", "base_force_level"}
        has_forced_movement = any(
            str(item.get("key")) in force_keys
            for ref in record.get("skills") or []
            for level in ((skills.get(ref.get("skillId")) or {}).get("levels") or [])[-1:]
            for item in level.get("blackboard") or []
        )
        if has_forced_movement:
            result["battle_forced_movement"].add(operator_id)
        text = gameplay_text(record, skills)
        if re.search(r"元素损伤|神经损伤|侵蚀损伤|灼燃损伤|凋亡损伤", text):
            result["battle_elemental"].add(operator_id)
    # These two themes are curated directive sets; their review candidates are
    # intentionally not auto-included (the anomaly text rules cover the signal).
    overrides = overrides or {}
    for key, override in overrides.items():
        if key in result:
            included = set(override.get("include") or [])
            excluded = set(override.get("exclude") or [])
            unknown = sorted((included | excluded) - operator_ids)
            if unknown:
                raise ValueError(f"Theme override {key} contains unknown operators: {unknown}")
            result[key].update(included)
    return result
