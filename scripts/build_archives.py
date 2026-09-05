# -*- coding: utf-8 -*-
"""Build compact server-only personnel archives from handbook_info_table.json."""

import argparse
import json
import re
from pathlib import Path

from atomic_write import atomic_write_json


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = PROJECT_ROOT / "server-data" / "operator-archives.json"


def clean_text(value):
    value = value or ""
    value = value.replace("<br>", "\n").replace("<br/>", "\n")
    value = re.sub(r"<[^>]+>", "", value)
    value = value.replace("\r\n", "\n").replace("\r", "\n")
    value = re.sub(r"[ \t]+\n", "\n", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def build(source, output):
    table = json.loads(source.read_text(encoding="utf-8"))
    archives = {}
    for operator_id, entry in table.get("handbookDict", {}).items():
        sections = []
        for section in entry.get("storyTextAudio") or []:
            parts = [clean_text(story.get("storyText")) for story in section.get("stories") or []]
            text = "\n\n".join(part for part in parts if part)
            if text:
                sections.append({
                    "title": section.get("storyTitle") or "档案资料",
                    "text": text,
                })
        if sections:
            archives[operator_id] = sections
    atomic_write_json(
        output,
        archives,
        separators=(",", ":"),
        trailing_newline=True,
    )
    print(json.dumps({"archives": len(archives), "output": str(output)}, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    build(args.source, args.output)


if __name__ == "__main__":
    main()
