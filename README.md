# 基层报表汇总小程序

这是一个面向内网使用的基层报表上传、校验、汇总、导出小程序雏形。当前已预留通用报表插件框架，并内置两个报表类型：

- 风险等级评定表
- 竣工结算定案表

## 运行环境

普通电脑或内网服务器均可运行，不依赖当前开发电脑的特殊路径。

- Windows 10/11 或 Windows Server
- Python 3.10 及以上版本
- 浏览器：Edge、Chrome 或 360 极速模式

## 首次启动

双击运行：

```bat
install_and_start_windows.bat
```

这个脚本会自动检查 Python；如果没有 Python，会尝试用 Windows 的 `winget` 自动安装 Python，然后创建 `.venv`、安装依赖并启动网页。

如果要把 Python 一起带给别的电脑，有两种方式：

```text
vendor/python-installer.exe
```

把 Python Windows 安装包放到 `vendor` 目录，并重命名为 `python-installer.exe`。目标电脑没有 Python 时，脚本会优先使用这个安装包自动安装。

或者：

```text
.runtime/python/python.exe
```

放便携版 Python 到这个位置。脚本会优先使用便携版 Python，不需要安装到系统。

兼容旧入口：

```bat
start_windows.bat
```

或在 PowerShell 中运行：

```powershell
.\start_windows.ps1
```

启动成功后访问：

```text
http://127.0.0.1:8899
```

如果部署在内网服务器，可这样启动：

```powershell
.\.venv\Scripts\python.exe .\server.py 8899 0.0.0.0
```

然后让其他电脑访问：

```text
http://服务器IP:8899
```

同时需要在服务器防火墙放行端口 `8899`。

## 项目结构

```text
server.py              后端服务、上传、解析、汇总、导出
requirements.txt       Python 依赖
start_windows.bat      Windows 一键启动脚本
start_windows.ps1      PowerShell 启动脚本
static/                前端页面
templates/             正式报表导出模板
data/                  运行后自动生成，保存上传文件、导出文件和本地数据
```

## 模板文件

程序导出时会优先使用 `templates` 目录里的正式模板：

```text
templates/risk-level-template.xlsx       成本风险等级评定表汇总模板
templates/settlement-template.xlsx       竣工结算定案表模板
```

如果以后表样调整，替换同名模板文件即可。替换后，已上传记录可重新解析：

```bat
.venv\Scripts\python.exe tools\reparse_uploads.py
```

## 后续扩展报表

新增报表时，在 `server.py` 中增加一个插件类，并注册到 `PLUGINS`：

```python
class NewReportPlugin(ReportPlugin):
    key = "new-report"
    name = "新报表"

    def parse(self, file_path, company):
        ...

    def aggregate(self, rows):
        ...

    def export(self, rows, output_path, period):
        ...
```

每个报表插件固定实现四件事：

- `parse`：解析基层 Excel
- `validate`：校验规则，目前合并在 `parse` 返回结果中
- `aggregate`：汇总计算
- `export`：导出汇总 Excel

## 当前版本说明

- 当前支持 `.xlsx` 和 `.xls` 文件。
- `.xls` 文件会在后台调用本机 Excel 自动转换为 `.xlsx` 后再解析；目标电脑需要安装 Microsoft Excel。
- 成本风险等级评定表已按正式横向评分表解析，导出时按汇总模板生成。
- 竣工结算定案表导出时保留上传工作表原格式，后续可继续接入总部汇总样表和 A/B/C 口径汇总页。
