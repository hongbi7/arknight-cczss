param(
    [string]$GameRoot = $env:ARKNIGHTS_GAME_ROOT,
    [string]$GameDataRoot = "",
    [switch]$SkipFetch,
    [switch]$SkipPublicAssets,
    [switch]$ForceAssets
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepoRoot = Split-Path -Parent $PSScriptRoot
$VenvRoot = Join-Path $RepoRoot ".venv"
$VenvPython = Join-Path $VenvRoot "Scripts\python.exe"
$DefaultGameRoot = "G:\game\Hypergryph Launcher\games\Arknights"

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
    )
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $Command $($Arguments -join ' ')"
    }
}

if ([string]::IsNullOrWhiteSpace($GameRoot) -and (Test-Path -LiteralPath $DefaultGameRoot -PathType Container)) {
    $GameRoot = $DefaultGameRoot
}
if ([string]::IsNullOrWhiteSpace($GameRoot) -or -not (Test-Path -LiteralPath $GameRoot -PathType Container)) {
    throw "Arknights game directory was not found. Pass -GameRoot or set ARKNIGHTS_GAME_ROOT."
}

if (Test-Path -LiteralPath $VenvRoot) {
    if (-not (Test-Path -LiteralPath $VenvPython -PathType Leaf)) {
        throw "A partial .venv from an earlier installation exists at $VenvRoot. Move it aside, then rerun the updater."
    }
    Invoke-Native $VenvPython --version
} else {
    $SystemPython = (Get-Command python -ErrorAction Stop).Source
    Invoke-Native $SystemPython -m venv $VenvRoot
}

$Npm = (Get-Command npm -ErrorAction Stop).Source

Push-Location $RepoRoot
try {
    Invoke-Native $VenvPython -m pip install --disable-pip-version-check -r scripts/requirements-data.txt -r scripts/requirements-public-assets.txt -r scripts/requirements-art.txt
    Invoke-Native $Npm ci --ignore-scripts

    $UpdateArguments = @(
        "scripts/update_game_data.py",
        "--game-root", $GameRoot
    )
    if (-not [string]::IsNullOrWhiteSpace($GameDataRoot)) {
        $UpdateArguments += @("--gamedata-root", $GameDataRoot)
    }
    if ($SkipFetch) {
        $UpdateArguments += "--skip-fetch"
    }
    if ($ForceAssets) {
        $UpdateArguments += "--force-assets"
    }
    if ($SkipPublicAssets) {
        $UpdateArguments += "--skip-public-assets"
    }
    Invoke-Native $VenvPython @UpdateArguments
} finally {
    Pop-Location
}
