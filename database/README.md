# milktea-coffee database

PostgreSQL database for the CRM. `CRM_Create_All.sql` initializes a new, empty database with the schema, business rules, demo data, and report views.

## New database

1. Create database `crm_tra_sua_ca_phe` in pgAdmin.
2. Connect to it, open **Query Tool**, and run `CRM_Create_All.sql`.
3. Run `07_notifications_and_replies.sql` to add the notification table and feedback-reply field required by the API.
4. Run `10_admin_governance.sql` to add Manager personnel data and customer lock requests.
5. Run `11_remove_customer_deletion_audit.sql` to disable legacy customer deletion requests. Existing audit records are retained in the database but are no longer available through the application.
6. Run `12_allow_unlock_customer_request.sql` to enable Manager proposals for unlocking locked customer accounts.

The demo accounts are `admin`, `quanly`, and `khach01`; each uses `DemoCRM@2026`.

Do not rerun `CRM_Create_All.sql` on a database that already contains data. It is an initialization script, not an upgrade.

## Existing database

Apply only migrations that are not already present:

- `07_notifications_and_replies.sql`: adds customer notifications and staff replies; safe to run more than once.
- `08_remove_branches.sql`: removes obsolete branch columns/tables from databases created with the earlier branch schema.
- `09_survey_management.sql`: adds survey hiding and current survey-editing business rules.
- `10_admin_governance.sql`: adds internal Manager personnel data and customer lock requests; safe to run more than once.
- `11_remove_customer_deletion_audit.sql`: rejects outstanding legacy deletion requests and drops the customer-deletion function; existing audit records remain archived and inaccessible through the application.
- `12_allow_unlock_customer_request.sql`: enables `unlock_customer` requests for Manager-to-Admin approval; safe to run after migration 10 and migration 11.

For pgAdmin, select `crm_tra_sua_ca_phe`, open **Query Tool**, and run each required migration file in order. For PowerShell with PostgreSQL 16's `psql`:

```powershell
$env:PGCLIENTENCODING = "UTF8"
$psql = "C:\Program Files\PostgreSQL\16\bin\psql.exe"
& $psql -h localhost -p 5432 -U postgres -d crm_tra_sua_ca_phe -W -v ON_ERROR_STOP=1 -f "C:\xampp\htdocs\MilkTea-Coffee\database\07_notifications_and_replies.sql"
if ($LASTEXITCODE -ne 0) { throw "Migration 07 thất bại." }
```

`-W` asks for the PostgreSQL user's password, not the CRM demo-account password. Change the `psql.exe` path, user, or database name if your installation differs. Run migration 10 after migration 07 (and migrations 08/09 when required), then run migration 11 followed by migration 12, using the same command pattern.

Other scripts include `00_create_database.sql`, individual schema/rule/data files `01`-`03`, reports `04`, examples `05`, and checks `06`. `CRM_Create_All.sql` already includes the current survey-management rules and report views.
