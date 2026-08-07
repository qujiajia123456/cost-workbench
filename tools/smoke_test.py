from __future__ import annotations

import json
import time
import urllib.request
import uuid
from pathlib import Path

from openpyxl import Workbook


ROOT = Path(__file__).resolve().parents[1]
TEST_FILE = ROOT / "data" / "test_settlement_upload.xlsx"


def make_workbook() -> None:
    TEST_FILE.parent.mkdir(parents=True, exist_ok=True)
    wb = Workbook()
    ws = wb.active
    ws.title = "测试分公司"
    ws.append(["序号", "工程名称", "建筑面积", "合同价款", "", "", "", "竣工实际", "", "", "送审造价", "定案日期", "定案造价", "", "项目经理"])
    ws.append([1, "测试工程", 1000, 500, None, None, None, "2026-06-01", None, None, 480, "2026-06-20", 470, None, "张三"])
    wb.save(TEST_FILE)


def post_upload(base_url: str) -> dict:
    boundary = "----ReportHubSmoke" + uuid.uuid4().hex
    fields = {
        "reportType": "settlement",
        "period": "2026-06",
        "company": "测试分公司",
    }
    parts: list[bytes] = []
    for key, value in fields.items():
        parts.append(
            (
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="{key}"\r\n\r\n'
                f"{value}\r\n"
            ).encode("utf-8")
        )
    parts.append(
        (
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="file"; filename="test_settlement_upload.xlsx"\r\n'
            "Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n"
        ).encode("utf-8")
        + TEST_FILE.read_bytes()
        + b"\r\n"
    )
    parts.append(f"--{boundary}--\r\n".encode("utf-8"))
    body = b"".join(parts)
    request = urllib.request.Request(
        f"{base_url}/api/uploads",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(request, timeout=8) as response:
        return json.loads(response.read().decode("utf-8"))


def get_summary(base_url: str) -> dict:
    with urllib.request.urlopen(f"{base_url}/api/summary?type=settlement&period=2026-06", timeout=8) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> None:
    base_url = "http://127.0.0.1:8767"
    make_workbook()
    time.sleep(1)
    upload = post_upload(base_url)
    summary = get_summary(base_url)
    print(json.dumps({"uploadStatus": upload["status"], "rows": len(upload["rows"]), "summary": summary["cards"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
