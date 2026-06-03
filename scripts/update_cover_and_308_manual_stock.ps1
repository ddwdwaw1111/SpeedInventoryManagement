param(
  [string]$DownloadsCover = "C:\Users\zihao\Downloads\99_600_cover_check_accurate_2026-06-02.xlsx",
  [string]$ExportsCover = "C:\Users\zihao\Desktop\Projects\SpeedInventoryManagement\exports\99_600_cover_check_accurate_2026-06-02.xlsx",
  [string]$Inventory308 = "C:\Users\zihao\Downloads\308仓_05_29_仓库点货单.xlsx"
)

$ErrorActionPreference = "Stop"

$manual = @(
  [pscustomobject]@{ Item="51807"; Sku="004586"; CtnPerPallet=200; Pallets=10; Qty=2000 },
  [pscustomobject]@{ Item="11803"; Sku="004593"; CtnPerPallet=162; Pallets=3;  Qty=486  },
  [pscustomobject]@{ Item="51803"; Sku="004555"; CtnPerPallet=200; Pallets=26; Qty=5200 },
  [pscustomobject]@{ Item="51808"; Sku="004579"; CtnPerPallet=190; Pallets=7;  Qty=1330 },
  [pscustomobject]@{ Item="12408"; Sku="011621"; CtnPerPallet=48;  Pallets=2;  Qty=96   }
)

$manualByItem = @{}
foreach ($row in $manual) {
  $manualByItem[$row.Item] = $row
}

function To-Double($value) {
  if ($null -eq $value -or $value -eq "") { return 0.0 }
  return [double]$value
}

function Backup-Workbook($path) {
  if (!(Test-Path -LiteralPath $path)) { return }
  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $backup = "$path.bak_$stamp"
  Copy-Item -LiteralPath $path -Destination $backup -Force
}

function Get-Or-Create-Sheet($workbook, [string]$name) {
  foreach ($sheet in @($workbook.Worksheets)) {
    if ($sheet.Name -eq $name) { return $sheet }
  }
  $newSheet = $workbook.Worksheets.Add()
  $newSheet.Name = $name
  return $newSheet
}

function Update-CoverWorkbook($excel, [string]$path) {
  if (!(Test-Path -LiteralPath $path)) { return $null }

  Backup-Workbook $path
  $wb = $excel.Workbooks.Open($path)
  try {
    $ws = $wb.Worksheets.Item("cover检查")
    $ws.Cells.Item(1, 8).Value2 = "99+600+新增可用Qty"
    $ws.Cells.Item(1, 14).Value2 = "新增确认Qty"
    $ws.Cells.Item(1, 15).Value2 = "新增确认托数"
    $ws.Cells.Item(1, 16).Value2 = "每板ctn"
    $ws.Cells.Item(1, 17).Value2 = "建议新增拿Qty"
    $ws.Cells.Item(1, 18).Value2 = "加新增后说明"

    $lastRow = $ws.UsedRange.Row + $ws.UsedRange.Rows.Count - 1
    for ($r = 2; $r -le $lastRow; $r++) {
      $item = [string]$ws.Cells.Item($r, 1).Value2
      if (!$manualByItem.ContainsKey($item)) { continue }

      $m = $manualByItem[$item]
      $need = To-Double $ws.Cells.Item($r, 3).Value2
      $qty99 = To-Double $ws.Cells.Item($r, 4).Value2
      $qty600 = To-Double $ws.Cells.Item($r, 6).Value2
      $oldAvailable = $qty99 + $qty600
      $updatedAvailable = $oldAvailable + $m.Qty
      $shortAfter = [Math]::Max($need - $updatedAvailable, 0)
      $manualPick = [Math]::Min($m.Qty, [Math]::Max($need - $oldAvailable, 0))

      $ws.Cells.Item($r, 8).Value2 = $updatedAvailable
      $ws.Cells.Item($r, 9).Value2 = if ($shortAfter -le 0) { "能cover" } else { "不能cover" }
      $ws.Cells.Item($r, 10).Value2 = $shortAfter
      $ws.Cells.Item($r, 14).Value2 = $m.Qty
      $ws.Cells.Item($r, 15).Value2 = $m.Pallets
      $ws.Cells.Item($r, 16).Value2 = $m.CtnPerPallet
      $ws.Cells.Item($r, 17).Value2 = $manualPick
      $ws.Cells.Item($r, 18).Value2 = "新增手工确认：$($m.Pallets)板 x $($m.CtnPerPallet)ctn = $($m.Qty)ctn"

      $oldNote = [string]$ws.Cells.Item($r, 13).Value2
      $ws.Cells.Item($r, 13).Value2 = if ([string]::IsNullOrWhiteSpace($oldNote)) {
        "已加入新增手工确认库存"
      } else {
        "$oldNote；已加入新增手工确认库存"
      }
    }

    $stats = [ordered]@{
      NeedTotal = 0.0
      CoverRows = 0
      NotCoverRows = 0
      ShortTotal = 0.0
      Pick99Total = 0.0
      Pick600Total = 0.0
      ManualQtyTotal = 0.0
      ManualPickTotal = 0.0
    }

    for ($r = 2; $r -le $lastRow; $r++) {
      if ($null -eq $ws.Cells.Item($r, 1).Value2 -or $ws.Cells.Item($r, 1).Value2 -eq "") { continue }
      $stats.NeedTotal += To-Double $ws.Cells.Item($r, 3).Value2
      $stats.ShortTotal += To-Double $ws.Cells.Item($r, 10).Value2
      $stats.Pick99Total += To-Double $ws.Cells.Item($r, 11).Value2
      $stats.Pick600Total += To-Double $ws.Cells.Item($r, 12).Value2
      $stats.ManualQtyTotal += To-Double $ws.Cells.Item($r, 14).Value2
      $stats.ManualPickTotal += To-Double $ws.Cells.Item($r, 17).Value2
      if ([string]$ws.Cells.Item($r, 9).Value2 -eq "能cover") { $stats.CoverRows++ } else { $stats.NotCoverRows++ }
    }

    foreach ($sheet in @($wb.Worksheets)) {
      if ($sheet.Name -ne "汇总说明") { continue }
      $summary = $sheet
      $summaryLast = $summary.UsedRange.Row + $summary.UsedRange.Rows.Count - 1
      for ($r = 1; $r -le $summaryLast; $r++) {
        $label = [string]$summary.Cells.Item($r, 1).Value2
        switch ($label) {
          "能完全cover行数" { $summary.Cells.Item($r, 2).Value2 = $stats.CoverRows }
          "不能完全cover行数" { $summary.Cells.Item($r, 2).Value2 = $stats.NotCoverRows }
          "总需补Qty" { $summary.Cells.Item($r, 2).Value2 = $stats.NeedTotal }
          "建议99拿Qty合计" { $summary.Cells.Item($r, 2).Value2 = $stats.Pick99Total }
          "建议600拿Qty合计" { $summary.Cells.Item($r, 2).Value2 = $stats.Pick600Total }
          "补完仍缺Qty合计" { $summary.Cells.Item($r, 2).Value2 = $stats.ShortTotal }
        }
      }
      $append = $summaryLast + 1
      $summary.Cells.Item($append, 1).Value2 = "新增确认Qty合计"
      $summary.Cells.Item($append, 2).Value2 = $stats.ManualQtyTotal
      $summary.Cells.Item($append + 1, 1).Value2 = "建议新增拿Qty合计"
      $summary.Cells.Item($append + 1, 2).Value2 = $stats.ManualPickTotal
      $summary.Cells.Item($append + 2, 1).Value2 = "更新说明"
      $summary.Cells.Item($append + 2, 2).Value2 = "H/I/J已按99+600原有库存加本次手工确认库存重算；N:R保留新增库存明细。"
    }

    $newWs = Get-Or-Create-Sheet $wb "新增手工确认库存"
    $newWs.Cells.Clear()
    $headers = @("客户货号", "SKU", "每板ctn", "新增托数", "新增Qty")
    for ($c = 1; $c -le $headers.Count; $c++) {
      $newWs.Cells.Item(1, $c).Value2 = $headers[$c - 1]
    }
    for ($i = 0; $i -lt $manual.Count; $i++) {
      $m = $manual[$i]
      $r = $i + 2
      $newWs.Cells.Item($r, 1).Value2 = $m.Item
      $newWs.Cells.Item($r, 2).Value2 = $m.Sku
      $newWs.Cells.Item($r, 3).Value2 = $m.CtnPerPallet
      $newWs.Cells.Item($r, 4).Value2 = $m.Pallets
      $newWs.Cells.Item($r, 5).Value2 = $m.Qty
    }
    $newWs.Columns.AutoFit() | Out-Null
    $ws.Columns.AutoFit() | Out-Null
    $wb.Save()
    return $stats
  } finally {
    $wb.Close($true)
  }
}

function Find-Row-By-Value($ws, [int]$col, [string]$value, [int]$startRow, [int]$endRow) {
  for ($r = $startRow; $r -le $endRow; $r++) {
    if ([string]$ws.Cells.Item($r, $col).Value2 -eq $value) { return $r }
  }
  return $null
}

function Find-Total-Row($ws) {
  $lastRow = $ws.UsedRange.Row + $ws.UsedRange.Rows.Count + 10
  for ($r = 1; $r -le $lastRow; $r++) {
    if ([string]$ws.Cells.Item($r, 3).Value2 -eq "Left Total:") { return $r }
  }
  return $lastRow
}

function Put-Inventory-Row($ws, [int]$row, $m) {
  $ws.Cells.Item($row, 1).Value2 = $m.Item
  $ws.Cells.Item($row, 2).Value2 = $m.Sku
  $ws.Cells.Item($row, 3).Value2 = $m.CtnPerPallet
  $ws.Cells.Item($row, 4).Value2 = $m.Qty
  $ws.Cells.Item($row, 5).Value2 = $m.Pallets
}

function Update-Inventory308($excel, [string]$path) {
  if (!(Test-Path -LiteralPath $path)) { throw "Missing 308 workbook: $path" }

  Backup-Workbook $path
  $wb = $excel.Workbooks.Open($path)
  try {
    $details = $wb.Worksheets.Item("Inventory Details")

    foreach ($m in $manual) {
      $totalRow = Find-Total-Row $details
      $usedLast = $details.UsedRange.Row + $details.UsedRange.Rows.Count + 10
      $existingLeft = Find-Row-By-Value $details 1 $m.Item 3 $usedLast
      $existingRight = Find-Row-By-Value $details 6 $m.Item 3 $usedLast

      if ($null -ne $existingLeft) {
        Put-Inventory-Row $details $existingLeft $m
        continue
      }
      if ($null -ne $existingRight) {
        $details.Cells.Item($existingRight, 6).Value2 = $m.Item
        $details.Cells.Item($existingRight, 7).Value2 = $m.Sku
        $details.Cells.Item($existingRight, 8).Value2 = $m.CtnPerPallet
        $details.Cells.Item($existingRight, 9).Value2 = $m.Qty
        $details.Cells.Item($existingRight, 10).Value2 = $m.Pallets
        continue
      }

      $targetRow = $null
      for ($r = 3; $r -lt $totalRow; $r++) {
        if ([string]::IsNullOrWhiteSpace([string]$details.Cells.Item($r, 1).Value2)) {
          $targetRow = $r
          break
        }
      }
      if ($null -eq $targetRow) {
        $details.Rows.Item($totalRow).Insert() | Out-Null
        $targetRow = $totalRow
      }
      Put-Inventory-Row $details $targetRow $m
    }

    $totalRow = Find-Total-Row $details
    $lastDataRow = $totalRow - 1
    $details.Cells.Item($totalRow, 3).Value2 = "Left Total:"
    $details.Cells.Item($totalRow, 4).Formula = "=SUM(D3:D$lastDataRow)"
    $details.Cells.Item($totalRow, 5).Formula = "=SUM(E3:E$lastDataRow)"
    $details.Cells.Item($totalRow, 8).Value2 = "Right Total:"
    $details.Cells.Item($totalRow, 9).Formula = "=SUM(I3:I$lastDataRow)"
    $details.Cells.Item($totalRow, 10).Formula = "=SUM(J3:J$lastDataRow)"
    $details.Columns.AutoFit() | Out-Null

    $norm = $wb.Worksheets.Item("Normalized Data List")
    $normLast = $norm.UsedRange.Row + $norm.UsedRange.Rows.Count - 1
    foreach ($m in $manual) {
      $targetRow = Find-Row-By-Value $norm 1 $m.Item 2 ($normLast + 20)
      if ($null -eq $targetRow) {
        $normLast++
        $targetRow = $normLast
      }
      $norm.Cells.Item($targetRow, 1).Value2 = $m.Item
      $norm.Cells.Item($targetRow, 2).Value2 = $m.Sku
      $norm.Cells.Item($targetRow, 3).Value2 = $m.CtnPerPallet
      $norm.Cells.Item($targetRow, 4).Value2 = $m.Qty
      $norm.Cells.Item($targetRow, 5).Value2 = $m.Pallets
    }
    $norm.Columns.AutoFit() | Out-Null
    $wb.Save()
  } finally {
    $wb.Close($true)
  }
}

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$excel.AskToUpdateLinks = $false

try {
  $coverStats = @()
  $coverStats += Update-CoverWorkbook $excel $DownloadsCover
  $coverStats += Update-CoverWorkbook $excel $ExportsCover
  Update-Inventory308 $excel $Inventory308
} finally {
  $excel.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}

"Updated cover workbooks and 308 inventory workbook."
