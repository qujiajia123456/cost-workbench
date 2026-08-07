param(
    [Parameter(Mandatory = $true)][string]$JsonPath,
    [Parameter(Mandatory = $true)][string]$OutputPath,
    [Parameter(Mandatory = $true)][string]$TemplatePath,
    [string]$Period = ""
)

$ErrorActionPreference = "Stop"

$JsonPath = (Resolve-Path -LiteralPath $JsonPath).Path
$TemplatePath = (Resolve-Path -LiteralPath $TemplatePath).Path
if (-not [System.IO.Path]::IsPathRooted($OutputPath)) {
    $OutputPath = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputPath))
}

$redColor = 255
$blueColor = 16711680

$companyMap = @{
    "三" = "三公司"
    "四" = "四公司"
    "五" = "五公司"
    "六" = "六公司"
    "七" = "七公司"
    "十" = "十公司"
    "青岛" = "青岛公司"
    "济南" = "济南公司"
    "机电安装" = "七公司"
    "机电安装公司" = "七公司"
    "装饰幕墙" = "装饰幕墙公司"
    "格瑞特" = "格瑞特公司"
    "市政路桥" = "市政路桥公司"
    "园林" = "园林公司"
    "上海分" = "上海公司"
    "上海分公司" = "上海公司"
    "特种" = "特种公司"
    "烟建国际" = "国际公司"
    "设备安装" = "设备安装公司"
}

$reportCompanyOrder = @(
    "三公司",
    "四公司",
    "五公司",
    "六公司",
    "七公司",
    "十公司",
    "青岛公司",
    "济南公司",
    "上海公司",
    "格瑞特公司",
    "市政路桥公司",
    "装饰幕墙公司",
    "设备安装公司",
    "国际公司",
    "马来公司"
)

function Normalize-Name($s) {
    if ($null -eq $s) { return "" }
    return ([string]$s).Trim().
        Replace(" ", "").
        Replace("　", "").
        Replace("`n", "").
        Replace("`r", "").
        Replace("·", "").
        Replace("（", "(").
        Replace("）", ")").
        Replace("一期", "1期").
        Replace("二期", "2期").
        Replace("三期", "3期")
}

function Normalize-Company($s) {
    return (Normalize-Name $s).Replace("分公司", "公司")
}

function Project-CompanyName($p) {
    $raw = [string]$p.company
    if ($companyMap.ContainsKey($raw)) { return $companyMap[$raw] }
    return $raw
}

function Company-OrderIndex($companyName) {
    $name = [string]$companyName
    for ($i = 0; $i -lt $reportCompanyOrder.Count; $i++) {
        if ($reportCompanyOrder[$i] -eq $name) { return $i }
    }
    return 999
}

function Project-Sequence($p) {
    try { return [int]$p.sequence } catch { return 9999 }
}

function Number-OrZero($value) {
    if ($null -eq $value) { return 0 }
    try { return [double]$value } catch { return 0 }
}

function Sort-ProjectsForReport($items) {
    return @($items | Sort-Object `
        @{ Expression = { Company-OrderIndex (Project-CompanyName $_) }; Ascending = $true }, `
        @{ Expression = { Project-Sequence $_ }; Ascending = $true })
}

function Project-CompanyAliases($p) {
    $mapped = Project-CompanyName $p
    $aliases = New-Object System.Collections.Generic.List[string]
    if (-not [string]::IsNullOrWhiteSpace($mapped)) { $aliases.Add($mapped) | Out-Null }
    $raw = [string]$p.company
    if (-not [string]::IsNullOrWhiteSpace($raw)) { $aliases.Add($raw) | Out-Null }
    if ($raw -eq "机电安装") { $aliases.Add("机电安装公司") | Out-Null }
    if ($raw -eq "上海分") { $aliases.Add("上海分公司") | Out-Null }
    return $aliases | Select-Object -Unique
}

function Get-RowCompany($ws, $row) {
    for ($r = $row; $r -ge 1; $r--) {
        $text = ([string]$ws.Cells.Item($r, 1).Text).Trim()
        if (-not [string]::IsNullOrWhiteSpace($text)) { return $text }
    }
    return ""
}

function Company-Matches($rowCompany, $project) {
    $rowNormalized = Normalize-Company $rowCompany
    foreach ($alias in @(Project-CompanyAliases $project)) {
        $company = Normalize-Company $alias
        if ([string]::IsNullOrWhiteSpace($company) -or [string]::IsNullOrWhiteSpace($rowNormalized)) { continue }
        if ($rowNormalized.Contains($company) -or $company.Contains($rowNormalized)) { return $true }
    }
    return $false
}

function Find-ProjectRow($ws, $startRow, $endRow, $project) {
    $n = Normalize-Name $project.name
    $m = ([string]$project.major).Trim()
    $bestRow = 0
    $bestScore = 0
    for ($r = $startRow; $r -le $endRow; $r++) {
        $rowName = Normalize-Name $ws.Cells.Item($r, 11).Text
        $rowMajor = ([string]$ws.Cells.Item($r, 12).Text).Trim()
        if ([string]::IsNullOrWhiteSpace($rowName)) { continue }
        if (-not [string]::IsNullOrWhiteSpace($m) -and -not [string]::IsNullOrWhiteSpace($rowMajor) -and $rowMajor -ne $m) { continue }

        $score = 0
        if ($rowName -eq $n) { $score = 1000 }
        elseif ($rowName.Contains($n) -or $n.Contains($rowName)) {
            $minLen = [Math]::Min($rowName.Length, $n.Length)
            if ($minLen -ge 5) { $score = $minLen }
        }
        if ($score -eq 0) { continue }

        $rowCompany = Get-RowCompany $ws $r
        if (Company-Matches $rowCompany $project) { $score += 80 }
        elseif ($score -lt 1000) { continue }

        if ($score -gt $bestScore) {
            $bestScore = $score
            $bestRow = $r
        }
    }
    return $bestRow
}

function Clear-CellSafe($cell) {
    try {
        if ($cell.MergeCells) {
            $cell.MergeArea.ClearContents() | Out-Null
        }
        else {
            $cell.ClearContents() | Out-Null
        }
    }
    catch {}
}

function Has-SourceValue($value) {
    if ($null -eq $value) { return $false }
    return -not [string]::IsNullOrWhiteSpace(([string]$value).Trim())
}

function Convert-NumberSafe($value) {
    if ($null -eq $value) { return $null }
    $text = ([string]$value).Trim().Replace(",", "").Replace("%", "")
    if ([string]::IsNullOrWhiteSpace($text) -or $text -eq "-" -or $text -eq "--") { return $null }
    $number = 0.0
    $ok = [double]::TryParse(
        $text,
        [System.Globalization.NumberStyles]::Any,
        [System.Globalization.CultureInfo]::InvariantCulture,
        [ref]$number
    )
    if ($ok) { return $number }
    return $null
}

function Clean-RateValue($value) {
    if (-not (Has-SourceValue $value)) { return "" }
    return ([string]$value).Trim()
}

function Set-NumberIfPresent($cell, $value) {
    $number = Convert-NumberSafe $value
    if ($null -ne $number) {
        $cell.Value2 = [double]$number
    }
    else {
        Clear-CellSafe $cell
    }
}

function Set-TextOrBlank($cell, $value) {
    $text = Clean-RateValue $value
    if ([string]::IsNullOrWhiteSpace($text)) {
        Clear-CellSafe $cell
    }
    else {
        $cell.Value2 = $text
    }
}

function Set-RateIfPresent($cell, $value) {
    $number = Convert-NumberSafe $value
    if ($null -ne $number) {
        $cell.Value2 = [double]$number
    }
    else {
        Clear-CellSafe $cell
    }
}

function Project-ActualRate($p) {
    $budget = Convert-NumberSafe $p.budget
    $reduction = Convert-NumberSafe $p.reduction
    if ($null -ne $budget -and [Math]::Abs($budget) -gt 0.000001 -and $null -ne $reduction) {
        return [Math]::Round(($reduction / $budget) * 100, 2)
    }
    return $p.reduceActual
}

function Project-Status($p) {
    if (Has-SourceValue $p.displayStatus) { return [string]$p.displayStatus }
    if (Has-SourceValue $p.warningStatus) { return [string]$p.warningStatus }
    return [string]$p.status
}

function Project-DutyDisplay($p) {
    if (Has-SourceValue $p.responsibilityTargetDisplay) { return $p.responsibilityTargetDisplay }
    if (Has-SourceValue $p.reduceDuty) { return $p.reduceDuty }
    return "待签"
}

function Project-IsPlaceholder($p) {
    try { return [bool]$p.placeholder } catch { return $false }
}

function Report-Periods($period) {
    if ($period -match "^(\d{4})-(\d{2})$") {
        $date = Get-Date -Year ([int]$Matches[1]) -Month ([int]$Matches[2]) -Day 1
    }
    else {
        $date = Get-Date -Day 1
    }
    return @(
        $date.AddMonths(-2).ToString("yyyy-MM"),
        $date.AddMonths(-1).ToString("yyyy-MM"),
        $date.ToString("yyyy-MM")
    )
}

function Project-MonthStatus($p, $period) {
    if ($null -ne $p.monthlyStatuses) {
        $prop = $p.monthlyStatuses.PSObject.Properties[$period]
        if ($null -ne $prop -and (Has-SourceValue $prop.Value)) {
            return [string]$prop.Value
        }
    }
    if (([string]$p.reportPeriod) -eq $period) {
        return Project-Status $p
    }
    return ""
}

function Set-StatusCellColor($cell, $status) {
    if ($status -eq "红色") { $cell.Font.Color = $redColor }
    elseif ($status -eq "蓝色") { $cell.Font.Color = $blueColor }
}

function Set-ProjectValues($ws, $row, $p, $Period) {
    $periods = Report-Periods $Period
    for ($i = 0; $i -lt 3; $i++) {
        $cell = $ws.Cells.Item($row, 2 + $i)
        Clear-CellSafe $cell
        try { $cell.Font.ColorIndex = -4105 } catch {}
        $statusText = Project-MonthStatus $p $periods[$i]
        if (Has-SourceValue $statusText) {
            $cell.Value2 = [string]$statusText
            Set-StatusCellColor $cell $statusText
        }
    }
    $status = Project-Status $p
    if (Project-IsPlaceholder $p) {
        foreach ($c in 5..8) {
            $ws.Cells.Item($row, $c).NumberFormat = "@"
            $ws.Cells.Item($row, $c).Value2 = "明细待补抓"
        }
        $ws.Cells.Item($row, 9).Value2 = "汇总占位"
        $ws.Cells.Item($row, 10).NumberFormat = "@"
        $ws.Cells.Item($row, 10).Value2 = "非项目明细"
    }
    else {
        if ($p.contractNoDataVerified) {
            $ws.Cells.Item($row, 5).NumberFormat = "@"
            $ws.Cells.Item($row, 5).Value2 = "平台无数据"
        }
        else {
            if (Has-SourceValue $p.contract) {
                Set-NumberIfPresent ($ws.Cells.Item($row, 5)) $p.contract
            }
            else {
                $ws.Cells.Item($row, 5).NumberFormat = "@"
                $ws.Cells.Item($row, 5).Value2 = "未取到"
            }
        }
        Set-NumberIfPresent ($ws.Cells.Item($row, 6)) $p.budget
        Set-NumberIfPresent ($ws.Cells.Item($row, 7)) $p.actual
        Set-NumberIfPresent ($ws.Cells.Item($row, 8)) $p.reduction
        Set-TextOrBlank ($ws.Cells.Item($row, 9)) (Project-DutyDisplay $p)
        Set-RateIfPresent ($ws.Cells.Item($row, 10)) (Project-ActualRate $p)
    }
    $ws.Cells.Item($row, 11).Value2 = [string]$p.name
    $ws.Cells.Item($row, 12).Value2 = [string]$p.major
    Set-TextOrBlank ($ws.Cells.Item($row, 13)) $p.manager
    Clear-CellSafe $ws.Cells.Item($row, 14)
    Clear-CellSafe $ws.Cells.Item($row, 15)

    $color = 0
    if ($status -eq "红色") { $color = $redColor }
    elseif ($status -eq "蓝色") { $color = $blueColor }
    if ($color -ne 0) {
        foreach ($c in 5..10) {
            $ws.Cells.Item($row, $c).Font.Color = $color
        }
    }
    if (Project-IsPlaceholder $p) {
        $range = $ws.Range($ws.Cells.Item($row, 1), $ws.Cells.Item($row, 15))
        $range.Interior.Color = 15921906
        $range.Font.Italic = $true
    }
}

function Period-Title($period) {
    if ($period -match "^(\d{4})-(\d{2})$") {
        return "$($Matches[1])年$([int]$Matches[2])月PM平台成本综合情况统计"
    }
    return "PM平台成本综合情况统计"
}

function Month-Label($period, $offset) {
    if ($period -match "^(\d{4})-(\d{2})$") {
        $date = Get-Date -Year ([int]$Matches[1]) -Month ([int]$Matches[2]) -Day 1
        $target = $date.AddMonths($offset)
        return "$([int]$target.Month)月"
    }
    if ($offset -eq -2) { return "4月" }
    if ($offset -eq -1) { return "5月" }
    return "6月"
}

function Clear-SheetRows($ws, $startRow) {
    $lastRow = $ws.UsedRange.Rows.Count
    if ($lastRow -lt $startRow) { return }
    for ($r = $startRow; $r -le $lastRow; $r++) {
        $lastCol = [Math]::Max($ws.UsedRange.Columns.Count, 15)
        for ($c = 1; $c -le $lastCol; $c++) {
            Clear-CellSafe $ws.Cells.Item($r, $c)
        }
    }
}

function Copy-RowFormat($ws, $sourceRow, $targetRow, $lastCol) {
    try {
        $ws.Range($ws.Cells.Item($sourceRow, 1), $ws.Cells.Item($sourceRow, $lastCol)).Copy() | Out-Null
        $ws.Range($ws.Cells.Item($targetRow, 1), $ws.Cells.Item($targetRow, $lastCol)).PasteSpecial(-4122) | Out-Null
    }
    catch {}
}

New-Item -ItemType Directory -Path (Split-Path -Parent $OutputPath) -Force | Out-Null
Copy-Item -LiteralPath $TemplatePath -Destination $OutputPath -Force

$data = Get-Content -LiteralPath $JsonPath -Encoding UTF8 | ConvertFrom-Json
$projects = @($data.projects)
$detailHealth = $data.detailHealth
$placeholderCount = Number-OrZero $detailHealth.placeholder
$realDetailCount = Number-OrZero $detailHealth.real

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false

try {
    $wb = $excel.Workbooks.Open($OutputPath)
    $ws = $wb.Worksheets.Item("Sheet1")
    $lastRow = $ws.UsedRange.Rows.Count

    $ws.Cells.Item(1, 1).Value2 = Period-Title $Period
    $detailNote = if ($placeholderCount -gt 0) { "其中真实红蓝明细$([int]$realDetailCount)条、汇总占位$([int]$placeholderCount)条；占位行表示平台汇总已抓到但项目明细待补抓。" } else { "红蓝明细与柱状图一致。" }
    $ws.Cells.Item(2, 1).Value2 = "说明：按平台正向路径 领导查询-成本综合情况(总)-项目状态在建 统计；本次全公司在建$($data.totals.inProgress)个，红色$($data.totals.red)个、蓝色$($data.totals.blue)个，$detailNote"
    $ws.Cells.Item(3, 2).Value2 = Month-Label $Period -2
    $ws.Cells.Item(3, 3).Value2 = Month-Label $Period -1
    $ws.Cells.Item(3, 4).Value2 = Month-Label $Period 0

    $matched = New-Object System.Collections.Generic.List[object]
    $unmatched = New-Object System.Collections.Generic.List[object]
    try { $ws.Range("A5:A$lastRow").UnMerge() | Out-Null } catch {}
    Clear-SheetRows $ws 5

    $sortedProjects = @(Sort-ProjectsForReport $projects)
    $row = 5
    $currentCompany = ""
    $companyStartRow = 0
    foreach ($p in $sortedProjects) {
        Copy-RowFormat $ws 5 $row 15
        $companyName = Project-CompanyName $p
        if ($companyName -ne $currentCompany) {
            if ($companyStartRow -gt 0 -and ($row - $companyStartRow) -gt 1) {
                try {
                    $range = $ws.Range($ws.Cells.Item($companyStartRow, 1), $ws.Cells.Item($row - 1, 1))
                    $range.Merge() | Out-Null
                    $range.VerticalAlignment = -4108
                }
                catch {}
            }
            $currentCompany = $companyName
            $companyStartRow = $row
            $ws.Cells.Item($row, 1).Value2 = $companyName
        }
        $matched.Add($p) | Out-Null
        Set-ProjectValues $ws $row $p $Period
        $row += 1
    }
    if ($companyStartRow -gt 0 -and ($row - $companyStartRow) -gt 1) {
        try {
            $range = $ws.Range($ws.Cells.Item($companyStartRow, 1), $ws.Cells.Item($row - 1, 1))
            $range.Merge() | Out-Null
            $range.VerticalAlignment = -4108
        }
        catch {}
    }
    $lastDataRow = [Math]::Max(5, $row - 1)
    $ws.Range("E5:H$lastDataRow").NumberFormat = "0.00"
    $ws.Range("J5:J$lastDataRow").NumberFormat = "0.00"
    if ($lastRow -gt $lastDataRow) {
        try {
            $ws.Rows("$($lastDataRow + 1):$lastRow").Delete() | Out-Null
        }
        catch {}
    }

    $newWs = $wb.Worksheets.Item("新增待评估")
    Clear-SheetRows $newWs 2

    $checkWs = $wb.Worksheets.Item("统计校验")
    Clear-SheetRows $checkWs 1
    $checkWs.Cells.Item(1, 1).Value2 = "数据来源"
    $checkWs.Cells.Item(1, 2).Value2 = [string]$data.source.menuPath
    $checkWs.Cells.Item(2, 1).Value2 = "项目状态"
    $checkWs.Cells.Item(2, 2).Value2 = [string]$data.source.projectStatus
    $checkWs.Cells.Item(3, 1).Value2 = "在建合计"
    $checkWs.Cells.Item(3, 2).Value2 = [double]$data.totals.inProgress
    $checkWs.Cells.Item(4, 1).Value2 = "完成责任目标"
    $checkWs.Cells.Item(4, 2).Value2 = [double]$data.totals.normal
    $checkWs.Cells.Item(5, 1).Value2 = "蓝色预警"
    $checkWs.Cells.Item(5, 2).Value2 = [double]$data.totals.blue
    $checkWs.Cells.Item(6, 1).Value2 = "红色预警"
    $checkWs.Cells.Item(6, 2).Value2 = [double]$data.totals.red
    $checkWs.Cells.Item(7, 1).Value2 = "红蓝明细"
    $checkWs.Cells.Item(7, 2).Value2 = [double]$data.totals.detailProjects
    $checkWs.Cells.Item(8, 1).Value2 = "真实红蓝明细"
    $checkWs.Cells.Item(8, 2).Value2 = [double]$realDetailCount
    $checkWs.Cells.Item(9, 1).Value2 = "汇总占位"
    $checkWs.Cells.Item(9, 2).Value2 = [double]$placeholderCount
    $checkWs.Cells.Item(10, 1).Value2 = "主表行数"
    $checkWs.Cells.Item(10, 2).Value2 = [double]$matched.Count
    $checkWs.Cells.Item(11, 1).Value2 = "新增待评估"
    $checkWs.Cells.Item(11, 2).Value2 = [double]$unmatched.Count
    $summaryHeaders = @("单位","完成责任目标","蓝色预警","红色预警","在建合计","蓝明细校验","红明细校验")
    for ($c = 1; $c -le $summaryHeaders.Count; $c++) {
        $checkWs.Cells.Item(13, $c).Value2 = $summaryHeaders[$c - 1]
    }
    $summaryByCompany = @{}
    foreach ($company in @($data.companies)) {
        $name = Project-CompanyName $company
        if (-not $summaryByCompany.ContainsKey($name)) {
            $summaryByCompany[$name] = [ordered]@{
                company = $name
                normal = 0.0
                blue = 0.0
                red = 0.0
                total = 0.0
                blueActual = 0.0
                blueExpected = 0.0
                redActual = 0.0
                redExpected = 0.0
            }
        }
        $summaryByCompany[$name].normal += Number-OrZero $company.normal
        $summaryByCompany[$name].blue += Number-OrZero $company.blue
        $summaryByCompany[$name].red += Number-OrZero $company.red
        $summaryByCompany[$name].total += Number-OrZero $company.total
    }
    foreach ($check in @($data.listChecks)) {
        $name = Project-CompanyName $check
        if (-not $summaryByCompany.ContainsKey($name)) {
            $summaryByCompany[$name] = [ordered]@{
                company = $name
                normal = 0.0
                blue = 0.0
                red = 0.0
                total = 0.0
                blueActual = 0.0
                blueExpected = 0.0
                redActual = 0.0
                redExpected = 0.0
            }
        }
        $summaryByCompany[$name].blueActual += Number-OrZero $check.blueActual
        $summaryByCompany[$name].blueExpected += Number-OrZero $check.blueExpected
        $summaryByCompany[$name].redActual += Number-OrZero $check.redActual
        $summaryByCompany[$name].redExpected += Number-OrZero $check.redExpected
    }
    $summaryRows = @($summaryByCompany.Values | Sort-Object @{ Expression = { Company-OrderIndex $_.company }; Ascending = $true }, @{ Expression = { $_.company }; Ascending = $true })
    $row = 14
    foreach ($company in $summaryRows) {
        $checkWs.Cells.Item($row, 1).Value2 = [string]$company.company
        $checkWs.Cells.Item($row, 2).Value2 = [double]$company.normal
        $checkWs.Cells.Item($row, 3).Value2 = [double]$company.blue
        $checkWs.Cells.Item($row, 4).Value2 = [double]$company.red
        $checkWs.Cells.Item($row, 5).Value2 = [double]$company.total
        $checkWs.Cells.Item($row, 6).NumberFormat = "@"
        $checkWs.Cells.Item($row, 7).NumberFormat = "@"
        $checkWs.Cells.Item($row, 6).Value2 = ([string][int]$company.blueActual + "/" + [string][int]$company.blueExpected)
        $checkWs.Cells.Item($row, 7).Value2 = ([string][int]$company.redActual + "/" + [string][int]$company.redExpected)
        $row += 1
    }

    $ws.Activate() | Out-Null
    $wb.Save()
    $wb.Close($true)
    Write-Output "output=$OutputPath"
    Write-Output ("matched=" + $matched.Count + " unmatched=" + $unmatched.Count)
}
finally {
    if ($null -ne $checkWs) { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($checkWs) | Out-Null }
    if ($null -ne $newWs) { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($newWs) | Out-Null }
    if ($null -ne $ws) { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($ws) | Out-Null }
    if ($null -ne $wb) { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($wb) | Out-Null }
    $excel.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
}
