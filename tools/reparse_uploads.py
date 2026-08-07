from __future__ import annotations

import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "db.json"
UPLOAD_DIR = ROOT / "data" / "uploads"
sys.path.insert(0, str(ROOT))

from server import PLUGINS, clean_text, company_from_filename, standard_company_name


def find_upload_file(upload_id: str, stored_path: str) -> Path | None:
    path = Path(stored_path)
    if path.exists():
        return path
    matches = list(UPLOAD_DIR.glob(f"{upload_id}_*.xlsx"))
    return matches[0] if matches else None


def main() -> None:
    db = json.loads(DB_PATH.read_text(encoding="utf-8"))
    changed = 0
    for upload in db.get("uploads", []):
        plugin = PLUGINS.get(upload.get("reportType", ""))
        if not plugin:
            continue
        source = find_upload_file(upload.get("id", ""), upload.get("storedPath", ""))
        if not source:
            upload["status"] = "校验失败"
            upload["errors"] = ["找不到原始上传文件，无法重新解析。"]
            continue
        company = company_from_filename(source.name) or standard_company_name(clean_text(upload.get("company")))
        if company and any(text in company for text in ["评分汇总表", "风险等级", "竣工结算", "定案情况"]):
            company = ""
        result = plugin.parse(source, company)
        if upload.get("reportType") == "risk-level" and not company:
            detected_names = {standard_company_name(row.get("company", "")) for row in result.rows if standard_company_name(row.get("company", ""))}
            if len(detected_names) == 1:
                company = next(iter(detected_names))
            elif len(detected_names) > 1:
                upload["company"] = ""
                upload["rows"] = []
                upload["errors"] = ["该文件包含多个单位，请上传单个基层单位报表，或使用文件名标明单位。"]
                upload["warnings"] = []
                upload["sheetNames"] = result.sheet_names
                upload["status"] = "校验失败"
                changed += 1
                continue
            else:
                upload["company"] = ""
                upload["rows"] = []
                upload["errors"] = ["无法从文件名或表内单位名称识别公司。"]
                upload["warnings"] = []
                upload["sheetNames"] = result.sheet_names
                upload["status"] = "校验失败"
                changed += 1
                continue
        for row in result.rows:
            row["company"] = company or standard_company_name(row.get("company", ""))
            row["_source_path"] = str(source)
            row["_source_file"] = source.name.split("_", 1)[-1]
        upload["storedPath"] = str(source)
        upload["filename"] = source.name.split("_", 1)[-1]
        upload["company"] = company or (result.rows[0].get("company", "") if result.rows else "")
        upload["rows"] = result.rows
        upload["errors"] = result.errors
        upload["warnings"] = result.warnings
        upload["sheetNames"] = result.sheet_names
        upload["status"] = "校验通过" if not result.errors else "校验失败"
        changed += 1
    DB_PATH.write_text(json.dumps(db, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"reparsed {changed} uploads")


if __name__ == "__main__":
    main()
