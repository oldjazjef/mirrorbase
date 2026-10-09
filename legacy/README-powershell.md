# PostgreSQL Database Backup & Restore Script

PowerShell script for backing up and restoring PostgreSQL databases from remote servers to local Docker containers.

## 📋 Features

- **Automated remote database replication** - Connect directly to remote PostgreSQL servers
- **Backup file management** - Download databases as SQL files for safekeeping
- **Docker containerization** - Automatic setup of local PostgreSQL in Docker
- **Persistent storage** - Optional volume mounting for data persistence
- **Reserved keyword handling** - Properly handles databases with reserved SQL names
- **Batch operations** - Copy multiple databases at once
- **Progress tracking** - Clear feedback during backup and restore operations

## 🚀 The Script

### `copy-psql-databases.ps1`

**One-step automated replication from remote server to local Docker.**

Connects to a remote PostgreSQL server, downloads selected databases as backup files, then automatically restores them to a local Docker container

## 📦 Requirements

- **Docker Desktop** - Must be installed and running
- **Network access** - For connecting to remote PostgreSQL servers
- **Optional:** PostgreSQL client tools (`psql`, `pg_dump`) installed locally
  - If not installed, the script will automatically use Docker for these tools

## 🔧 Installation

1. Clone or download this script to your local machine
2. Ensure Docker Desktop is running
3. Open PowerShell and navigate to the script directory

```powershell
cd C:\path\to\scripts
```

## 📖 Usage

### Run the Script

```powershell
.\copy-psql-databases.ps1
```

**You'll be prompted for:**

1. **Remote Server Details**
   - Host (IP or hostname)
   - Port (default: 5432)
   - Initial database for connection (default: postgres)
   - Username
   - Password

2. **Local Docker Container Settings**
   - Container name
   - Port (default: 5432)
   - Initial database name
   - Postgres password
   - Optional: Local path for persistent storage

3. **Database Selection**
   - Choose which databases to copy (select by numbers or type 'all')

**What happens:**

- Creates timestamped backup directory with downloaded SQL files
- Sets up local PostgreSQL Docker container
- Restores all databases automatically

## 💡 Example Usage

### Copy all databases from remote server

```powershell
PS> .\copy-psql-databases.ps1

Remote host: 127.0.0.1
Remote port (default: 5432): 5432
Remote database for initial connection (default: postgres):
Remote user: postgres
Remote password: *******

Container name: local-postgres
Local port (default: 5432): 5433
Local database name: postgres
Local postgres password: *******
Local path for database storage: C:\PostgreSQL\data

Available databases on remote server:
  [1] database-1
  [2] database-2
  [3] database-3

Selection: all
```

## 🗂️ Data Persistence

When prompted for "Local path for database storage", you have two options:

### Persistent Storage (Recommended)

Provide a local path (e.g., `C:\PostgreSQL\data`):

- ✅ Data survives container restarts
- ✅ Can stop/start container without data loss
- ✅ Backup the folder to preserve all data

### Temporary Storage

Leave empty or press Enter:

- ⚠️ Data is lost when container is removed
- ✅ Good for testing or temporary work
- ✅ Smaller disk footprint

## 🐛 Troubleshooting

### Connection Failed: Authentication Error

```
password authentication failed for user "postgres"
```

**Solutions:**

- Verify username and password
- Check `pg_hba.conf` on remote server allows connections from your IP
- Ensure the user has permissions to connect to the databases

### Database Creation Error: Reserved Keyword

```
ERROR: syntax error at or near "authorization"
```

**Solution:** This is handled automatically by the script using proper identifier quoting. If you still see this error, ensure you're using the latest version.

### Port Already in Use

```
Error: Failed to start Docker container
```

**Solution:** Choose a different local port (e.g., 5433 instead of 5432)

### Cannot Connect to Specific Database

```
Cannot connect to database 'mydb' on remote server
```

**Solutions:**

- The database might not allow connections from your user
- Check remote server's `pg_hba.conf` configuration
- Verify the user has permissions for the database
- Ensure no firewall is blocking the connection

### Docker Not Running

```
Error: Docker is not running
```

**Solution:** Start Docker Desktop and wait for it to fully initialize

## 🔒 Security Notes

- Passwords are entered securely using PowerShell's `SecureString`
- Backup files may contain sensitive data - store securely
- Consider using SSH tunnels for remote connections over untrusted networks
- Docker containers should be secured if exposed to networks

## 📝 File Outputs

### Backup Directory Structure

```
postgres_backups_2026-02-10_14-30-15/
├── database-1.sql
├── database-2.sql
├── database-3.sql
```

### Backup files are plain SQL that can be:

- Version controlled (if appropriate for your data)
- Archived for long-term storage
- Restored manually using `psql` or pgAdmin
- Shared with team members

## 🔄 Connecting to Restored Databases

After restoration, connect using:

**Connection Details:**

- Host: `localhost`
- Port: Your specified port (e.g., `5432` or `5433`)
- User: `postgres`
- Password: The password you set during setup
- Databases: All restored database names

**Using psql:**

```powershell
psql -h localhost -p 5433 -U postgres -d database-1
```

**Using pgAdmin:**

1. Add New Server
2. Host: `localhost`
3. Port: `5433`
4. Username: `postgres`
5. Password: Your password

**Using connection strings:**

```
postgresql://postgres:password@localhost:5433/database-1
```

## 📄 License

Feel free to use, modify, and distribute this script as needed.

## ⚠️ Important Notes

- **Test first:** Always test with non-critical data before using in production
- **Backup existing data:** If reusing a container, ensure existing data is backed up
- **Storage space:** Ensure sufficient disk space for backups (roughly 2x database size)
- **Network bandwidth:** Large databases may take significant time to download
- **PostgreSQL versions:** Script uses `postgres:latest` Docker image - may need version pinning for compatibility
