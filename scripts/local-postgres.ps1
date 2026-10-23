[CmdletBinding()]
param(
    [ValidateSet('prepare', 'start', 'stop', 'status')][string]$Action = 'prepare',
    [string]$PostgresBin = 'C:\Program Files\PostgreSQL\17\bin'
)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$localRoot = Join-Path $projectRoot '.local'
$clusterPath = Join-Path $localRoot 'postgres'
$credentialsPath = Join-Path $localRoot 'credentials.json'
$markerPath = Join-Path $localRoot 'cluster.json'
$clusterPort = 55432
$pgctl = Join-Path $PostgresBin 'pg_ctl.exe'
$initdb = Join-Path $PostgresBin 'initdb.exe'
$psql = Join-Path $PostgresBin 'psql.exe'
foreach ($binary in @($pgctl, $initdb, $psql)) {
    if (-not (Test-Path -LiteralPath $binary -PathType Leaf)) { throw "No se encontró PostgreSQL: $binary" }
}

function Assert-OwnedCluster {
    if (-not (Test-Path -LiteralPath $markerPath)) { throw 'No existe marcador del cluster dedicado del restaurante.' }
    $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
    if ($marker.kind -ne 'restaurante-development-only' -or $marker.path -ne $clusterPath -or $marker.port -ne $clusterPort) {
        throw 'El marcador no corresponde al cluster de desarrollo esperado.'
    }
}

if ($Action -ne 'prepare') {
    Assert-OwnedCluster
    switch ($Action) {
        'start' { & $pgctl -D $clusterPath -l (Join-Path $localRoot 'postgres.log') -o "-h 127.0.0.1 -p $clusterPort" -w start }
        'stop' { & $pgctl -D $clusterPath -m fast -w stop }
        'status' { & $pgctl -D $clusterPath status }
    }
    if ($LASTEXITCODE -ne 0) { throw "PostgreSQL no completó la acción $Action." }
    return
}

if (Test-Path -LiteralPath $clusterPath) {
    Assert-OwnedCluster
} else {
    $null = New-Item -ItemType Directory -Path $localRoot -Force
    if (Test-Path -LiteralPath $credentialsPath) { throw 'Hay credenciales previas sin cluster; revisar manualmente, sin sobrescribir.' }
    $credentials = @{
        admin = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
        runtime = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
        hmac = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    }
    [IO.File]::WriteAllText($credentialsPath, ($credentials | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    $pwPath = Join-Path $localRoot 'initdb-password.txt'
    [IO.File]::WriteAllText($pwPath, $credentials.admin, [Text.UTF8Encoding]::new($false))
    & $initdb -D $clusterPath -U restaurante_dev_admin --pwfile=$pwPath --auth-host=scram-sha-256 --auth-local=scram-sha-256 --encoding=UTF8 --locale=C
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo inicializar el cluster dedicado; no se elimina ni reinicia automáticamente.' }
    [IO.File]::WriteAllText($markerPath, (@{ kind = 'restaurante-development-only'; path = $clusterPath; port = $clusterPort } | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
}

$credentials = Get-Content -LiteralPath $credentialsPath -Raw | ConvertFrom-Json
& $pgctl -D $clusterPath status *> $null
if ($LASTEXITCODE -ne 0) {
    & $pgctl -D $clusterPath -l (Join-Path $localRoot 'postgres.log') -o "-h 127.0.0.1 -p $clusterPort" -w start
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo arrancar PostgreSQL en loopback:55432; revisar .local/postgres.log.' }
}

$savedPgPassword = $env:PGPASSWORD
try {
    $env:PGPASSWORD = $credentials.admin
    $psqlArgs = @('-X', '-h', '127.0.0.1', '-p', "$clusterPort", '-U', 'restaurante_dev_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1')
    $roleSql = @'
DO $provision$
BEGIN
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='restaurante_auth_lookup') THEN
  CREATE ROLE restaurante_auth_lookup NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
 END IF;
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='restaurante_runtime') THEN
  CREATE ROLE restaurante_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
 END IF;
END
$provision$;
'@
    $roleSql += "`nALTER ROLE restaurante_runtime PASSWORD '$($credentials.runtime)';"
    $roleSql | & $psql @psqlArgs -q
    if ($LASTEXITCODE -ne 0) { throw 'Falló el provisionamiento de roles dedicados.' }
    foreach ($database in @('restaurante_demo', 'restaurante_test')) {
        $exists = & $psql @psqlArgs -Atc "SELECT 1 FROM pg_database WHERE datname='$database'"
        if ($LASTEXITCODE -ne 0) { throw 'No se pudo comprobar la base dedicada.' }
        if ($exists -ne '1') {
            & $psql @psqlArgs -q -c "CREATE DATABASE $database OWNER restaurante_dev_admin"
            if ($LASTEXITCODE -ne 0) { throw "No se pudo crear $database." }
        }
    }
} finally {
    $env:PGPASSWORD = $savedPgPassword
}

$runtimeBase = "postgresql://restaurante_runtime:$($credentials.runtime)@127.0.0.1:$clusterPort"
$adminBase = "postgresql://restaurante_dev_admin:$($credentials.admin)@127.0.0.1:$clusterPort"
$environmentFiles = @{
    '.env' = "DATABASE_URL=$runtimeBase/restaurante_demo`nAUTH_HMAC_SECRET=$($credentials.hmac)`nAPP_ORIGIN=http://127.0.0.1:3000`nRESTAURANTE_MODE=cloud`nPORT=3000`n"
    '.env.admin' = "MIGRATION_DATABASE_URL=$adminBase/restaurante_demo`nRESTAURANT_RUNTIME_ROLE=restaurante_runtime`n"
    '.env.test' = "TEST_DATABASE_URL=$runtimeBase/restaurante_test`nTEST_ADMIN_DATABASE_URL=$adminBase/restaurante_test`nAUTH_HMAC_SECRET=$($credentials.hmac)`nAPP_ORIGIN=http://127.0.0.1:3000`nRESTAURANT_RUNTIME_ROLE=restaurante_runtime`n"
}
foreach ($entry in $environmentFiles.GetEnumerator()) {
    $destination = Join-Path $projectRoot $entry.Key
    if (Test-Path -LiteralPath $destination) {
        if ([IO.File]::ReadAllText($destination) -cne $entry.Value) {
            throw "No se sobrescribe configuración existente: $($entry.Key). Revisar manualmente."
        }
    } else {
        [IO.File]::WriteAllText($destination, $entry.Value, [Text.UTF8Encoding]::new($false))
    }
}
Write-Output 'PostgreSQL dedicado preparado en 127.0.0.1:55432. Bases demo/test separadas y archivos .env ignorados por Git. No usar este cluster para producción.'
