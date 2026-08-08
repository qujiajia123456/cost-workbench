# Business Rules

## Date Range

- For this task type, use the user-specified date range.
- If no range is specified, use the last-three-month logic, such as `2026-03-01` to `2026-05-25` or `2026-04-01` to `2026-06-25`, depending on the current/latest available cutoff.
- If the user specifies a non-three-month range but the output filename contains `近三个月`, ask whether to keep that wording.

## Data Sources

### 集采平台

Export these reports with the reporting date range:

1. `数据中心` -> `项目定制报表` -> `中标价格对比分析`
   - Date field: `招标结果发布时间`.
   - Export Excel.
   - For filtering detail rows, keep rows where the subsidiary average-price columns `J:W` contain at least two valid numeric nonzero price values. Ignore blanks, zero, and text.
2. `数据中心` -> `项目定制报表` -> `中标价格查询`
   - Date field: `中标日期`.
   - Export Excel.
3. `数据中心` -> `交易报表` -> `招标结果台帐`
   - Date field: `结果发布日期`.
   - Export Excel.

### PM 平台

Export `项目信息` -> `项目立项信息管理` -> `项目基本信息`.

- Always export all project pages.
- If the export settings dialog appears, select `全部页` and `Excel 2003`.
- Use the exported project data to match `施工项目部` to `项目名称` and fill region information.

## Detail Dataset

Build a new `中标价格查询` dataset by filtering `中标价格查询` with the `清单编号` values from the filtered `中标价格对比分析` report.

Clean `需求单位`:

- Remove `-` and all content to the right.
- If the result equals `烟建集团有限公司`, replace it with the row's `项目名称`.
- Delete any row where `采购过程名称` or cleaned `需求单位` contains `测试`.

Normalize `付款方式`:

| Platform value | Display value |
|---|---|
| `CASH` | `现金` |
| `FQ` | `分期` |
| `DFW` | `抵房/物` |

## Sheet Rules

### 表三：中标价格横向对比数据明细

Populate from the cleaned filtered `中标价格查询` dataset. Same `清单编号` rows should be adjacent.

Map fields accurately:

- `中标单位`: from `招标结果台帐`, matched by `任务编号`.
- `地区`: from PM `项目基本信息`, matched by `施工项目部` to `项目名称`.
- If `地区` is `全国`, infer from `项目名称` using Chinese province/city/district names.

### 表二：平均中标价格横向对比

Use unique `(清单编号, 材料名称, 规格/项目特征, 单位)` from 表三.

- `集团平均中标价格`: average all 表三 `含税中标价格` detail prices in the same group. Do not average by company first.
- `K:X` company columns: average 表三 `含税中标价格` by `公司名称`.
- Merge `市政路桥` and `格瑞特` into the same company average.
- `地区`: based on the regions participating in the group average:
  - Multiple provinces -> `全国`.
  - Same province and multiple cities -> the province, for example `山东省`.
  - Same city -> that city, for example `烟台市`.
  - Districts/counties must roll up to their city before province evaluation, for example `海阳市` and `开发区` roll up to `烟台市`.

### 表一：中标价格高的材料

Group by `(清单编号, 材料名称, 规格/项目特征, 单位)`, not only by `清单编号`.

Use actual detail prices from 表三, not averages.

Ratio formula:

```text
(最高价 - 最低价) / 最低价
```

Rules:

- If the group highest-vs-lowest difference is greater than 50%, extract the high and low actual detail prices.
- If the same company has multiple detail prices for the same group, use that company's actual high/low detail prices, not the average.
- `东泰物流最高价` and `东泰物流最低价` only use 表三 rows where `公司名称 = 东泰`.
- If 东泰 differs from another company by more than 50%, extract 东泰 and the corresponding other-company price, and fill the Dongtai high/low columns.
- If 东泰 has no greater-than-50% comparison with other companies, compare Dongtai's own high and low prices; if the difference is greater than 10%, fill the Dongtai high/low columns.
- If no Dongtai data exists, compare other companies; if their difference is greater than 20%, extract the group.
- Round 表一 extracted prices to two decimals.

### 表四：东泰物流平均中标价格

Use the original exported `中标价格对比分析` file, not the filtered comparison file.

For every row where the `东泰` column has a valid price, write:

- `清单编号`
- `清单名称`
- `规格/项目特征`
- `单位`
- `东泰物流平均中标价格`

Do not restrict 表四 to rows where `J:W` has two or more company prices. 表四 is an all-Dongtai-price list from the original comparison export.
