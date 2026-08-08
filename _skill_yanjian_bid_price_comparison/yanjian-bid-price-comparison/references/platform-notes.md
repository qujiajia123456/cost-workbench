# Platform Notes

## Credentials

Do not hardcode credentials in shared skills or scripts. Ask the user or local administrator for current login details.

If captcha recognition fails, ask the user to provide the captcha text.

## 集采平台

URL:

```text
http://yanjianjicai.gyuncai.com/
```

Reports:

- `中标价格对比分析`
- `中标价格查询`
- `招标结果台帐`

Known fields in the comparison report:

| Display column | Platform field |
|---|---|
| 集团平均中标价格 | `groupavgprice` |
| 三公司 | `3gs` |
| 四公司 | `4gs` |
| 五公司 | `5gs` |
| 六公司 | `6gs` |
| 七公司 | `7gs` |
| 十公司 | `10gs` |
| 市政路桥 | `szlqgs` |
| 青岛公司 | `qdgs` |
| 济南公司 | `jngs` |
| 国际公司 | `gjgs` |
| 设备安装 | `sbazgs` |
| 上海公司 | `shgs` |
| 东泰 | `dtgs` |
| 其他公司 | `othergs` |

Date fields:

- `中标价格对比分析`: `resultstartdate`, `resultenddate`, display label `招标结果发布时间`.
- `中标价格查询`: use the platform's `中标日期` search fields.
- `招标结果台帐`: use the platform's `结果发布日期` search fields.

The `中标价格对比分析` direct backend may reject simple HTTP calls with 403 unless the browser/session/export workflow is reproduced correctly. If direct export is unavailable, document the fallback clearly and prefer browser automation or platform export.

## PM 平台

URL:

```text
http://yanjianpm.glodon.com/Portal/Frame/LayoutC/Default.aspx
```

Export all `项目基本信息`.

Important columns:

- `施工项目部`
- `地域`
- `工程项目名称`
- `项目编码`

Use PM region data to overwrite 表三 `地区` by matching `施工项目部` to 表三 `项目名称`.

## Implementation Cautions

- Excel comments are fragile. openpyxl can write `comments.xml` without the required legacy VML drawing. In that case Excel may show comments at default size or place edit boxes in the top-left corner. Run `scripts/fix_comment_vml.py`.
- Preserve rich text in row 2. If a library strips rich text, reapply it after writing the workbook.
- When a workbook is open in Excel, saving over the same path may fail. Save a new `_修正版.xlsx` file instead.
- Keep source exports or raw JSON/CSV next to the output file for auditability.
