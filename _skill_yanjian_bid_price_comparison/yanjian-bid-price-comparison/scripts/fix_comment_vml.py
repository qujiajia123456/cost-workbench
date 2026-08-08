"""Fix legacy Excel comment VML size and anchor.

Usage:
    python scripts/fix_comment_vml.py input.xlsx output.xlsx

This script copies input.xlsx to output.xlsx while injecting/replacing
xl/drawings/commentsDrawing1.vml so Excel's "Edit Comment" box stays beside the
commented cell and uses width 9 cm, height 6 cm.
"""

from __future__ import annotations

import argparse
import pathlib
import re
import zipfile
from xml.sax.saxutils import escape


def col_to_index(col: str) -> int:
    result = 0
    for ch in col:
        result = result * 26 + ord(ch) - ord("A") + 1
    return result


def split_cell_ref(ref: str) -> tuple[int, int]:
    match = re.match(r"([A-Z]+)([0-9]+)", ref)
    if not match:
        raise ValueError(f"Bad cell ref: {ref}")
    return col_to_index(match.group(1)), int(match.group(2))


def build_vml(comment_refs: list[str]) -> str:
    shape_type = (
        '<v:shapetype id="_x0000_t202" coordsize="21600,21600" '
        'o:spt="202" path="m,l,21600r21600,l21600,xe">'
        '<v:stroke joinstyle="miter"/>'
        '<v:path gradientshapeok="t" o:connecttype="rect"/>'
        "</v:shapetype>"
    )
    shapes = []
    for idx, ref in enumerate(comment_refs, start=1026):
        col, row = split_cell_ref(ref)
        left_col = col
        top_row = row - 1
        right_col = col + 5
        bottom_row = row + 9
        anchor = f"{left_col}, 15, {top_row}, 10, {right_col}, 15, {bottom_row}, 10"
        shapes.append(
            f'<v:shape id="_x0000_s{idx}" type="#_x0000_t202" '
            f'style="position:absolute;margin-left:0pt;margin-top:0pt;'
            f'width:9cm;height:6cm;z-index:{idx};visibility:hidden" '
            f'fillcolor="#ffffe1" o:insetmode="auto">'
            '<v:fill color2="#ffffe1"/>'
            '<v:shadow on="t" color="black" obscured="t"/>'
            '<v:path o:connecttype="none"/>'
            '<v:textbox style="mso-direction-alt:auto"><div style="text-align:left"></div></v:textbox>'
            '<x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/>'
            f"<x:Anchor>{escape(anchor)}</x:Anchor><x:AutoFill>False</x:AutoFill>"
            f"<x:Row>{row - 1}</x:Row><x:Column>{col - 1}</x:Column>"
            "</x:ClientData></v:shape>"
        )
    return (
        '<xml xmlns:v="urn:schemas-microsoft-com:vml" '
        'xmlns:o="urn:schemas-microsoft-com:office:office" '
        'xmlns:x="urn:schemas-microsoft-com:office:excel">'
        '<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout>'
        f"{shape_type}{''.join(shapes)}</xml>"
    )


def ensure_content_type(content_types: str) -> str:
    if 'Extension="vml"' in content_types:
        return content_types
    insert = '<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>'
    return content_types.replace("</Types>", f"{insert}</Types>")


def patch_workbook(src: pathlib.Path, dst: pathlib.Path) -> None:
    with zipfile.ZipFile(src, "r") as zin:
        comment_names = [name for name in zin.namelist() if name.startswith("xl/comments/comment") and name.endswith(".xml")]
        if not comment_names:
            raise SystemExit("No comments XML found.")
        comments_name = comment_names[0]
        comments = zin.read(comments_name).decode("utf-8", "ignore")
        refs = re.findall(r'<comment ref="([^"]+)"', comments)
        vml = build_vml(refs)

        with zipfile.ZipFile(dst, "w", compression=zipfile.ZIP_DEFLATED) as zout:
            for info in zin.infolist():
                if info.filename == "xl/drawings/commentsDrawing1.vml":
                    continue
                data = zin.read(info.filename)
                if info.filename == "[Content_Types].xml":
                    data = ensure_content_type(data.decode("utf-8", "ignore")).encode("utf-8")
                if info.filename == comments_name:
                    next_shape = 1026

                    def repl(match: re.Match[str]) -> str:
                        nonlocal next_shape
                        text = re.sub(r'shapeId="[0-9]+"', f'shapeId="{next_shape}"', match.group(0))
                        next_shape += 1
                        return text

                    data = re.sub(r'<comment ref="[^"]+" authorId="[^"]+" shapeId="[0-9]+">', repl, comments).encode("utf-8")
                zout.writestr(info, data)
            zout.writestr("xl/drawings/commentsDrawing1.vml", vml.encode("utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=pathlib.Path)
    parser.add_argument("output", type=pathlib.Path)
    args = parser.parse_args()
    patch_workbook(args.input, args.output)
    print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
