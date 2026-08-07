from __future__ import annotations

import argparse
import json
import subprocess
import sys
import webbrowser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
JOB_DIR = DATA_DIR / "codex_material_jobs"

JICAI_URL = "http://yanjianpm.glodon.com/Portal/Frame/LayoutC/Default.aspx"


def read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def job_files() -> list[Path]:
    JOB_DIR.mkdir(parents=True, exist_ok=True)
    return sorted(JOB_DIR.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True)


def job_status(job: dict) -> str:
    return str(job.get("status") or "pending")


def pending_jobs() -> list[tuple[Path, dict]]:
    rows: list[tuple[Path, dict]] = []
    for path in job_files():
        job = read_json(path)
        if not job:
            continue
        if job_status(job) not in {"已完成", "已回写", "completed"}:
            rows.append((path, job))
    return rows


def find_job(job_id: str) -> tuple[Path, dict]:
    matches = [path for path in job_files() if path.stem == job_id or path.stem.startswith(job_id)]
    if not matches:
        raise SystemExit(f"未找到任务: {job_id}")
    path = matches[0]
    return path, read_json(path)


def build_prompt(path: Path, job: dict) -> str:
    filters = job.get("filters") or {}
    required_exports = job.get("requiredExports") or []
    rules = job.get("businessRules") or []
    lines = [
        "请按下面网页工作台生成的材料采购价格横向对比任务执行。",
        "",
        f"任务文件: {path}",
        f"任务ID: {job.get('id', path.stem)}",
        f"任务名称: {job.get('title', '')}",
        f"创建时间: {job.get('createdAt', '')}",
        "",
        "筛选条件:",
        f"- 分公司: {filters.get('company') or '集团'}",
        f"- 开始时间: {filters.get('startDate') or ''}",
        f"- 结束时间: {filters.get('endDate') or ''}",
        f"- 材料关键词: {filters.get('keyword') or '不限'}",
        "- 排除: 装饰幕墙公司",
        "",
        "执行要求:",
        str(job.get("instruction") or ""),
        "",
        "需要导出的源数据:",
    ]
    for item in required_exports:
        if isinstance(item, dict):
            lines.append(f"- {item.get('platform', '')} / {item.get('report', '')} / 日期字段: {item.get('dateField', '')}")
    if rules:
        lines.extend(["", "建表规则:"])
        lines.extend(f"- {rule}" for rule in rules)
    lines.extend(
        [
            "",
            "完成方式:",
            "1. 登录或复用已登录的集采平台/PM平台，按上述条件导出源数据。",
            "2. 回到网页的“导入数据建表”，一次选择这些源数据文件上传。",
            "3. 网页会按 yanjian-bid-price-comparison 技能规则生成四张表工作簿。",
        ]
    )
    preferred = job.get("preferredWriteBack") or job.get("preferredOutput")
    if preferred:
        lines.extend(["", f"回写/上传说明: {preferred}"])
    return "\n".join(lines)


def print_job(path: Path, job: dict) -> None:
    print("=" * 72)
    print(f"任务ID: {job.get('id', path.stem)}")
    print(f"任务名称: {job.get('title', '')}")
    print(f"创建时间: {job.get('createdAt', '')}")
    print(f"状态: {job_status(job)}")
    print(f"任务文件: {path}")
    print()
    print(build_prompt(path, job))


def list_jobs() -> None:
    rows = job_files()
    if not rows:
        print("暂无材料价格 Codex 任务。")
        return
    for path in rows:
        job = read_json(path)
        if not job:
            continue
        print(f"{job.get('id', path.stem)[:8]}  {job_status(job):<10}  {job.get('createdAt', '')}  {job.get('title', '')}")


def print_next() -> None:
    rows = pending_jobs()
    if not rows:
        print("暂无待处理材料价格任务。")
        return
    print_job(*rows[0])


def copy_prompt(job_id: str | None) -> None:
    path, job = pending_jobs()[0] if not job_id else find_job(job_id)
    prompt = build_prompt(path, job)
    try:
        subprocess.run("clip", input=prompt, text=True, check=True, encoding="utf-16le")
    except (OSError, subprocess.CalledProcessError) as exc:
        raise SystemExit(f"复制到剪贴板失败: {exc}") from exc
    print(f"已复制任务提示词到剪贴板: {job.get('id', path.stem)}")


def open_platform() -> None:
    print(f"打开平台: {JICAI_URL}")
    webbrowser.open(JICAI_URL)


def main() -> None:
    parser = argparse.ArgumentParser(description="材料采购价格横向对比 Codex 任务处理工具")
    parser.add_argument("--list", action="store_true", help="列出全部材料价格任务")
    parser.add_argument("--next", action="store_true", help="显示下一条待处理任务")
    parser.add_argument("--copy", nargs="?", const="", metavar="JOB_ID", help="复制任务提示词到剪贴板，可省略 JOB_ID 使用下一条任务")
    parser.add_argument("--open-platform", action="store_true", help="打开集采/PM 平台入口")
    args = parser.parse_args()

    if args.list:
        list_jobs()
    elif args.copy is not None:
        copy_prompt(args.copy or None)
    elif args.open_platform:
        open_platform()
    else:
        print_next()


if __name__ == "__main__":
    try:
        main()
    except IndexError:
        print("暂无待处理材料价格任务。")
        sys.exit(0)
