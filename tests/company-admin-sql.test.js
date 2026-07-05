const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sqlText = fs.readFileSync(path.join(__dirname, '..', 'database', 'ATLAS_Company_Admin.sql'), 'utf8');
const serverText = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

assert.match(sqlText, /CREATE TABLE dbo\.Companies/i, 'Companies table should be defined');
assert.match(sqlText, /CREATE TABLE dbo\.CompanyBackups/i, 'CompanyBackups table should be defined');
assert.match(sqlText, /CREATE TABLE dbo\.PasswordResetTokens/i, 'Password reset token table should be defined');
assert.match(sqlText, /sp_ATLAS_GetCompanies/i, 'Company list stored procedure should exist');
assert.match(sqlText, /sp_ATLAS_UpsertCompany/i, 'Company upsert stored procedure should exist');
assert.match(sqlText, /CompanyCode = N'ATLAS'/i, 'Default ATLAS company should be seeded for update/logo');

assert.match(serverText, /POST \/api\/companies/i, 'Company create API should exist');
assert.match(serverText, /PUT \/api\/companies\/:id/i, 'Company update API should exist');
assert.match(serverText, /CREATE DATABASE/i, 'Company API should create company database');
assert.match(serverText, /POST \/api\/auth\/forgot-password/i, 'Forgot password API should exist');
assert.match(serverText, /GET \/api\/opening-balances/i, 'Opening balance list API should exist');
assert.match(serverText, /POST \/api\/opening-balances/i, 'Opening balance save API should exist');
assert.match(serverText, /POST \/api\/opening-balances\/import/i, 'Opening balance import API should exist');
assert.match(serverText, /POST \/api\/admin\/backup/i, 'Backup API should exist');
assert.match(serverText, /POST \/api\/admin\/restore/i, 'Restore API should exist');
assert.match(serverText, /confirm !== 'RESTORE'/, 'Restore API should require explicit confirmation');
assert.match(serverText, /RESTORE VERIFYONLY FROM DISK/i, 'Restore API should verify backup media before restore');
assert.match(serverText, /SET SINGLE_USER WITH ROLLBACK IMMEDIATE/i, 'Restore API should handle active sessions before restore');
assert.match(serverText, /SET MULTI_USER/i, 'Restore API should return database to multi-user mode');
assert.match(serverText, /app\.post\('\/api\/airfare-policy-rates\/:policyRateId\/delete'/i, 'Airfare policy delete should expose a POST fallback for restricted clients');
assert.match(serverText, /sp_ATLAS_DeactivateAirfarePolicyRate/i, 'Airfare policy delete should use the SQL safe-delete procedure');
assert.match(fs.readFileSync(path.join(__dirname, '..', 'database', 'ATLAS_HCM_SQL_Objects.sql'), 'utf8'), /AirfarePolicyRateArchive/i, 'Airfare policy safe delete should archive policy snapshots');
assert.doesNotMatch(serverText, /USE\s+\$\{safeDatabase\}/, 'Company setup should not leave the SQL pool inside company database');

console.log('company admin SQL/API checks passed');
