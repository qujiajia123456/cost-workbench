import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


PROJECT_TYPE_KEYWORDS = ("工程类型", "项目类型", "项目业态", "业态")


def main():
    result = []
    for path in server.find_pm_labor_price_sources():
        data = server.read_json_file(path, [])
        rows = data if isinstance(data, list) else []
        keys = Counter()
        project_type_values = Counter()
        for row in rows[:200]:
            if not isinstance(row, dict):
                continue
            keys.update(row.keys())
            for key, value in row.items():
                if any(word in str(key) for word in PROJECT_TYPE_KEYWORDS):
                    text = server.clean_text(value)
                    if text:
                        project_type_values.update([f"{key}={text}"])
        result.append({
            "file": path.name,
            "rows": len(rows),
            "projectTypeKeys": [key for key in keys if any(word in str(key) for word in PROJECT_TYPE_KEYWORDS)],
            "projectTypeSamples": project_type_values.most_common(10),
            "topKeys": keys.most_common(30),
        })
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
