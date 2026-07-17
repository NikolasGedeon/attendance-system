# Azure Deployment Guide — Attendance System

Architecture: **Azure App Service (Linux, Node 20)** runs the NestJS API with
free HTTPS; **Azure Database for PostgreSQL Flexible Server** stores the data
with automatic backups. No Docker registry or VM to maintain.

Estimated cost (West Europe, small tier): App Service B1 ~ €12/mo,
PostgreSQL B1ms ~ €15/mo. Both can scale up later without redeploying.

---

## 0. Prerequisites (once)

- Install the Azure CLI: https://learn.microsoft.com/cli/azure/install-azure-cli
- `az login`
- Pick globally-unique names below (replace `marfields-attendance`).

## 1. Resource group

```powershell
az group create --name rg-attendance --location westeurope
```

## 2. PostgreSQL Flexible Server

```powershell
az postgres flexible-server create `
  --resource-group rg-attendance `
  --name marfields-attendance-db `
  --location westeurope `
  --tier Burstable --sku-name Standard_B1ms --storage-size 32 `
  --version 16 `
  --admin-user attendanceadmin `
  --admin-password "CHOOSE_A_STRONG_PASSWORD" `
  --public-access 0.0.0.0
```

Notes:
- `--public-access 0.0.0.0` allows Azure services (the App Service) to
  connect while blocking the public internet.
- Create the application database:

```powershell
az postgres flexible-server db create `
  --resource-group rg-attendance `
  --server-name marfields-attendance-db `
  --database-name attendance
```

- To run migrations from YOUR PC, temporarily allow your own IP:

```powershell
az postgres flexible-server firewall-rule create `
  --resource-group rg-attendance --name marfields-attendance-db `
  --rule-name my-pc --start-ip-address YOUR_PUBLIC_IP --end-ip-address YOUR_PUBLIC_IP
```

Connection string format (note `sslmode=require`):

```
postgresql://attendanceadmin:PASSWORD@marfields-attendance-db.postgres.database.azure.com:5432/attendance?sslmode=require
```

## 3. App Service

```powershell
az appservice plan create `
  --resource-group rg-attendance --name plan-attendance `
  --sku B1 --is-linux

az webapp create `
  --resource-group rg-attendance --plan plan-attendance `
  --name marfields-attendance `
  --runtime "NODE:20-lts"

az webapp config set `
  --resource-group rg-attendance --name marfields-attendance `
  --startup-file "node dist/main.js"
```

## 4. Application settings (environment)

Use `.env.production.example` in `api/` as the checklist. Set them all:

```powershell
az webapp config appsettings set `
  --resource-group rg-attendance --name marfields-attendance `
  --settings `
  DATABASE_URL="postgresql://attendanceadmin:PASSWORD@marfields-attendance-db.postgres.database.azure.com:5432/attendance?sslmode=require" `
  JWT_SECRET="LONG_RANDOM_SECRET" `
  CORS_ORIGIN="https://marfields-attendance.azurewebsites.net" `
  SMS_ENABLED="true" SMS_PROVIDER="cyta" SMS_DEV_SHOW_CODE="false" `
  CYTA_SMS_URL="https://www.cyta.com.cy/cytamobilevodafone/dev/websmsapi/sendsms.aspx" `
  CYTA_SMS_USERNAME="Marfields.IT.Admin" `
  CYTA_SMS_SECRET_KEY="THE_REAL_KEY" `
  CYTA_SMS_LANGUAGE="en" CYTA_SMS_DEBUG="false" `
  SCM_DO_BUILD_DURING_DEPLOYMENT="true"
```

Generate the JWT secret with: `openssl rand -base64 48` (Git Bash) or any
long random string. App settings override any `.env` file — the deployed
app does not use `.env` at all.

## 5. Run migrations against the Azure database

From your PC (with the firewall rule from step 2):

```powershell
cd api
$env:DATABASE_URL="postgresql://attendanceadmin:PASSWORD@marfields-attendance-db.postgres.database.azure.com:5432/attendance?sslmode=require"
npx prisma migrate deploy
```

`migrate deploy` applies the existing migration files without prompting.
Then seed the first data (kiosk row, admin user) either with Prisma Studio
pointed at the same DATABASE_URL, or by registering via the API once
deployed and updating the role in the database.

## 6. Deploy the API

```powershell
cd api
az webapp up --resource-group rg-attendance --name marfields-attendance --runtime "NODE:20-lts"
```

`az webapp up` zips the folder and Azure's build (Oryx) runs
`npm install` → `postinstall: prisma generate` → `npm run build`,
then starts `node dist/main.js`.
(`node_modules`, `dist` are excluded automatically.)

Verify: open `https://marfields-attendance.azurewebsites.net` — expect the
JSON 404 `Cannot GET /`. Logs: 

```powershell
az webapp log tail --resource-group rg-attendance --name marfields-attendance
```

## 7. Point the Flutter apps at Azure

```powershell
cd attendance_app
flutter build apk --dart-define=APP_MODE=mobile --dart-define=API_BASE_URL=https://marfields-attendance.azurewebsites.net
flutter build apk --dart-define=APP_MODE=kiosk  --dart-define=API_BASE_URL=https://marfields-attendance.azurewebsites.net
flutter build web --dart-define=API_BASE_URL=https://marfields-attendance.azurewebsites.net
```

`API_BASE_URL` overrides everything in `api_config.dart`; local runs
without the define keep using the LAN/localhost logic. HTTPS means the
Android cleartext exception is no longer needed (it can stay for dev).

## 8. Custom domain (optional, later)

Add a CNAME `attendance.marfields.com` → `marfields-attendance.azurewebsites.net`,
then in App Service → Custom domains add it and create the free managed
certificate. Update CORS_ORIGIN and rebuild the apps with the new URL.

## 9. Production hardening checklist

- [x] HTTPS everywhere (automatic on App Service)
- [x] JWT_SECRET strong + only in app settings
- [x] SMS_DEV_SHOW_CODE=false, CYTA_SMS_DEBUG=false
- [x] CORS locked via CORS_ORIGIN
- [x] Postgres closed to the internet (Azure-services-only + your IP rule;
      delete the `my-pc` rule when not migrating)
- [x] Automatic DB backups (Flexible Server default: 7 days; raise if needed)
- [ ] Remove or guard `/sms/test` endpoint before real rollout
- [ ] Rate limiting on /auth and /kiosk (@nestjs/throttler) — recommended
- [ ] Kiosk device-key → signed/HMAC requests — recommended
- [ ] Kiosk tablet: pin the app (Android screen pinning) + exit PIN feature

## Troubleshooting

- **App won't start**: `az webapp log tail ...` — most common: missing
  DATABASE_URL or a migration not applied.
- **Prisma "Can't reach database"**: check the firewall rules on the
  flexible server and that `sslmode=require` is in the URL.
- **CORS errors in the web admin**: CORS_ORIGIN must exactly match the
  origin shown in the browser (scheme + host, no trailing slash).
- **Phone can't connect**: make sure the APK was built with the
  `--dart-define=API_BASE_URL=...` flag (it's compile-time).
