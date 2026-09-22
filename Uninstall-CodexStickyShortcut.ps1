$ErrorActionPreference = 'Stop'
$startScript = Join-Path $PSScriptRoot 'Start-CodexStickyPrompt.ps1'
$links = @(
    (Join-Path ([Environment]::GetFolderPath('Programs')) 'Codex 吸顶版.lnk'),
    (Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'Codex 吸顶版.lnk')
)
$shell = New-Object -ComObject WScript.Shell
foreach ($link in $links) {
    if (-not (Test-Path -LiteralPath $link)) { continue }
    $shortcut = $shell.CreateShortcut($link)
    if ($shortcut.Arguments -notlike "*$startScript*") {
        Write-Host "跳过非本工具的快捷方式：$link"
        continue
    }
    Remove-Item -LiteralPath $link -Force
    Write-Host "已移除：$link"
}
