# PostgreSQL Database Replication Script
# Copies databases from remote PostgreSQL server to local Docker container

param(
    [Parameter(Mandatory=$false)]
    [switch]$Help
)

if ($Help) {
    Write-Host @"
PostgreSQL Database Replication Script
======================================
This script copies PostgreSQL databases from a remote server to either a local Docker 
container or another PostgreSQL host.

Usage: .\Copy-PostgresDatabases.ps1

The script will prompt for:
- Remote server connection details (host, port, user, password)
  - Optional: database for initial connection (defaults to 'postgres')
- Destination selection (Local Docker or Another Host)
- If Local Docker:
  - Docker container details (container name, database name, password, port)
  - Optional: Local path for database persistence
- If Another Host:
  - Destination server connection details (host, port, user, password)
- Database selection for copying

Requirements:
- Docker installed and running (if using Docker destination)
- Network access to remote PostgreSQL server (and destination if using another host)
- PostgreSQL client tools (psql, pg_dump) installed locally OR Docker
"@
    exit
}

# Function to test if Docker is running
function Test-Docker {
    try {
        docker ps > $null 2>&1
        return $true
    }
    catch {
        return $false
    }
}

# Function to check if psql is available locally
function Test-PsqlLocal {
    try {
        $null = Get-Command psql -ErrorAction Stop
        return $true
    }
    catch {
        return $false
    }
}

# Function to get list of databases from remote server
function Get-RemoteDatabases {
    param(
        [string]$RemoteHost,
        [string]$RemotePort,
        [string]$RemoteDatabase,
        [string]$RemoteUser,
        [string]$RemotePassword,
        [bool]$UseLocalPsql
    )
    
    $env:PGPASSWORD = $RemotePassword
    
    try {
        # Get list of databases excluding templates and postgres system db
        $query = "SELECT datname FROM pg_database WHERE datistemplate = false AND datname NOT IN ('postgres');"
        
        if ($UseLocalPsql) {
            # Use local psql
            $databases = psql -h $RemoteHost -p $RemotePort -U $RemoteUser -d $RemoteDatabase -t -A -c $query 2>&1
        }
        else {
            # Use Docker with host network mode to access remote host
            $databases = docker run --rm --network host postgres:latest psql -h $RemoteHost -p $RemotePort -U $RemoteUser -d $RemoteDatabase -t -A -c $query 2>&1
        }
        
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to connect to remote database. Error: $databases"
        }
        
        return $databases -split "`n" | Where-Object { $_.Trim() -ne "" }
    }
    finally {
        Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    }
}

# Main script
Write-Host "PostgreSQL Database Replication Script" -ForegroundColor Cyan
Write-Host "======================================`n" -ForegroundColor Cyan

# Check if local psql is available
$useLocalPsql = Test-PsqlLocal
if ($useLocalPsql) {
    Write-Host "Using local PostgreSQL client tools" -ForegroundColor Green
}
else {
    Write-Host "Using Docker for PostgreSQL client tools (requires --network host)" -ForegroundColor Yellow
    # Check if Docker is running (needed for client tools)
    if (-not (Test-Docker)) {
        Write-Host "Error: Docker is not running. Please start Docker and try again." -ForegroundColor Red
        Write-Host "Docker is required for PostgreSQL client tools since psql is not installed locally." -ForegroundColor Yellow
        exit 1
    }
}

# Get remote server details
Write-Host "`nRemote PostgreSQL Server Details:" -ForegroundColor Yellow
$remoteHost = Read-Host "Remote host"
$remotePort = Read-Host "Remote port (default: 5432)"
if ([string]::IsNullOrWhiteSpace($remotePort)) { $remotePort = "5432" }
$remoteDb = Read-Host "Remote database for initial connection (default: postgres)"
if ([string]::IsNullOrWhiteSpace($remoteDb)) { $remoteDb = "postgres" }
$remoteUser = Read-Host "Remote user"
$remotePassword = Read-Host "Remote password" -AsSecureString

# Ask for destination type
Write-Host "`nDestination Selection:" -ForegroundColor Yellow
Write-Host "  [1] Local Docker Container"
Write-Host "  [2] Another PostgreSQL Host"
$destChoice = Read-Host "Select destination (1 or 2)"

$useDocker = $destChoice -eq "1"

if ($useDocker) {
    # Check if Docker is running for container destination
    if (-not (Test-Docker)) {
        Write-Host "Error: Docker is not running. Please start Docker and try again." -ForegroundColor Red
        exit 1
    }
    
    # Local Docker configuration
    Write-Host "`nLocal Docker Container Details:" -ForegroundColor Yellow
    $containerName = Read-Host "Container name"
    $localPort = Read-Host "Local port (default: 5432)"
    if ([string]::IsNullOrWhiteSpace($localPort)) { $localPort = "5432" }
    $localDb = Read-Host "Local database name"
    $localPassword = Read-Host "Local postgres password" -AsSecureString

    Write-Host "`nDatabase Persistence:" -ForegroundColor Yellow
    $dataPath = Read-Host "Local path for database storage (leave empty for no persistence)"
    if (-not [string]::IsNullOrWhiteSpace($dataPath)) {
        # Create directory if it doesn't exist
        if (-not (Test-Path $dataPath)) {
            Write-Host "Creating directory: $dataPath" -ForegroundColor Yellow
            New-Item -ItemType Directory -Path $dataPath -Force | Out-Null
        }
    }
}
else {
    # Another PostgreSQL host configuration
    Write-Host "`nDestination PostgreSQL Host Details:" -ForegroundColor Yellow
    $destHost = Read-Host "Destination host"
    $destPort = Read-Host "Destination port (default: 5432)"
    if ([string]::IsNullOrWhiteSpace($destPort)) { $destPort = "5432" }
    $destDb = Read-Host "Destination database for initial connection (default: postgres)"
    if ([string]::IsNullOrWhiteSpace($destDb)) { $destDb = "postgres" }
    $destUser = Read-Host "Destination user"
    $destPassword = Read-Host "Destination password" -AsSecureString
}

# Convert secure strings to plain text
$BSTR_Remote = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($remotePassword)
$plainRemotePassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR_Remote)

if ($useDocker) {
    $BSTR_Local = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($localPassword)
    $plainLocalPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR_Local)
}
else {
    $BSTR_Dest = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($destPassword)
    $plainDestPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR_Dest)
}

if ($useDocker) {
    # Check if container already exists
    $existingContainer = docker ps -a --filter "name=^/${containerName}$" --format "{{.Names}}"

    if ($existingContainer) {
        Write-Host "`nContainer '$containerName' already exists." -ForegroundColor Yellow
        $action = Read-Host "Do you want to (S)top and remove it, (U)se existing, or (C)ancel? [S/U/C]"
    
    switch ($action.ToUpper()) {
        "S" {
            Write-Host "Stopping and removing existing container..." -ForegroundColor Yellow
            docker stop $containerName > $null 2>&1
            docker rm $containerName > $null 2>&1
            $useExisting = $false
        }
        "U" {
            Write-Host "Using existing container..." -ForegroundColor Green
            $useExisting = $true
        }
        default {
            Write-Host "Operation cancelled." -ForegroundColor Red
            exit 0
        }
    }
    }

    # Start PostgreSQL container if not using existing
    if (-not $useExisting) {
        Write-Host "`nStarting PostgreSQL Docker container..." -ForegroundColor Green
        
        # Build docker run command
        $dockerArgs = @(
            "run", "--name", $containerName,
            "-e", "POSTGRES_PASSWORD=$plainLocalPassword",
            "-e", "POSTGRES_DB=$localDb",
            "-p", "${localPort}:5432"
        )
        
        # Add volume mount if path was provided
        if (-not [string]::IsNullOrWhiteSpace($dataPath)) {
            $dockerArgs += "-v"
            $dockerArgs += "${dataPath}:/var/lib/postgresql/data"
            Write-Host "Database will be persisted to: $dataPath" -ForegroundColor Green
        }
        else {
            Write-Host "Database will NOT be persisted (data will be lost when container is removed)" -ForegroundColor Yellow
        }
        
        $dockerArgs += "-d"
        $dockerArgs += "postgres:latest"
        
        & docker $dockerArgs
        
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Error: Failed to start Docker container" -ForegroundColor Red
            Write-Host "Tip: Port $localPort might already be in use. Try a different port." -ForegroundColor Yellow
            Write-Host "      Or the data path might already be in use by another PostgreSQL instance." -ForegroundColor Yellow
            exit 1
        }
        
        Write-Host "Waiting for PostgreSQL to be ready..." -ForegroundColor Yellow
        Start-Sleep -Seconds 10
    }
}
else {
    # Test connection to destination host
    Write-Host "`nTesting connection to destination PostgreSQL host..." -ForegroundColor Green
    $env:PGPASSWORD = $plainDestPassword
    
    try {
        $query = "SELECT 1;"
        
        if ($useLocalPsql) {
            $testDest = psql -h $destHost -p $destPort -U $destUser -d $destDb -t -A -c $query 2>&1
        }
        else {
            $testDest = docker run --rm --network host -e PGPASSWORD=$plainDestPassword postgres:latest psql -h $destHost -p $destPort -U $destUser -d $destDb -t -A -c $query 2>&1
        }
        
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to connect to destination database. Error: $testDest"
        }
        
        Write-Host "Successfully connected to destination host" -ForegroundColor Green
    }
    catch {
        Write-Host "Error: $_" -ForegroundColor Red
        exit 1
    }
    finally {
        Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    }
}

# Get list of databases from remote server
Write-Host "`nConnecting to remote server to retrieve database list..." -ForegroundColor Green
try {
    $databases = Get-RemoteDatabases -RemoteHost $remoteHost -RemotePort $remotePort -RemoteDatabase $remoteDb -RemoteUser $remoteUser -RemotePassword $plainRemotePassword -UseLocalPsql $useLocalPsql
    
    if ($databases.Count -eq 0) {
        Write-Host "No databases found on remote server (or connection failed)" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "`nAvailable databases on remote server:" -ForegroundColor Cyan
    for ($i = 0; $i -lt $databases.Count; $i++) {
        Write-Host "  [$($i+1)] $($databases[$i])"
    }
    
    Write-Host "`nSelect databases to copy:" -ForegroundColor Yellow
    Write-Host "  Enter numbers separated by commas (e.g., 1,3,5) or 'all' for all databases"
    $selection = Read-Host "Selection"
    
    $dbsToCopy = @()
    if ($selection.ToLower() -eq "all") {
        $dbsToCopy = $databases
    }
    else {
        $indices = $selection -split "," | ForEach-Object { [int]$_.Trim() }
        $dbsToCopy = $indices | ForEach-Object { $databases[$_ - 1] }
    }
    
    # Create local backup directory
    $timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
    $backupDir = Join-Path $PWD "postgres_backups_$timestamp"
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    Write-Host "`nBackup directory created: $backupDir" -ForegroundColor Green
    
    # Step 1: Download backups from remote server
    Write-Host "`nStep 1: Downloading $($dbsToCopy.Count) database(s) from remote server..." -ForegroundColor Cyan
    
    $successfulBackups = @()
    
    foreach ($db in $dbsToCopy) {
        Write-Host "`n  Downloading database: $db" -ForegroundColor Yellow
        $backupFile = Join-Path $backupDir "$db.sql"
        
        # Test connection to the specific database on remote server
        Write-Host "    Testing connection to remote database '$db'..." -ForegroundColor Gray
        $env:PGPASSWORD = $plainRemotePassword
        
        if ($useLocalPsql) {
            $testConnection = psql -h $remoteHost -p $remotePort -U $remoteUser -d $db -c "SELECT 1;" 2>&1
        }
        else {
            $testConnection = docker run --rm --network host -e PGPASSWORD=$plainRemotePassword postgres:latest psql -h $remoteHost -p $remotePort -U $remoteUser -d $db -c "SELECT 1;" 2>&1
        }
        
        if ($LASTEXITCODE -ne 0) {
            Write-Host "    Cannot connect to database '$db' on remote server" -ForegroundColor Red
            Write-Host "    Error: $testConnection" -ForegroundColor Red
            Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
            continue
        }
        
        # Dump database to local file
        Write-Host "    Dumping to local file..." -ForegroundColor Gray
        
        if ($useLocalPsql) {
            # Use local pg_dump
            pg_dump -h $remoteHost -p $remotePort -U $remoteUser -d $db --no-owner --no-acl -f $backupFile 2>&1 | Out-Null
        }
        else {
            # Use Docker with host network, redirect output to file
            docker run --rm --network host -e PGPASSWORD=$plainRemotePassword -v "${backupDir}:/backups" postgres:latest pg_dump -h $remoteHost -p $remotePort -U $remoteUser -d $db --no-owner --no-acl -f "/backups/$db.sql" 2>&1 | Out-Null
        }
        
        Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
        
        if ($LASTEXITCODE -eq 0 -and (Test-Path $backupFile)) {
            $fileSize = (Get-Item $backupFile).Length / 1MB
            Write-Host "    Successfully downloaded (${fileSize:N2} MB)" -ForegroundColor Green
            $successfulBackups += @{Database = $db; File = $backupFile}
        }
        else {
            Write-Host "    Failed to download backup" -ForegroundColor Red
        }
    }
    
    if ($successfulBackups.Count -eq 0) {
        Write-Host "`nNo backups were successfully downloaded. Exiting." -ForegroundColor Red
        exit 1
    }
    
    # Step 2: Restore backups to local Docker container
    if ($useDocker) {
        Write-Host "`n`nStep 2: Restoring $($successfulBackups.Count) database(s) to local Docker container..." -ForegroundColor Cyan
        
        foreach ($backup in $successfulBackups) {
            $db = $backup.Database
            $backupFile = $backup.File
            
            Write-Host "`n  Restoring database: $db" -ForegroundColor Yellow
            
            # Create database on local container
            Write-Host "    Creating database on local container..." -ForegroundColor Gray
            $env:PGPASSWORD = $plainLocalPassword
            
            # Check if database already exists
            $checkDb = docker exec $containerName psql -U postgres -t -A -c "SELECT 1 FROM pg_database WHERE datname='$db';" 2>&1
            
            if ($checkDb -match "1") {
                Write-Host "    Database '$db' already exists, dropping it first..." -ForegroundColor Gray
                "DROP DATABASE `"$db`";" | docker exec -i $containerName psql -U postgres 2>&1 | Out-Null
            }
            
            # Create the database
            $createResult = "CREATE DATABASE `"$db`";" | docker exec -i $containerName psql -U postgres 2>&1
            
            if ($LASTEXITCODE -ne 0) {
                Write-Host "    Error creating database '$db': $createResult" -ForegroundColor Red
                Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
                continue
            }
            
            # Restore from backup file
            Write-Host "    Restoring from backup file..." -ForegroundColor Gray
            Get-Content $backupFile | docker exec -i $containerName psql -U postgres -d $db 2>&1 | Out-Null
            
            Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
            
            if ($LASTEXITCODE -eq 0) {
                Write-Host "    Successfully restored $db" -ForegroundColor Green
            }
            else {
                Write-Host "    Failed to restore $db (some warnings may be normal)" -ForegroundColor Yellow
            }
        }
    }
    else {
        # Restore to another PostgreSQL host
        Write-Host "`n`nStep 2: Restoring $($successfulBackups.Count) database(s) to destination PostgreSQL host..." -ForegroundColor Cyan
        
        foreach ($backup in $successfulBackups) {
            $db = $backup.Database
            $backupFile = $backup.File
            
            Write-Host "`n  Restoring database: $db" -ForegroundColor Yellow
            
            # Create database on destination host
            Write-Host "    Creating database on destination host..." -ForegroundColor Gray
            $env:PGPASSWORD = $plainDestPassword
            
            # Check if database already exists
            if ($useLocalPsql) {
                $checkDb = psql -h $destHost -p $destPort -U $destUser -d $destDb -t -A -c "SELECT 1 FROM pg_database WHERE datname='$db';" 2>&1
            }
            else {
                $checkDb = docker run --rm --network host -e PGPASSWORD=$plainDestPassword postgres:latest psql -h $destHost -p $destPort -U $destUser -d $destDb -t -A -c "SELECT 1 FROM pg_database WHERE datname='$db';" 2>&1
            }
            
            if ($checkDb -match "1") {
                Write-Host "    Database '$db' already exists, dropping it first..." -ForegroundColor Gray
                
                if ($useLocalPsql) {
                    "DROP DATABASE `"$db`";" | psql -h $destHost -p $destPort -U $destUser -d $destDb 2>&1 | Out-Null
                }
                else {
                    docker run --rm --network host -e PGPASSWORD=$plainDestPassword postgres:latest psql -h $destHost -p $destPort -U $destUser -d $destDb -c "DROP DATABASE `"$db`";" 2>&1 | Out-Null
                }
            }
            
            # Create the database
            if ($useLocalPsql) {
                $createResult = "CREATE DATABASE `"$db`";" | psql -h $destHost -p $destPort -U $destUser -d $destDb 2>&1
            }
            else {
                $createResult = docker run --rm --network host -e PGPASSWORD=$plainDestPassword postgres:latest psql -h $destHost -p $destPort -U $destUser -d $destDb -c "CREATE DATABASE `"$db`";" 2>&1
            }
            
            if ($LASTEXITCODE -ne 0) {
                Write-Host "    Error creating database '$db': $createResult" -ForegroundColor Red
                Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
                continue
            }
            
            # Restore from backup file
            Write-Host "    Restoring from backup file..." -ForegroundColor Gray
            
            if ($useLocalPsql) {
                Get-Content $backupFile | psql -h $destHost -p $destPort -U $destUser -d $db 2>&1 | Out-Null
            }
            else {
                Get-Content $backupFile | docker run --rm -i --network host -e PGPASSWORD=$plainDestPassword postgres:latest psql -h $destHost -p $destPort -U $destUser -d $db 2>&1 | Out-Null
            }
            
            Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
            
            if ($LASTEXITCODE -eq 0) {
                Write-Host "    Successfully restored $db" -ForegroundColor Green
            }
            else {
                Write-Host "    Failed to restore $db (some warnings may be normal)" -ForegroundColor Yellow
            }
        }
    }
    
    Write-Host "`n`nDatabase replication complete!" -ForegroundColor Green
    Write-Host "`nBackup files saved to: $backupDir" -ForegroundColor Cyan
    
    if ($useDocker) {
        Write-Host "`nConnection details for local databases:" -ForegroundColor Cyan
        Write-Host "  Host: localhost"
        Write-Host "  Port: $localPort"
        Write-Host "  User: postgres"
        Write-Host "  Container: $containerName"
        if (-not [string]::IsNullOrWhiteSpace($dataPath)) {
            Write-Host "  Data Path: $dataPath" -ForegroundColor Green
        }
    }
    else {
        Write-Host "`nConnection details for destination databases:" -ForegroundColor Cyan
        Write-Host "  Host: $destHost"
        Write-Host "  Port: $destPort"
        Write-Host "  User: $destUser"
    }
    
    Write-Host "`nRestored databases:"
    foreach ($backup in $successfulBackups) {
        Write-Host "  - $($backup.Database)"
    }
    
}
catch {
    $errorMessage = $_.Exception.Message
    Write-Host "Error: $errorMessage" -ForegroundColor Red
    exit 1
}