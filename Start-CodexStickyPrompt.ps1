param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 19177,
    [switch]$ShowDialog
)

$ErrorActionPreference = 'Stop'
function Show-StartMessage {
    param([string]$Message)
    Write-Host $Message
    if ($ShowDialog) {
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show($Message, 'Codex 吸顶版') | Out-Null
    }
}
trap {
    Show-StartMessage "启动吸顶功能失败：$($_.Exception.Message)"
    exit 1
}
$package = Get-AppxPackage -Name 'OpenAI.Codex' | Sort-Object Version -Descending | Select-Object -First 1
if (-not $package) { throw '未找到通过 Windows 安装的 Codex 桌面端。' }
$appExe = Join-Path $package.InstallLocation 'app\ChatGPT.exe'
if (-not (Test-Path -LiteralPath $appExe)) { throw "未找到 Codex 可执行文件：$appExe" }
$node = (Get-Command node -ErrorAction Stop).Source
$injector = Join-Path $PSScriptRoot 'injector.mjs'
$runtime = Join-Path $PSScriptRoot '.runtime'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
$statePath = Join-Path $runtime 'state.json'

function Get-CodexProcesses {
    @(Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe'" | Where-Object {
        $_.ExecutablePath -eq $appExe
    })
}

function Get-DebugListener {
    $lines = & netstat -ano
    if ($LASTEXITCODE -ne 0) { throw '无法检查本机调试端口。' }
    $connections = @(foreach ($line in $lines) {
        if ($line -match '^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$' -and
            [int]$Matches[2] -eq $Port) {
            [pscustomobject]@{
                LocalAddress = $Matches[1].TrimStart('[').TrimEnd(']')
                OwningProcess = [int]$Matches[3]
            }
        }
    })
    if ($connections.Count -eq 0 -and ($lines | Select-String -Pattern ":$Port\s" -Quiet)) {
        return @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    }
    return $connections
}

function Assert-ListenerBelongsToCodex {
    param($Connections)
    foreach ($connection in $Connections) {
        if ($connection.LocalAddress -notin @('127.0.0.1', '::1')) {
            throw "调试端口 $Port 监听在 $($connection.LocalAddress)，不是本机回环地址。已停止连接。"
        }
        $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($connection.OwningProcess)"
        if (-not $owner -or $owner.ExecutablePath -ne $appExe) {
            throw "端口 $Port 被其他程序占用。已停止连接。"
        }
    }
}

$listeners = Get-DebugListener
if ($listeners.Count -gt 0) { Assert-ListenerBelongsToCodex $listeners }
$codexProcesses = Get-CodexProcesses

if ($listeners.Count -eq 0 -and $codexProcesses.Count -gt 0) {
    Show-StartMessage 'Codex 正在运行，但没有开启调试端口。任务结束后正常退出 Codex，再打开“Codex 吸顶版”即可。当前任务不会被中断。'
    exit 2
}

if ($listeners.Count -eq 0) {
    Write-Host "正在启动 Codex $($package.Version)，调试端口仅监听 127.0.0.1:$Port ..."
    Start-Process -FilePath $appExe -ArgumentList @(
        '--remote-debugging-address=127.0.0.1',
        "--remote-debugging-port=$Port"
    ) | Out-Null
    $deadline = (Get-Date).AddSeconds(35)
    do {
        Start-Sleep -Milliseconds 500
        $listeners = Get-DebugListener
    } until ($listeners.Count -gt 0 -or (Get-Date) -gt $deadline)
    if ($listeners.Count -eq 0) {
        throw 'Codex 已尝试启动，但调试端口未出现。请查看 Codex 是否正常打开；脚本不会结束应用进程。'
    }
    Assert-ListenerBelongsToCodex $listeners
}

if (Test-Path -LiteralPath $statePath) {
    try {
        $old = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
        $oldProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($old.injectorPid)"
        if ($oldProcess -and $oldProcess.CommandLine -like "*$injector*") {
            Write-Host "吸顶注入器已在运行，进程 ID $($old.injectorPid)。"
            exit 0
        }
    } catch { }
}

$stdout = Join-Path $runtime 'injector.stdout.log'
$stderr = Join-Path $runtime 'injector.stderr.log'
$readyFile = Join-Path $runtime 'injector.ready.json'
Remove-Item -LiteralPath $readyFile -Force -ErrorAction SilentlyContinue
$argumentLine = '"' + $injector + '" --port ' + $Port + ' --ready-file "' + $readyFile + '"'
$process = Start-Process -FilePath $node -ArgumentList $argumentLine -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
$deadline = (Get-Date).AddSeconds(15)
while (-not (Test-Path -LiteralPath $readyFile) -and -not $process.HasExited -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 100
    $process.Refresh()
}
if (-not (Test-Path -LiteralPath $readyFile)) {
    $details = if (Test-Path -LiteralPath $stderr) { Get-Content -LiteralPath $stderr -Raw } else { '' }
    throw "注入器未能连接 Codex。$details"
}
@{ injectorPid = $process.Id; port = $Port; appVersion = "$($package.Version)" } |
    ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
Write-Host "吸顶功能已启动。注入器进程 ID：$($process.Id)。"
Write-Host "查看诊断：node `"$injector`" --probe --port $Port"
Write-Host "关闭吸顶：运行 Stop-CodexStickyPrompt.ps1"
