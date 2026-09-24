"""从用户提供的跟进表生成仅供本机工作台使用的脱敏数据。

用法（由助理执行）：python3 prepare_private_data.py 跟进表.xlsx 候选名单.csv [KRM粘贴文本.txt]
只读取源文件；仅提取公开账号、地区和业务阶段。输出 local-data.js，
绝不包含联系方式、邮件原文、私人地址或其他表格列。
"""

import csv
import hashlib
import json
import re
import sys
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile


NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
EUROPE = {
    "德国", "英国", "法国", "意大利", "西班牙", "波兰", "荷兰", "比利时", "奥地利",
    "瑞士", "挪威", "瑞典", "丹麦", "芬兰", "冰岛", "爱尔兰", "葡萄牙", "希腊",
    "斯洛伐克", "捷克", "匈牙利", "罗马尼亚", "保加利亚", "克罗地亚", "斯洛文尼亚",
    "塞尔维亚", "爱沙尼亚", "拉脱维亚", "立陶宛", "卢森堡", "马耳他", "塞浦路斯",
}


def text(value):
    return str(value or "").strip()


def identity(value):
    return re.sub(r"[\s_@-]", "", text(value).casefold())


def sheet_rows(archive, path, strings, allowed):
    root = ET.fromstring(archive.read(path))
    for row in root.findall("m:sheetData/m:row", NS):
        result = {}
        for cell in row.findall("m:c", NS):
            column = re.match(r"[A-Z]+", cell.attrib.get("r", ""))
            if not column or column.group() not in allowed:
                continue
            value = cell.find("m:v", NS)
            inline = cell.find("m:is", NS)
            raw = value.text if value is not None else "".join(inline.itertext()) if inline is not None else ""
            if cell.attrib.get("t") == "s" and raw:
                raw = strings[int(raw)]
            result[column.group()] = text(raw)
        if result:
            yield result


def workbook_sheets(archive):
    strings = []
    if "xl/sharedStrings.xml" in archive.namelist():
        shared = ET.fromstring(archive.read("xl/sharedStrings.xml"))
        strings = ["".join(item.itertext()) for item in shared.findall("m:si", NS)]
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    relations = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    paths = {item.attrib["Id"]: item.attrib["Target"] for item in relations}
    for sheet in workbook.findall("m:sheets/m:sheet", NS):
        target = paths[sheet.attrib[f"{{{REL_NS}}}id"]].lstrip("/")
        yield sheet.attrib["name"], target if target.startswith("xl/") else f"xl/{target}", strings


def make_task(task_id, title, category, task_type, person, next_step, flow, evidence, need="", suggested=False, krm_stage=""):
    return {
        "id": task_id,
        "title": title,
        "category": category,
        "type": task_type,
        "priority": "high" if suggested else "medium",
        "due": "",
        "person": person,
        "next": next_step,
        "source": task_id.split(":", 1)[0],
        "flow": flow,
        "evidence": evidence,
        "need": need,
        "suggested": suggested,
        "krmStage": krm_stage,
    }


def krm_paste_rows(path):
    lines = path.read_text(encoding="utf-8-sig").splitlines()
    required = {"序号", "KOL名称", "沟通进度", "上一次沟通时间", "国家/地区", "跟进人", "创建时间", "操作"}
    if not required.issubset(lines[:80]):
        raise ValueError("KRM 粘贴文本缺少必要表头")
    start = lines.index("操作") + 1
    anchors = [i for i in range(start, len(lines) - 2) if lines[i].isdigit() and lines[i + 2] == "KOL"]
    if not anchors or [int(lines[i]) for i in anchors] != list(range(1, len(anchors) + 1)):
        raise ValueError("KRM 粘贴文本行号不连续，无法可靠拆分")
    for index, anchor in enumerate(anchors):
        values = lines[anchor + 1:anchors[index + 1] if index + 1 < len(anchors) else len(lines)]
        if len(values) < 16 or not re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}", values[-1]):
            raise ValueError(f"KRM 第 {index + 1} 行结构不完整")
        yield values


def krm_tasks(path, existing_names):
    tasks = []
    counts = {"krm_rows": 0, "krm_europe": 0, "krm_outside_or_unknown": 0,
              "krm_duplicates": 0, "krm_unsupported_stage": 0}
    for row in krm_paste_rows(path):
        counts["krm_rows"] += 1
        name = text(row[0])
        link_index = next((i for i, value in enumerate(row) if value.startswith("https://")), None)
        if not name or link_index is None or row[5] != "未建联" or row[4] != "1.1尚未触达":
            counts["krm_unsupported_stage"] += 1
            continue
        countries = [value for value in row[link_index + 1:-3] if value in EUROPE]
        if len(countries) != 1:
            counts["krm_outside_or_unknown"] += 1
            continue
        counts["krm_europe"] += 1
        key = identity(name)
        if key in existing_names:
            counts["krm_duplicates"] += 1
            continue
        existing_names.add(key)
        country = countries[0]
        tasks.append(make_task(
            f"krm:{key}", f"触达 {name}", "future", "KOL 触达", name,
            "先核实主页和当前线索归属，再按内容语言准备首触；补录 KRM 认领日期后显示流转倒计时。",
            "uncontacted", f"KRM 复制文本 · {country} · 尚未触达 · 未建联",
            krm_stage="unconnected"))
    return tasks, counts


def build(workbook_path, candidates_path, krm_paste_path=None):
    tasks = []
    counts = {"workbook_rows": 0, "outside_europe_or_unknown": 0, "do_not_contact": 0, "candidate_duplicates": 0}
    contacted = set()
    with ZipFile(workbook_path) as archive:
        for name, path, strings in workbook_sheets(archive):
            if "KOL 触达记录" in name:
                rows = list(sheet_rows(archive, path, strings, {"A", "B", "H", "I", "J", "K", "L"}))[1:]
                counts["workbook_rows"] = len(rows)
                for row in rows:
                    person, country = text(row.get("A")), text(row.get("B"))
                    if not person:
                        continue
                    contacted.add(identity(person))
                    if country not in EUROPE:
                        counts["outside_europe_or_unknown"] += 1
                        continue
                    stage, touch = text(row.get("I")), text(row.get("H"))
                    summary, reply = text(row.get("K")), text(row.get("J"))
                    if stage == "明确拒绝" or "别再联系" in summary or "名单中抹除" in summary:
                        counts["do_not_contact"] += 1
                        continue
                    evidence = f"{country} · {touch} · {stage}"
                    task_id = f"workbook:{identity(person)}"
                    if stage == "未建联" and reply == "未回复" and touch in {"首次触达", "二次触达"}:
                        tasks.append(make_task(task_id, f"跟进 {person} 的未回复触达", "progress", "KOL 跟进", person,
                            "核对最近一次发送时间，记录下次跟进日期；尚无日期，暂不当作今天到期。", "no_reply", evidence,
                            krm_stage="unconnected"))
                    elif stage == "触达推进中" and reply and reply != "未回复":
                        need = summary or "台账未记录对方具体需求"
                        unrecorded = not text(row.get("L"))
                        tasks.append(make_task(task_id, f"回复 {person} 并确认合作方式", "today" if unrecorded else "progress",
                            "KOL 跟进", person, "核对邮件线程；若尚未回复，确认合作方式并记录下一步。" if unrecorded else "核对后续沟通与下一步。",
                            "reply_pending" if unrecorded else "collaboration", evidence + (" · 未记录二次沟通" if unrecorded else ""), need, unrecorded))
            elif name == "合作伙伴":
                for row in list(sheet_rows(archive, path, strings, {"A", "D", "E", "J"}))[1:]:
                    person, country = text(row.get("A")), text(row.get("J"))
                    if not person or country not in EUROPE:
                        continue
                    stage, signed = text(row.get("D")), text(row.get("E"))
                    if signed == "已签约" and "首次触达" in stage:
                        tasks.append(make_task(f"workbook:partner:{identity(person)}", f"核实 {person} 的合作阶段", "focus",
                            "KOL 核实", person, "核对合作伙伴表：签约状态与阶段冲突；确认真实状态和对方需要什么。",
                            "collaboration_review", f"{country} · 签约状态：{signed} · 阶段：{stage}", "台账未记录；需核实"))
                    elif signed == "已签约":
                        tasks.append(make_task(f"workbook:partner:{identity(person)}", f"确认 {person} 的合作需求", "progress",
                            "KOL 跟进", person, "核对当前合作需求和下一步时间。", "collaboration",
                            f"{country} · 签约状态：{signed} · 阶段：{stage}", "台账未记录"))
    if krm_paste_path:
        imported, krm_counts = krm_tasks(krm_paste_path, contacted)
        tasks.extend(imported)
        counts.update(krm_counts)
    if candidates_path and candidates_path.exists():
        with candidates_path.open("r", encoding="utf-8-sig", newline="") as stream:
            for row in csv.DictReader(stream):
                person = text(row.get("账号名"))
                if not person or "示例" in person or row.get("状态") != "待核实" or row.get("公海查重结果") != "未发现重复":
                    continue
                if identity(person) in contacted:
                    counts["candidate_duplicates"] += 1
                    continue
                tasks.append(make_task(f"candidate:{identity(person)}", f"核实候选 {person}", "future", "KOL 核实", person,
                    "先核实主页、近期内容、国家和语言；通过后再列入尚未触达名单。", "verify",
                    "候选名单 · 待核实 · 公海未发现重复"))
    revision = hashlib.sha256(json.dumps(tasks, ensure_ascii=True, sort_keys=True).encode("utf-8")).hexdigest()[:16]
    return {"version": 1, "revision": revision, "tasks": tasks, "diagnostics": counts}


def main():
    if len(sys.argv) not in {2, 3, 4}:
        raise SystemExit("用法：python3 prepare_private_data.py 跟进表.xlsx [候选名单.csv] [KRM粘贴文本.txt]")
    workbook = Path(sys.argv[1])
    candidates = Path(sys.argv[2]) if len(sys.argv) == 3 else None
    if len(sys.argv) == 4:
        candidates = Path(sys.argv[2])
    krm_paste = Path(sys.argv[3]) if len(sys.argv) == 4 else None
    data = build(workbook, candidates, krm_paste)
    output = Path(__file__).with_name("local-data.js")
    output.write_text("window.PIMAX_LOCAL_SEED = " + json.dumps(data, ensure_ascii=True, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(json.dumps({"output": str(output), "tasks": len(data["tasks"]), "diagnostics": data["diagnostics"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
