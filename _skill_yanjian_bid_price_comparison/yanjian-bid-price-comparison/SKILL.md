---
name: yanjian-bid-price-comparison
description: Generate Yan Jian Group winning-bid price comparison Excel workbooks from the Yan Jian purchasing platform and PM platform. Use when Codex needs to export or process 集采平台/PM平台 data, build 中标价格横向对比 files, populate the four sample-template sheets, apply table-specific formatting, hyperlinks, comments, regional aggregation, payment-method normalization, Dongtai table-four data, and remove test rows.
---

# 烟建中标价格对比

Use this skill to create the four-sheet workbook for 烟建集团有限公司中标价格横向对比.

Before doing any file processing, confirm the reporting date range. If the user does not specify a range, use the last three-month logic described in `references/business-rules.md`. If the user specifies a non-three-month range but the output filename still says `近三个月`, ask whether to keep or change that wording.

## Required Inputs

- Sample workbook: `XXXX年集采平台近三个月物资中标价格对比（XXXX年X月X日-XXXX年X月X日）样表.xlsx`
- Data source files exported from:
  - 烟建集采平台: `http://yanjianjicai.gyuncai.com/`
  - 大数据管理 PM 平台: `http://yanjianpm.glodon.com/Portal/Frame/LayoutC/Default.aspx`
- User/admin-provided credentials. Do not embed passwords in generated skill files or scripts.

## Workflow

1. Export source data.
   - 集采平台 `中标价格对比分析`: filter by `招标结果发布时间`.
   - 集采平台 `中标价格查询`: filter by `中标日期`.
   - 集采平台 `招标结果台帐`: filter by `结果发布日期`.
   - PM 平台 `项目基本信息`: export all pages, Excel 2003 if the platform asks.
2. Build the filtered detail dataset.
   - Use `清单编号` from the filtered `中标价格对比分析` report to filter `中标价格查询`.
   - Clean `需求单位`; remove text from `-` onward, and replace `烟建集团有限公司` with `项目名称`.
   - Delete rows where `采购过程名称` or `需求单位` contains `测试`.
3. Populate the sample workbook.
   - 表三 from filtered `中标价格查询`.
   - 表二 from 表三 grouped averages.
   - 表一 from 表三 actual high/low detail prices.
   - 表四 from the original exported `中标价格对比分析` report where the `东泰` column has a price. Do not limit 表四 to rows that pass the multi-company filter.
4. Apply formatting, hyperlinks, comments, and validation.
5. Save the final workbook with the reporting date in the title and filename.

## Load References

Read these files when implementing or checking a report:

- `references/business-rules.md`: data source, filtering, grouping, and table population rules.
- `references/formatting-rules.md`: sheet formatting, hyperlinks, comments, VML, and validation checks.
- `references/platform-notes.md`: platform export/login notes and implementation cautions.

## Useful Script

Use `scripts/fix_comment_vml.py` after editing comments with openpyxl or when Excel shows comment boxes in the wrong size/location. It injects the missing legacy VML comment drawing and anchors each comment to the right side of its cell.

```powershell
python scripts/fix_comment_vml.py input.xlsx output.xlsx
```

## Critical Checks

- 表三 Q 列 must display `现金`, `分期`, or `抵房/物`, not platform codes such as `CASH`, `FQ`, `DFW`.
- 表三 must not contain rows where `采购过程名称` or cleaned `需求单位` contains `测试`.
- 表四 must include all original `中标价格对比分析` rows with a valid `东泰` price.
- 表一 price hyperlinks must jump to 表三 column J corresponding cells.
- 表一 highest prices must be red.
- 表一 highest-price comments must be 9 cm wide and 6 cm high, with the edit box anchored beside the commented cell.
