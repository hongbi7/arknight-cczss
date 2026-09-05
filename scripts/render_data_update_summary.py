# -*- coding: utf-8 -*-
"""Render a data update report as a draft pull request description."""

import argparse
import json
from pathlib import Path


STATUS_TEXT = {
    "ready": "结构化数据和现有素材均已通过校验。",
    "asset_refresh_required": "结构化数据已更新，但需要从本地游戏客户端补齐素材。",
    "manual_review_required": "发现新分类或缺少 Logo 的势力，需要人工复核后再补素材。",
    "invalid": "生成数据存在结构错误，不应合并。",
}


def sample(values, limit=20):
    rendered = []
    for value in values[:limit]:
        if isinstance(value, dict):
            rendered.append(value.get("id") or value.get("url") or str(value))
        else:
            rendered.append(str(value))
    suffix = f" 等 {len(values)} 项" if len(values) > limit else ""
    return "、".join(rendered) + suffix


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("report", type=Path)
    args = parser.parse_args()
    report = json.loads(args.report.read_text(encoding="utf-8"))
    counts = report["counts"]
    source = report["source"]

    print("## 自动数据更新")
    print()
    print(STATUS_TEXT.get(report["status"], report["status"]))
    print()
    print(f"- 上游版本：`{source.get('revision', 'unknown')}`")
    if source.get("commitTime"):
        print(f"- 上游提交时间：`{source['commitTime']}`")
    print(f"- 可玩干员：{counts['operators']}")
    print(f"- 必需素材缺口：{counts['requiredAssetGaps']}")
    print(f"- 可选技能图标缺口：{counts['optionalSkillIconGaps']}")
    print(f"- 人工复核项：{counts['manualReviewItems']}")

    mirror = report.get("publicMirror")
    if mirror:
        print(f"- 公开素材镜像：`{mirror.get('status', 'unknown')}`")
        if mirror.get("revision"):
            print(f"- 素材镜像版本：`{mirror['revision']}`")
        print(
            "- 镜像同步结果："
            f"下载 {mirror.get('downloadedCount', 0)}，"
            f"未收录 {len(mirror.get('notFound') or [])}，"
            f"下载错误 {len(mirror.get('errors') or [])}"
        )

        if mirror.get("notFound"):
            print()
            print("### 公开镜像尚未收录")
            print()
            print(sample(mirror["notFound"]))
        if mirror.get("errors"):
            print()
            print("### 公开镜像下载错误")
            print()
            print(sample(mirror["errors"]))

    for label, values in report.get("requiredAssets", {}).items():
        if values:
            print()
            print(f"### 待补素材：{label}")
            print()
            print(sample(values))

    manual_values = [
        (label, values)
        for label, values in report.get("manualReview", {}).items()
        if values
    ]
    if manual_values:
        print()
        print("### 待人工复核")
        for label, values in manual_values:
            print(f"- {label}: {sample(values)}")

    print()
    print("### 合并前")
    print()
    print("若状态不是 `ready`，请在 Windows 本地检出本 PR 分支，运行：")
    print()
    print("```powershell")
    print("npm run update:data:local")
    print("```")
    print()
    print("提交新生成的本体素材及 `server-data/data-version.json`，确认状态变为 `ready`，再取消草稿。")
    print("完整说明见 `docs/data-update-pipeline.md`。")


if __name__ == "__main__":
    main()
