param(
    [switch]$StartMenuOnly,
    [string]$ShortcutDirectory
)

$ErrorActionPreference = 'Stop'
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path -LiteralPath $powershell)) { throw "未找到 Windows PowerShell：$powershell" }
$package = Get-AppxPackage -Name 'OpenAI.Codex' | Sort-Object Version -Descending | Select-Object -First 1
if (-not $package) { throw '未找到 Codex 桌面端。' }
$appExe = Join-Path $package.InstallLocation 'app\ChatGPT.exe'
if (-not (Test-Path -LiteralPath $appExe)) { throw "未找到 Codex 可执行文件：$appExe" }
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node -or -not (Test-Path -LiteralPath $node)) {
    throw '未找到 Node.js。请先安装 22 或更新版本，并重新打开 PowerShell。'
}
$nodeVersion = & $node --version
$versionMatch = [regex]::Match($nodeVersion, '^v(?<major>\d+)\.')
if ($LASTEXITCODE -ne 0 -or -not $versionMatch.Success -or [int]$versionMatch.Groups['major'].Value -lt 22) {
    throw "需要 Node.js 22 或更新版本，当前版本：$nodeVersion"
}
$startScript = Join-Path $PSScriptRoot 'Start-CodexStickyPrompt.ps1'
$arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $startScript + '" -ShowDialog -NodePath "' + $node + '"'
if ($ShortcutDirectory) {
    $links = @((Join-Path $ShortcutDirectory 'Codex 吸顶版.lnk'))
} else {
    $links = @((Join-Path ([Environment]::GetFolderPath('Programs')) 'Codex 吸顶版.lnk'))
    if (-not $StartMenuOnly) {
        $links += Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'Codex 吸顶版.lnk'
    }
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
