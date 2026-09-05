# -*- coding: utf-8 -*-
"""Build the public operator nickname/identity search index."""

import json
import unicodedata
from pathlib import Path

from pypinyin import Style, lazy_pinyin

from atomic_write import atomic_write_json


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SOURCE_PATH = PROJECT_ROOT / "scripts" / "operator-search-aliases.json"
OPERATORS_PATH = PROJECT_ROOT / "server-data" / "operators.json"
NAMES_PATH = PROJECT_ROOT / "public" / "data" / "names.json"
OUTPUT_PATH = PROJECT_ROOT / "public" / "data" / "operator-search.json"


def load_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def normalize(value):
    normalized = unicodedata.normalize("NFKC", str(value)).lower()
    return "".join(character for character in normalized if character.isalnum())


def phonetic(value, style):
    return normalize("".join(lazy_pinyin(str(value), style=style, errors="default")))


def build_alias_record(alias):
    value = str(alias).strip()
    return {
        "v": value,
        "p": phonetic(value, Style.NORMAL),
        "i": phonetic(value, Style.FIRST_LETTER),
    }


def main():
    source = load_json(SOURCE_PATH)
    operators = load_json(OPERATORS_PATH)
    names = load_json(NAMES_PATH)
    name_records = {record["n"]: record for record in names}
    operator_names = set(operators)

    if source.get("schemaVersion") != 1:
        raise ValueError("operator search aliases must use schemaVersion 1")

    aliases = source.get("aliases") or {}
    missing_targets = sorted(set(aliases) - set(name_records))
    if missing_targets:
        raise ValueError(f"unknown alias targets: {', '.join(missing_targets)}")

    forbidden = set(source.get("forbiddenAliases") or [])
    forbidden_hits = sorted(
        {alias for values in aliases.values() for alias in values if alias in forbidden}
    )
    if forbidden_hits:
        raise ValueError(f"forbidden aliases are present: {', '.join(forbidden_hits)}")

    output_aliases = {}
    for name, values in aliases.items():
        unique_values = list(dict.fromkeys(str(value).strip() for value in values))
        if not all(unique_values):
            raise ValueError(f"empty alias for {name}")
        output_aliases[name] = [build_alias_record(value) for value in unique_values]

    groups = source.get("specialGroups") or {}
    mama_names = groups.get("mama") or []
    sarkaz_fixed = groups.get("sarkazFixed") or []
    electric_candidates = groups.get("electricCandidates") or []
    missing_group_names = sorted(
        (set(mama_names) | set(sarkaz_fixed) | set(electric_candidates))
        - set(name_records)
    )
    if missing_group_names:
        raise ValueError(f"unknown special-group operators: {', '.join(missing_group_names)}")

    sarkaz_names = [
        name for name, record in operators.items()
        if record.get("race") == "萨卡兹" and name in name_records
    ]
    sarkaz_names.sort(key=lambda name: (-int(name_records[name].get("f") or 0), name))
    non_sarkaz_fixed = [name for name in sarkaz_fixed if name not in sarkaz_names]
    if non_sarkaz_fixed:
        raise ValueError(f"fixed Sarkaz operators have another race: {', '.join(non_sarkaz_fixed)}")
    if len(sarkaz_names) < 8:
        raise ValueError("Sarkaz pool must contain at least eight operators")

    unknown_operator_names = sorted(set(name_records) - operator_names)
    if unknown_operator_names:
        raise ValueError(f"public name records missing server operators: {', '.join(unknown_operator_names[:8])}")

    allowed_query_forms = {
        normalized
        for values in aliases.values()
        for alias in values
        for normalized in (normalize(alias), phonetic(alias, Style.NORMAL))
        if normalized
    }
    blocked_queries = []
    for alias in source.get("forbiddenAliases") or []:
        literal = normalize(alias)
        blocked_queries.append(literal)
        pinyin_value = phonetic(alias, Style.NORMAL)
        if pinyin_value not in allowed_query_forms:
            blocked_queries.append(pinyin_value)

    output = {
        "schemaVersion": 1,
        "aliases": output_aliases,
        "blockedQueries": list(dict.fromkeys(query for query in blocked_queries if query)),
        "specialGroups": {
            "mama": mama_names,
            "sarkazFixed": sarkaz_fixed,
            "sarkazPool": sarkaz_names,
            "electricCandidates": electric_candidates,
        },
    }
    atomic_write_json(
        OUTPUT_PATH,
        output,
        separators=(",", ":"),
        trailing_newline=True,
    )
    print(
        f"Wrote {OUTPUT_PATH.relative_to(PROJECT_ROOT)} "
        f"({len(output_aliases)} operators, {len(sarkaz_names)} Sarkaz candidates)"
    )


if __name__ == "__main__":
    main()
