param([Parameter(ValueFromRemainingArguments = $true)][string[]]$ServerArguments)
# All runtime bytes are bundled. Extraction never contacts a server.
$ErrorActionPreference = 'Stop'
# A Windows PowerShell process launched from PowerShell 7 must load its own
# built-in modules. The raw stream bridge below preserves UTF-8 bytes without
# setting console code pages, which fails when the client creates no console.
$env:PSModulePath = [IO.Path]::Combine([Environment]::GetFolderPath('System'), 'WindowsPowerShell\v1.0\Modules')
$pkExpected = '__PK_SHA256__'
$pkRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$pkPayload = Join-Path $pkRoot 'runtime.zip'
$pkRuntime = Join-Path $pkRoot "runtime-$pkExpected"
$pkNode = Join-Path $pkRuntime 'plot-and-kin-codex\plugins\plot-and-kin\bin\node.exe'
$pkCli = Join-Path $pkRuntime 'plot-and-kin-codex\plugins\plot-and-kin\dist\cli.js'
$pkLock = Join-Path $pkRoot '.runtime-lock'
$pkStage = $null
$pkLockHandle = $null
$pkChild = $null
$pkChildStarted = $false
function Write-PkTrace([string]$Stage) {
  if ($env:PK_LAUNCHER_TRACE -eq '1') { [Console]::Error.WriteLine('Plot & Kin launcher: ' + $Stage) }
}
function Test-PkReady {
  $pkMarker = Join-Path $pkRuntime '.payload-sha256'
  return ((Test-Path -LiteralPath $pkNode -PathType Leaf) -and (Test-Path -LiteralPath $pkCli -PathType Leaf) -and (Test-Path -LiteralPath $pkMarker -PathType Leaf) -and ([IO.File]::ReadAllText($pkMarker).Trim() -eq $pkExpected))
}
try {
  if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { throw 'Install the package matching your operating system and architecture.' }
  if (-not (Test-Path -LiteralPath $pkPayload -PathType Leaf)) { throw 'Bundled runtime archive is missing. Reinstall the plugin.' }
  if ((Get-Item -LiteralPath $pkPayload).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Bundled archive cannot be a link.' }
  if ((Get-FileHash -LiteralPath $pkPayload -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pkExpected) { throw 'Bundled runtime checksum failed. Reinstall the plugin.' }
  if (-not (Test-PkReady)) {
    for ($pkAttempt = 0; $pkAttempt -lt 60; $pkAttempt++) {
      try { $pkLockHandle = [IO.File]::Open($pkLock, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None); break }
      catch [IO.IOException] { Start-Sleep -Seconds 1 }
    }
    if ($null -eq $pkLockHandle) { throw 'Runtime extraction is busy. Close other sessions and retry.' }
    if (-not (Test-PkReady)) {
      if (Test-Path -LiteralPath $pkRuntime) { throw 'Runtime cache is damaged. Reinstall the plugin. Saved cases remain outside the plugin.' }
      $pkStage = Join-Path $pkRoot ('.runtime-stage-' + [Guid]::NewGuid().ToString('N'))
      Add-Type -AssemblyName System.IO.Compression.FileSystem
      [IO.Compression.ZipFile]::ExtractToDirectory($pkPayload, $pkStage)
      if (-not (Test-Path -LiteralPath (Join-Path $pkStage 'plot-and-kin-codex\plugins\plot-and-kin\bin\node.exe') -PathType Leaf)) { throw 'Runtime archive is incomplete.' }
      [IO.File]::WriteAllText((Join-Path $pkStage '.payload-sha256'), $pkExpected)
      [IO.Directory]::Move($pkStage, $pkRuntime)
      $pkStage = $null
    }
    $pkLockHandle.Dispose(); $pkLockHandle = $null
  }
  if ($ServerArguments.Count -ne 1 -or $ServerArguments[0] -ne 'serve') { throw 'This plugin launcher supports only the serve command.' }
  # PowerShell's native-command pipeline does not forward its redirected stdin
  # to the child and may decode/re-encode output. MCP requires a live duplex
  # byte stream, so bridge the three raw .NET streams concurrently instead.
  $pkStart = New-Object Diagnostics.ProcessStartInfo
  $pkStart.FileName = $pkNode
  $pkStart.Arguments = '--disable-warning=ExperimentalWarning "' + $pkCli + '" serve'
  $pkStart.UseShellExecute = $false
  $pkStart.CreateNoWindow = $true
  $pkStart.RedirectStandardInput = $true
  $pkStart.RedirectStandardOutput = $true
  $pkStart.RedirectStandardError = $true
  # Framework's Process.StandardInput.BaseStream is a buffered FileStream.
  # CopyToAsync does not flush after each write, so a small MCP request can sit
  # in its 4096-byte buffer while the client waits for a response. Preserve raw
  # bytes and flush each bounded chunk without PowerShell pipeline conversion.
  Add-Type -TypeDefinition @'
using System.IO;
using System.Threading.Tasks;
public static class PlotKinInputPump {
    public static async Task CopyAndFlushAsync(Stream input, Stream output) {
        byte[] buffer = new byte[8192];
        int count;
        while ((count = await input.ReadAsync(buffer, 0, buffer.Length).ConfigureAwait(false)) != 0) {
            await output.WriteAsync(buffer, 0, count).ConfigureAwait(false);
            await output.FlushAsync().ConfigureAwait(false);
        }
    }
}
'@
  $pkChild = New-Object Diagnostics.Process
  $pkChild.StartInfo = $pkStart
  Write-PkTrace 'before-start'
  if (-not $pkChild.Start()) { throw 'The bundled research server could not start.' }
  $pkChildStarted = $true
  Write-PkTrace 'after-start'
  Write-PkTrace 'before-input-copy'
  $pkInput = [PlotKinInputPump]::CopyAndFlushAsync([Console]::OpenStandardInput(), $pkChild.StandardInput.BaseStream)
  Write-PkTrace 'after-input-copy'
  Write-PkTrace 'before-output-copy'
  $pkOutput = $pkChild.StandardOutput.BaseStream.CopyToAsync([Console]::OpenStandardOutput())
  Write-PkTrace 'after-output-copy'
  Write-PkTrace 'before-error-copy'
  $pkErrors = $pkChild.StandardError.BaseStream.CopyToAsync([Console]::OpenStandardError())
  Write-PkTrace 'after-error-copy'
  $pkInputClosed = $false
  Write-PkTrace 'before-loop'
  while (-not $pkChild.WaitForExit(50)) {
    if (-not $pkInputClosed -and $pkInput.IsCompleted) {
      Write-PkTrace 'input-eof'
      # Propagate host EOF so Node and its SQLite handles exit with the client.
      $null = $pkInput.GetAwaiter().GetResult()
      $pkChild.StandardInput.Close()
      $pkInputClosed = $true
    }
    if ($pkOutput.IsFaulted -or $pkErrors.IsFaulted) { throw 'The client closed its MCP output stream.' }
  }
  Write-PkTrace 'after-loop'
  # Drain both output streams before returning the child's exit status.
  $null = $pkOutput.GetAwaiter().GetResult()
  $null = $pkErrors.GetAwaiter().GetResult()
  exit $pkChild.ExitCode
} catch {
  [Console]::Error.WriteLine('Plot & Kin: ' + $_.Exception.Message)
  exit 1
} finally {
  if ($null -ne $pkChild) {
    try { if ($pkChildStarted -and -not $pkChild.HasExited) { $pkChild.Kill(); $pkChild.WaitForExit() } }
    finally { $pkChild.Dispose() }
  }
  if ($null -ne $pkLockHandle) { $pkLockHandle.Dispose() }
  # Leave the empty lock file in place. Deleting it can race a second opener.
  if ($null -ne $pkStage -and (Test-Path -LiteralPath $pkStage)) { Remove-Item -LiteralPath $pkStage -Recurse -Force }
}
