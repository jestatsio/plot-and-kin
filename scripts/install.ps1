# Windows x64 bootstrap. Run from Windows PowerShell 5.1 or PowerShell 7.
# Optional: $env:PLOT_AND_KIN_VERSION = '0.1.0'
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$SetupArguments)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'This installer supports Windows. macOS uses install.sh.' }
$architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
if ($architecture -ne 'AMD64') { throw 'The current Plot & Kin Windows release supports x64 PCs. ARM64 is not yet validated.' }
$releaseBase = 'https://github.com/jestatsio/plot-and-kin/releases'
$runtimeRoot = if ($env:PLOT_AND_KIN_INSTALL_ROOT) { [IO.Path]::GetFullPath($env:PLOT_AND_KIN_INSTALL_ROOT) } else { Join-Path ([Environment]::GetFolderPath('UserProfile')) '.plot-and-kin\runtime' }
$versions = Join-Path $runtimeRoot 'versions'
New-Item -ItemType Directory -Force -Path $versions | Out-Null
$lock = Join-Path $runtimeRoot 'install.lock'
# FileMode.CreateNew fails atomically when another installer owns the lock.
try { $lockHandle = [IO.File]::Open($lock, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None) }
catch { throw 'Another installation is active. If it was interrupted, remove the runtime install.lock file and try again.' }
$work = Join-Path $runtimeRoot ('.install-' + [Guid]::NewGuid().ToString('N'))
function Get-ReleaseFile([string]$Url, [string]$Destination) {
    try { Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Destination -TimeoutSec 300 }
    catch { throw 'A tested release could not be downloaded. Check your connection and the GitHub Releases page. Your research and client settings have not been changed.' }
}
try {
    New-Item -ItemType Directory -Path $work | Out-Null
    $version = $env:PLOT_AND_KIN_VERSION
    if (-not $version) {
        Get-ReleaseFile "$releaseBase/latest/download/version.txt" (Join-Path $work 'version.txt')
        $version = (Get-Content -Raw -LiteralPath (Join-Path $work 'version.txt')).Trim()
    }
    if ($version -notmatch '^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$') { throw 'The release version is invalid.' }
    $asset = "plot-and-kin-$version-win32-x64.zip"
    $url = "$releaseBase/download/v$version"
    Write-Host "Downloading Plot & Kin $version for Windows x64..."
    $checksums = Join-Path $work 'SHA256SUMS.txt'
    $archive = Join-Path $work $asset
    Get-ReleaseFile "$url/SHA256SUMS.txt" $checksums
    Get-ReleaseFile "$url/$asset" $archive
    Write-Host 'Verifying the download...'
    $checksumLines = @(Get-Content -LiteralPath $checksums | Where-Object { $_ -match ('^[0-9a-f]{64}  ' + [regex]::Escape($asset) + '$') })
    if ($checksumLines.Count -ne 1) { throw 'The release does not contain one valid checksum for this PC.' }
    $expected = $checksumLines[0].Substring(0, 64)
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'The download checksum did not match. Nothing was activated. Run the installer again to retry the download.' }
    Write-Host 'Unpacking the runtime...'
    # The .NET API avoids the per-entry PowerShell pipeline overhead in Expand-Archive.
    # The two-argument overload works on Windows PowerShell 5.1 and rejects paths
    # that would escape the destination directory.
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($archive, $work)
    $extracted = Join-Path $work 'plot-and-kin'
    $target = Join-Path $versions "$version-win32-x64"
    $extractedNode = Join-Path $extracted 'bin\node.exe'
    if (-not (Test-Path -LiteralPath $extractedNode -PathType Leaf)) { throw 'The release is missing its runtime.' }
    Write-Host 'Checking the downloaded runtime...'
    & $extractedNode (Join-Path $extracted 'scripts\smoke-release.mjs') $version 'win32-x64'
    if ($LASTEXITCODE -ne 0) { throw 'The downloaded runtime did not pass its health check. Existing installations are preserved.' }
    [IO.File]::WriteAllText((Join-Path $extracted '.archive-sha256'), $expected)
    if (Test-Path -LiteralPath $target) {
        $marker = Join-Path $target '.archive-sha256'
        if (-not (Test-Path -LiteralPath $marker) -or (Get-Content -Raw -LiteralPath $marker).Trim() -ne $expected) { throw 'This version already exists with different contents. Existing installations were preserved. Choose a newer release or inspect the version directory.' }
        Write-Host 'Checking the existing installation...'
        & (Join-Path $target 'bin\node.exe') (Join-Path $target 'scripts\smoke-release.mjs') $version 'win32-x64'
        if ($LASTEXITCODE -ne 0) { throw 'The existing runtime failed its health check. Your research is preserved. Move the affected runtime version directory aside and run setup again.' }
    } else { Move-Item -LiteralPath $extracted -Destination $target }
} finally {
    if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
    $lockHandle.Dispose()
    Remove-Item -LiteralPath $lock -Force
}
Write-Host 'Runtime ready. Starting guided setup...'
& (Join-Path $target 'bin\node.exe') (Join-Path $target 'dist\cli.js') setup @SetupArguments
if ($LASTEXITCODE -ne 0) { throw 'Setup did not finish. Your installed runtime and any existing research were preserved. Run the command again to continue.' }
