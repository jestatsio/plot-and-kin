param([Parameter(ValueFromRemainingArguments = $true)][string[]]$ServerArguments)
# All runtime bytes are bundled. Extraction never contacts a server.
$ErrorActionPreference = 'Stop'
# A Windows PowerShell process launched from PowerShell 7 must load its own
# built-in modules. Native MCP output must stay UTF-8, including on PS 5.1.
$env:PSModulePath = [IO.Path]::Combine([Environment]::GetFolderPath('System'), 'WindowsPowerShell\v1.0\Modules')
[Console]::InputEncoding = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$pkExpected = '__PK_SHA256__'
$pkRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$pkPayload = Join-Path $pkRoot 'runtime.zip'
$pkRuntime = Join-Path $pkRoot "runtime-$pkExpected"
$pkNode = Join-Path $pkRuntime 'plot-and-kin-codex\plugins\plot-and-kin\bin\node.exe'
$pkCli = Join-Path $pkRuntime 'plot-and-kin-codex\plugins\plot-and-kin\dist\cli.js'
$pkLock = Join-Path $pkRoot '.runtime-lock'
$pkStage = $null
$pkLockHandle = $null
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
  & $pkNode '--disable-warning=ExperimentalWarning' $pkCli @ServerArguments
  exit $LASTEXITCODE
} catch {
  [Console]::Error.WriteLine('Plot & Kin: ' + $_.Exception.Message)
  exit 1
} finally {
  if ($null -ne $pkLockHandle) { $pkLockHandle.Dispose() }
  # Leave the empty lock file in place. Deleting it can race a second opener.
  if ($null -ne $pkStage -and (Test-Path -LiteralPath $pkStage)) { Remove-Item -LiteralPath $pkStage -Recurse -Force }
}
