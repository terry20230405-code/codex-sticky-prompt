param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 19177
)

$ErrorActionPreference = 'Stop'
$runtime = Join-Path $PSScriptRoot '.runtime'
$statePath = Join-Path $runtime 'state.json'
$injector = Join-Path $PSScriptRoot 'injector.mjs'
if (Test-Path -LiteralPath $statePath) {
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $Port = [int]$state.port
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($state.injectorPid)"
    if ($process -and $process.CommandLine -like "*$injector*") {
        Stop-Process -Id $state.injectorPid -Force
    }
    Remove-Item -LiteralPath $statePath -Force
}

try {
    $node = (Get-Command node -ErrorAction Stop).Source
    & $node $injector --remove --port $Port
    if ($LASTEXITCODE -ne 0) { throw '没有可连接的调试窗口。' }
    Write-Host '已移除吸顶层。Codex 可以继续运行。'
} catch {
    Write-Host '注入器已停止。当前 Codex 没有可连接的调试窗口，界面会在下次加载时恢复原状。'
}
