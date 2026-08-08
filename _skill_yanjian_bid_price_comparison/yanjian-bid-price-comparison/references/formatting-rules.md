# Formatting Rules

Apply borders to the populated content regions of all four sheets.

## Titles

Update row 1 bracketed date text in all sheets to the reporting range, for example:

```text
2026年6月1日—2026年6月30日
```

## 表一：中标价格高的材料

- Font: `宋体`, bold.
- Row 1: size 18, height 49.
- Row 2: size 14, height 45, left aligned, blue font. Only the substring `红色字体` must be red.
- Rows 3-4: size 12, height 36, centered.
- Rows 5+: size 10, height 18.
- Highest prices: red font.
- Other prices: black font.
- F:S rows 5+ right aligned; other data centered.

Hyperlinks and comments:

- Add hyperlinks to every extracted highest and lowest price cell, including `东泰物流最高价` and `东泰物流最低价`.
- Hyperlinks must be internal workbook links to the corresponding 表三 `含税中标价格` cell.
- Fill corresponding 表三 highest-price cells yellow.
- Only highest-price cells in 表一 get comments.
- Comment content:

```text
1.项目名称：
2.项目地区：
3.付款方式：
4.原因说明：
```

Fill `项目名称`, `项目地区`, and `付款方式` from 表三.

Comment formatting:

- Font: `宋体`, size 9.
- Text alignment: horizontal left, vertical top.
- Fill color: RGB `(255,255,225)`.
- Size: width 9 cm, height 6 cm.
- The edit-comment box must remain beside the cell, not jump to the top-left corner.
- If using openpyxl, inject/fix legacy VML comments after saving; see `scripts/fix_comment_vml.py`.

## 表二：平均中标价格横向对比

- Font: `宋体`, bold.
- Row 1: size 18, height 49.
- Row 2: size 14, height 45, left aligned, blue font. Only `红色字体` is red.
- Rows 3-4: size 12, height 36, centered.
- Rows 5+: size 10, height 18.
- K:X rows 5+ right aligned; other data centered.
- In K:X, values greater than `集团平均中标价格` are red; other prices are black.

## 表三：中标价格横向对比数据明细

- Font: `Microsoft YaHei UI`.
- Row 1: size 18, height 37, bold.
- Row 2: size 14, height 24, bold, left aligned, blue font. Only `红色字体` is red.
- Row 3: size 9, height 24, bold, centered.
- Rows 4+: size 9, height 24, not bold.
- Wrap text for all populated cells.
- H:J rows 4+ right aligned; other data centered.
- `中标日期` displays only year-month-day.
- Based on `清单编号`, fill A:T alternating colors:
  - cornflower blue, accent 1, light 60%
  - chocolate yellow, accent 1, light 60%
- The same `清单编号` must have the same fill color.
- Highest-price target cells from 表一 are yellow in column J.

## 表四：东泰物流平均中标价格

- Font: `宋体`, bold.
- Row 1: size 18, height 49.
- Row 2: size 14, height 36.
- Rows 3+: size 10, height 18.
- F rows 3+ right aligned; other data centered.

## Validation Checklist

- 表三 Q column contains only `现金`, `分期`, `抵房/物`.
- No 表三 row contains `测试` in `采购过程名称` or cleaned `需求单位`.
- 表一 hyperlinks have internal locations, not external target-only links.
- 表一 highest prices are red and have comments.
- Comment VML exists and has `width:9cm;height:6cm` for each comment shape.
- 表四 row count matches original `中标价格对比分析` rows with a valid `东泰` price.
