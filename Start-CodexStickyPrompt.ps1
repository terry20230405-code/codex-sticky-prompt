param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 19177,
    [switch]$ShowDialog,
    [string]$NodePath
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

function Start-PackagedCodex {
    param(
        [Parameter(Mandatory = $true)][string]$AppUserModelId,
        [Parameter(Mandatory = $true)][string]$Arguments
    )
    if (-not ('CodexStickyPrompt.PackageActivator' -as [type])) {
        $source = @'
using System;
using System.Runtime.InteropServices;

namespace CodexStickyPrompt {
    [ComImport]
    [Guid("2E941141-7F97-4756-BA1D-9DECDE894A3D")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IApplicationActivationManager {
        [PreserveSig]
        int ActivateApplication(
            [MarshalAs(UnmanagedType.LPWStr)] string appUserModelId,
            [MarshalAs(UnmanagedType.LPWStr)] string arguments,
            uint options,
            out uint processId);
    }

    [ComImport]
    [Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")]
    class ApplicationActivationManager { }

    public static class PackageActivator {
        public static uint Activate(string appUserModelId, string arguments) {
            var manager = (IApplicationActivationManager)new ApplicationActivationManager();
            uint processId;
            int result = manager.ActivateApplication(appUserModelId, arguments, 0, out processId);
            Marshal.ThrowExceptionForHR(result);
            return processId;
        }
    }
}
'@
        Add-Type -TypeDefinition $source -Language CSharp
    }
    return [CodexStickyPrompt.PackageActivator]::Activate($AppUserModelId, $Arguments)
}

$package = Get-AppxPackage -Name 'OpenAI.Codex' | Sort-Object Version -Descending | Select-Object -First 1
if (-not $package) { throw '未找到通过 Windows 安装的 Codex 桌面端。' }
$appExe = Join-Path $package.InstallLocation 'app\ChatGPT.exe'
if (-not (Test-Path -LiteralPath $appExe)) { throw "未找到 Codex 可执行文件：$appExe" }
$manifest = Get-AppxPackageManifest -Package $package
$application = @($manifest.Package.Applications.Application) | Where-Object {
    ("$($_.Executable)" -replace '\\', '/') -ieq 'app/ChatGPT.exe'
} | Select-Object -First 1
if (-not $application) { throw '未在 Codex 应用包中找到桌面端启动入口。' }
$appUserModelId = "$($package.PackageFamilyName)!$($application.Id)"
$node = if ($NodePath) { $NodePath } else { (Get-Command node -ErrorAction SilentlyContinue).Source }
if (-not $node -or -not (Test-Path -LiteralPath $node)) {
    throw '未找到 Node.js。请安装 22 或更新版本，并重新创建快捷方式。'
}
$nodeVersion = & $node --version
$versionMatch = [regex]::Match($nodeVersion, '^v(?<major>\d+)\.')
if ($LASTEXITCODE -ne 0 -or -not $versionMatch.Success -or [int]$versionMatch.Groups['major'].Value -lt 22) {
    throw "需要 Node.js 22 或更新版本，当前版本：$nodeVersion"
}
$injector = Join-Path $PSScriptRoot 'injector.mjs'
$runtime = Join-Path $PSScriptRoot '.runtime'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
$statePath = Join-Path $runtime 'state.json'
$compatibilityPath = Join-Path $runtime 'compatibility.json'
$previousVersion = $null
try {
    if (Test-Path -LiteralPath $compatibilityPath) {
        $previousVersion = (Get-Content -LiteralPath $compatibilityPath -Raw | ConvertFrom-Json).appVersion
    } elseif (Test-Path -LiteralPath $statePath) {
        $previousVersion = (Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json).appVersion
    }
} catch { }
$currentVersion = "$($package.Version)"
$versionChanged = $previousVersion -and $previousVersion -ne $currentVersion

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
    $message = if ($versionChanged) {
        "检测到 Codex 已从 $previousVersion 更新到 $currentVersion。更新后当前窗口没有吸顶连接；任务结束后完全退出 Codex，再打开【Codex 吸顶版】即可自动自检，无需重新安装。当前任务不会被中断。"
    } else {
        'Codex 正在运行，但没有开启吸顶连接。任务结束后完全退出 Codex，再打开【Codex 吸顶版】即可。当前任务不会被中断。'
    }
    Show-StartMessage $message
    exit 2
}

if ($listeners.Count -eq 0) {
    Write-Host "正在启动 Codex $($package.Version)，调试端口仅监听 127.0.0.1:$Port ..."
    $launchArguments = "--remote-debugging-address=127.0.0.1 --remote-debugging-port=$Port"
    $launchedProcessId = Start-PackagedCodex -AppUserModelId $appUserModelId -Arguments $launchArguments
    Write-Host "已通过 Windows 应用身份启动 Codex，进程 ID：$launchedProcessId。"
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
$ready = Get-Content -LiteralPath $readyFile -Raw | ConvertFrom-Json
if (-not $ready.probe.installed) {
    throw '注入器已连接 Codex，但启动自检未确认吸顶脚本。'
}
$hasConversation = [int]$ready.probe.scrollers -gt 0
$interfaceStatus = if (-not $hasConversation) {
    'waiting_for_conversation'
} elseif (-not $ready.probe.unavailable -and $ready.probe.toggleInstalled) {
    'verified'
} else {
    'needs_adaptation'
}
@{
    appVersion = $currentVersion
    overlayVersion = $ready.probe.version
    interfaceStatus = $interfaceStatus
    targetUrl = $ready.url
    verifiedAt = (Get-Date).ToString('o')
} | ConvertTo-Json | Set-Content -LiteralPath $compatibilityPath -Encoding utf8
@{ injectorPid = $process.Id; port = $Port; appVersion = $currentVersion } |
    ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
Write-Host "吸顶功能已启动。注入器进程 ID：$($process.Id)。"
if ($versionChanged) {
    Show-StartMessage "检测到 Codex 更新到 $currentVersion，吸顶脚本已自动完成启动自检。"
}
if ($interfaceStatus -eq 'needs_adaptation') {
    Show-StartMessage '吸顶脚本已经连接，但当前聊天界面没有通过完整自检。请检查吸顶内容和标题栏开关。'
}
Write-Host "查看诊断：node `"$injector`" --probe --port $Port"
Write-Host "关闭吸顶：运行 Stop-CodexStickyPrompt.ps1"
