param([switch]$StartMenuOnly)

$ErrorActionPreference = 'Stop'
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path -LiteralPath $powershell)) { throw "未找到 Windows PowerShell：$powershell" }
$package = Get-AppxPackage -Name 'OpenAI.Codex' | Sort-Object Version -Descending | Select-Object -First 1
if (-not $package) { throw '未找到 Codex 桌面端。' }
$appExe = Join-Path $package.InstallLocation 'app\ChatGPT.exe'
$startScript = Join-Path $PSScriptRoot 'Start-CodexStickyPrompt.ps1'
$arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $startScript + '" -ShowDialog'
$links = @((Join-Path ([Environment]::GetFolderPath('Programs')) 'Codex 吸顶版.lnk'))
if (-not $StartMenuOnly) {
    $links += Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'Codex 吸顶版.lnk'
}
$shell = New-Object -ComObject WScript.Shell
foreach ($link in $links) {
    $folder = Split-Path -Parent $link
    New-Item -ItemType Directory -Path $folder -Force | Out-Null
    if (Test-Path -LiteralPath $link) {
        $existing = $shell.CreateShortcut($link)
        if ($existing.Arguments -notlike "*$startScript*") {
            throw "快捷方式已存在且不属于本工具：$link"
        }
    }
    $shortcut = $shell.CreateShortcut($link)
    $shortcut.TargetPath = $powershell
    $shortcut.Arguments = $arguments
    $shortcut.WorkingDirectory = $PSScriptRoot
    $shortcut.IconLocation = "$appExe,0"
    $shortcut.Description = '启动 Codex 并自动启用提问吸顶'
    $shortcut.Save()
    Write-Host "已创建：$link"
}
