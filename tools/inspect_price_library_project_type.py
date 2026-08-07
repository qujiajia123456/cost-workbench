import json
import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "price_library.db"


def rows_to_dicts(rows):
    return [dict(row) for row in rows]


def main():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    missing_where = "project_type IS NULL OR length(trim(project_type)) = 0"
    total = conn.execute("SELECT COUNT(*) FROM price_library").fetchone()[0]
    missing = conn.execute(f"SELECT COUNT(*) FROM price_library WHERE {missing_where}").fetchone()[0]
    by_source = conn.execute(
        f"""
        SELECT source_file, source, COUNT(*) AS count
        FROM price_library
        WHERE {missing_where}
        GROUP BY source_file, source
        ORDER BY count DESC
        LIMIT 20
        """
    ).fetchall()
    by_project = conn.execute(
        f"""
        SELECT project, company, COUNT(*) AS count
        FROM price_library
        WHERE {missing_where}
        GROUP BY project, company
        ORDER BY count DESC
        LIMIT 20
        """
    ).fetchall()
    samples = conn.execute(
        f"""
        SELECT id, item, unit, price, region, project_type, project, company, source, source_file, remark
        FROM price_library
        WHERE {missing_where}
        ORDER BY price_date DESC
        LIMIT 40
        """
    ).fetchall()
    same_project_fill = conn.execute(
        f"""
        SELECT m.project, m.company, COUNT(*) AS missing_count,
               GROUP_CONCAT(DISTINCT f.project_type) AS available_project_types
        FROM price_library m
        JOIN price_library f
          ON trim(ifnull(m.project, '')) = trim(ifnull(f.project, ''))
         AND trim(ifnull(m.company, '')) = trim(ifnull(f.company, ''))
        WHERE ({missing_where.replace('project_type', 'm.project_type')})
          AND f.project_type IS NOT NULL
          AND length(trim(f.project_type)) > 0
          AND length(trim(ifnull(m.project, ''))) > 0
        GROUP BY m.project, m.company
        ORDER BY missing_count DESC
        LIMIT 30
        """
    ).fetchall()
    print(json.dumps({
        "total": total,
        "missing": missing,
        "missingRate": round(missing / total, 4) if total else 0,
        "bySource": rows_to_dicts(by_source),
        "byProject": rows_to_dicts(by_project),
        "sameProjectCanFill": rows_to_dicts(same_project_fill),
        "samples": rows_to_dicts(samples),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
