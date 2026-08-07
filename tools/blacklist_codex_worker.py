from __future__ import annotations

import argparse
import json
import webbrowser
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import quote_plus


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
JOB_DIR = DATA_DIR / "codex_blacklist_jobs"
RESULT_DIR = DATA_DIR / "blacklist_results"


def read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def job_files() -> list[Path]:
    JOB_DIR.mkdir(parents=True, exist_ok=True)
    RESULT_DIR.mkdir(parents=True, exist_ok=True)
    return sorted(JOB_DIR.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True)


def result_path(job: dict, path: Path) -> Path:
    preferred = job.get("preferredOutput")
    if preferred:
        return Path(preferred)
    return RESULT_DIR / path.name


def job_status(job: dict, path: Path) -> str:
    return "已回写" if result_path(job, path).exists() else job.get("status", "pending")


def estimate_finish(created_at: str) -> str:
    try:
        base = datetime.strptime(str(created_at).strip(), "%Y-%m-%d %H:%M:%S")
    except ValueError:
        base = datetime.now()
    return (base + timedelta(minutes=10)).strftime("%Y-%m-%d %H:%M:%S")


def pending_jobs() -> list[tuple[Path, dict]]:
    rows = []
    for path in job_files():
        job = read_json(path)
        if not job:
            continue
        if job_status(job, path) != "已回写":
            rows.append((path, job))
    return rows


def print_job(path: Path, job: dict) -> None:
    output_path = result_path(job, path)
    print("=" * 72)
    print(f"任务ID: {job.get('id', path.stem)}")
    print(f"查询对象: {job.get('query', '')}")
    print(f"创建时间: {job.get('createdAt', '')}")
    print(f"预计完成: {job.get('estimatedAt') or estimate_finish(job.get('createdAt', ''))}")
    print(f"状态: {job_status(job, path)}")
    print(f"任务文件: {path}")
    print(f"回写文件: {output_path}")
    print()
    print("处理要求:")
    print(job.get("instruction", ""))
    print()
    print("建议层级: 3层以内，先查直接股东/法人，再查股东的股东和对外投资。")
    print("围标串标口径: 记录同法人、同股东、同高管、同联系人、同电话、同地址、同账户等异常线索，并列明事实定位、合理解释和待补证事项。")
    print("注意: 使用已授权的天眼查账号或企业信息数据源，不绕过验证码、登录、付费或反爬限制。")


def list_jobs() -> None:
    rows = job_files()
    if not rows:
        print("暂无天眼查穿透任务。")
        return
    for path in rows:
        job = read_json(path)
        if not job:
            continue
        print(f"{job.get('id', path.stem)[:8]}  {job_status(job, path):<8}  {job.get('createdAt', '')}  预计:{job.get('estimatedAt') or estimate_finish(job.get('createdAt', ''))}  {job.get('query', '')}")


def print_next() -> None:
    rows = pending_jobs()
    if not rows:
        print("暂无待处理任务。")
        return
    print_job(*rows[0])


def write_template(job_id: str) -> None:
    matches = [path for path in job_files() if path.stem == job_id or path.stem.startswith(job_id)]
    if not matches:
        raise SystemExit(f"未找到任务: {job_id}")
    path = matches[0]
    job = read_json(path)
    output_path = result_path(job, path)
    if output_path.exists():
        raise SystemExit(f"回写文件已存在: {output_path}")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "query": job.get("query", ""),
        "source": "天眼查/授权企业信息数据源",
        "checkedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "entities": [
            {
                "id": "",
                "name": "",
                "creditCode": "",
                "riskLevel": "关联关注",
                "status": "需复核",
                "legalRep": "",
                "shareholders": [],
                "contacts": [],
                "bankAccounts": [],
                "address": "",
                "reason": "",
                "source": "天眼查",
                "updatedAt": datetime.now().strftime("%Y-%m-%d"),
            }
        ],
        "allRelatedCompanies": [
            {
                "name": "",
                "relationGroup": "股东向上/自然人股东层/向下投资及控制/分支机构/主要人员交叉/同电话同地址同账户/其他自然人股东/风险记录关联",
                "depth": "",
                "path": [job.get("query", "")],
                "expanded": False,
                "stopReason": "",
            }
        ],
        "coverage": {
            "status": "partial",
            "completedDepth": 0,
            "completedGroups": [],
            "expandedNodeCount": 0,
            "relatedCompanyCount": 0,
            "unexpandedNodes": [
                {"name": job.get("query", ""), "reason": "模板待填写，尚未完成天眼查穿透", "group": "根节点"}
            ],
            "stopReasons": [],
            "summary": "按泰山集团关系图思路逐项展开：股东向上、自然人股东层、向下投资及控制、分支机构、主要人员交叉、同电话/同地址/同账户、其他自然人股东、风险记录关联。完成后把 status 改为 complete；若受授权或页面限制，保留 partial 并写明原因。",
        },
        "routes": [
            {
                "path": ["最终上层控股主体/实际控制人", "中间层控股股东", job.get("query", "")],
                "relations": ["控制/持股", "控制/持股"],
                "source": job.get("query", ""),
                "target": "",
                "label": "向上穿透上级控股公司",
                "sourceType": "root",
                "targetType": "related",
            }
        ],
        "upwardRoutes": [
            {
                "path": ["最终上层控股主体/实际控制人", "中间层控股股东", job.get("query", "")],
                "relations": ["控制/持股", "控制/持股"],
                "note": "向上穿透：填写查询对象的股东、控股股东、实际控制人或最终上层主体。",
            }
        ],
        "downwardRoutes": [
            {
                "path": [job.get("query", ""), "控股/参股企业", "下层关联企业"],
                "relations": ["对外投资/控制", "对外投资/控制"],
                "note": "向下穿透：填写查询对象投资、控股或参股的下层企业。",
            }
        ],
        "branchRoutes": [
            {
                "path": [job.get("query", ""), "分支机构"],
                "relations": ["设立/分支"],
                "note": "分支机构路线：列出所有可见分支机构，并继续检查其负责人、地址、联系方式和风险记录。",
            }
        ],
        "personCrossRoutes": [
            {
                "path": [job.get("query", ""), "主要人员", "关联企业"],
                "relations": ["任职/高管", "任职/投资"],
                "note": "主要人员交叉路线：法定代表人、董监高、关键人员投资或任职的企业。",
            }
        ],
        "sameContactRoutes": [
            {
                "path": [job.get("query", ""), "同电话/同地址/同账户", "关联企业"],
                "relations": ["同电话/同地址/同账户", "关联"],
                "note": "联系方式交叉路线：同电话、同注册地址、同经营地址、同账户等授权可见线索。",
            }
        ],
        "naturalPersonRoutes": [
            {
                "path": [job.get("query", ""), "自然人股东", "自然人控制/投资企业"],
                "relations": ["股东", "投资/任职/控制"],
                "note": "自然人股东层路线：自然人股东名下投资、任职或控制企业。",
            }
        ],
        "otherShareholderRoutes": [
            {
                "path": [job.get("query", ""), "其他股东", "其他股东关联企业"],
                "relations": ["股东", "投资/任职/控制"],
                "note": "其他股东关联路线：除控股股东外其他法人或自然人股东的关联企业。",
            }
        ],
        "clueMatrix": [
            {
                "id": "CL-001",
                "objects": "",
                "indicator": "",
                "verifiedFact": "",
                "riskExplanation": "",
                "possibleExplanation": "",
                "missingEvidence": "",
                "priority": "中",
            }
        ],
        "evidenceCatalog": [
            {
                "id": "E-001",
                "name": "",
                "source": "天眼查",
                "location": "",
                "relatedClue": "CL-001",
                "sensitiveHandling": "敏感信息脱敏展示，完整信息保留受控底稿。",
            }
        ],
    }
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"已生成回写模板: {output_path}")


def find_job(job_id: str) -> tuple[Path, dict]:
    matches = [path for path in job_files() if path.stem == job_id or path.stem.startswith(job_id)]
    if not matches:
        raise SystemExit(f"未找到任务: {job_id}")
    path = matches[0]
    return path, read_json(path)


def open_tianyancha(job_id: str) -> None:
    _path, job = find_job(job_id)
    query = str(job.get("query", "")).strip()
    if not query:
        raise SystemExit("任务没有查询对象。")
    url = f"https://www.tianyancha.com/search?key={quote_plus(query)}"
    print(f"打开天眼查搜索页: {url}")
    webbrowser.open(url)


def main() -> None:
    parser = argparse.ArgumentParser(description="黑名单关联查询天眼查穿透中心处理工具")
    parser.add_argument("--list", action="store_true", help="列出全部穿透任务")
    parser.add_argument("--next", action="store_true", help="显示下一条待处理任务")
    parser.add_argument("--template", metavar="JOB_ID", help="为指定任务生成回写 JSON 模板")
    parser.add_argument("--open", metavar="JOB_ID", help="用默认浏览器打开天眼查搜索页")
    args = parser.parse_args()

    if args.list:
        list_jobs()
    elif args.open:
        open_tianyancha(args.open)
    elif args.template:
        write_template(args.template)
    else:
        print_next()


if __name__ == "__main__":
    main()
