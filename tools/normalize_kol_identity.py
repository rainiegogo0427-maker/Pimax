#!/usr/bin/env python3
"""为 Pimax KRM 公海查重标准化 KOL 名称和主页链接。

用法：
    python3 tools/normalize_kol_identity.py 输入.csv 输出.csv

脚本只读取输入文件并新建输出文件，不联网、不修改输入文件。输入需包含
“账号名”与“主页链接”列；输出保留原字段，并追加“标准化名称”和
“标准化主页链接”。CSV 使用 UTF-8 with BOM，便于 Excel 直接打开。
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
import unicodedata
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit


YOUTUBE_PAGE_SUFFIXES = {
    "about",
    "community",
    "featured",
    "playlists",
    "shorts",
    "streams",
    "videos",
}


def normalize_name(value: str) -> str:
    """按 KRM 名称规则生成比较键，不覆盖原始显示名称。"""
    normalized = unicodedata.normalize("NFKC", value).strip().lstrip("@").casefold()
    return re.sub(r"[\s_-]+", "", normalized)


def _ensure_url(value: str) -> str:
    value = value.strip()
    if not value:
        return ""
    if not re.match(r"^[a-z][a-z0-9+.-]*://", value, flags=re.IGNORECASE):
        return f"https://{value}"
    return value


def normalize_profile_url(value: str) -> str:
    """把常见社交平台页面 URL 归一到稳定的主页 URL。"""
    candidate = _ensure_url(value)
    if not candidate:
        return ""

    try:
        parts = urlsplit(candidate)
    except ValueError:
        return value.strip()

    host = parts.netloc.casefold()
    if host.startswith("www."):
        host = host[4:]
    if host in {"m.youtube.com", "music.youtube.com"}:
        host = "youtube.com"
    elif host == "m.tiktok.com":
        host = "tiktok.com"

    path_parts = [segment for segment in parts.path.split("/") if segment]

    if host in {"youtube.com", "youtu.be"}:
        if host == "youtu.be":
            return ""
        if path_parts and path_parts[0].startswith("@"):
            path_parts = [path_parts[0].casefold()]
        elif len(path_parts) >= 2 and path_parts[0].casefold() in {"channel", "c", "user"}:
            path_parts = path_parts[:2]
        while path_parts and path_parts[-1].casefold() in YOUTUBE_PAGE_SUFFIXES:
            path_parts.pop()
    elif host == "tiktok.com":
        handle = next((segment for segment in path_parts if segment.startswith("@")), "")
        path_parts = [handle.casefold()] if handle else []
    elif host in {"instagram.com", "twitch.tv", "x.com", "twitter.com"}:
        if host == "twitter.com":
            host = "x.com"
        path_parts = path_parts[:1]
        if path_parts:
            path_parts[0] = path_parts[0].casefold()

    path = f"/{'/'.join(path_parts)}" if path_parts else ""
    return urlunsplit(("https", host, path, "", ""))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="标准化 CSV 中的 KOL 名称和主页链接，用于 KRM 公海查重。"
    )
    parser.add_argument("input_csv", type=Path, help="输入 CSV，读取但不修改")
    parser.add_argument("output_csv", type=Path, help="输出 CSV，必须与输入路径不同")
    parser.add_argument("--name-column", default="账号名", help="名称列，默认：账号名")
    parser.add_argument("--url-column", default="主页链接", help="链接列，默认：主页链接")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    input_path = args.input_csv.resolve()
    output_path = args.output_csv.resolve()

    if input_path == output_path:
        print("错误：输出路径不能与输入路径相同。", file=sys.stderr)
        return 2
    if not input_path.is_file():
        print(f"错误：找不到输入文件：{input_path}", file=sys.stderr)
        return 2

    with input_path.open("r", encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        if reader.fieldnames is None:
            print("错误：输入 CSV 没有表头。", file=sys.stderr)
            return 2

        missing = [
            column
            for column in (args.name_column, args.url_column)
            if column not in reader.fieldnames
        ]
        if missing:
            print(f"错误：缺少必要列：{', '.join(missing)}", file=sys.stderr)
            return 2

        rows = list(reader)
        fieldnames = list(reader.fieldnames)

    for extra_column in ("标准化名称", "标准化主页链接"):
        if extra_column not in fieldnames:
            fieldnames.append(extra_column)

    for row in rows:
        row["标准化名称"] = normalize_name(row.get(args.name_column, ""))
        row["标准化主页链接"] = normalize_profile_url(row.get(args.url_column, ""))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8-sig", newline="") as destination:
        writer = csv.DictWriter(destination, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)

    print(f"已处理 {len(rows)} 行：{input_path} -> {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
