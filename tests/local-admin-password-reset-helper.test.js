const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const scriptPath = path.join(root, "tools", "Reset-ATLAS-LocalAdminPassword.ps1");
const script = fs.readFileSync(scriptPath, "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

assert.match(server, /bcrypt\.compare\(password,\s*user\.PasswordHash\)/, "login must verify PasswordHash with bcrypt");
assert.match(server, /bcrypt\.hash\(value\.password,\s*12\)/, "user management must hash passwords with bcrypt cost 12");

for (const required of [
  "dbo.Users",
  "PasswordHash",
  "LoginAttempts = 0",
  "LockedUntil = NULL",
  "bcrypt.hashSync(password, 12)",
  "DRY RUN ONLY",
  "-Execute",
  "sqlcmd",
]) {
  assert.ok(script.includes(required), `reset helper missing ${required}`);
}

assert.doesNotMatch(script, /DELETE\s+FROM\s+dbo\.Users/i, "reset helper must not delete users");
assert.doesNotMatch(script, /DROP\s+TABLE/i, "reset helper must not drop tables");

console.log("Local admin password reset helper checks passed");
