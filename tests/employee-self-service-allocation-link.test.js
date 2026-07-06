const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const serverText = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const pageText = fs.readFileSync(path.join(root, 'atlas-hcm-next', 'app', 'page.tsx'), 'utf8');
const extensionSql = fs.readFileSync(path.join(root, 'extensions', 'employee-portal', 'sql', 'ATLAS_Employee_Portal_Extension.sql'), 'utf8');

assert.match(serverText, /async function createAllocationFromSelfServiceRequest/, 'approval allocation link helper is missing');
assert.match(serverText, /LinkedAllocationID = @AllocationID/, 'request is not linked back to the created allocation');
assert.match(serverText, /ManagerApproved'.*HRApproved'.*FinanceApproved'.*Issued/s, 'approval statuses do not trigger allocation creation');
assert.match(pageText, /Open allocation/, 'self-service request table does not expose the linked allocation action');
assert.match(pageText, /transitionSelfServiceRequest\(request\.RequestID, "ManagerApproved"\)/, 'manager approval action is missing from self-service table');
assert.match(pageText, /className="self-service-grid"/, 'phase-2 self-service workspace is not rendered inside phase-1 app');
assert.match(pageText, /New Ticket Request/, 'self-service form should be clearly labeled below the request workflow');
assert.match(pageText, /self-service-summary-panel[^]*My Airfare Requests[^]*New Ticket Request/, 'self-service screen should show summary, then request workflow, then new request form');
assert.match(extensionSql, /LinkedAllocationID/, 'employee portal extension SQL does not expose LinkedAllocationID');
assert.match(extensionSql, /FK_ext_employee_allowance_requests_Allocation/, 'employee portal extension SQL does not protect the allocation link');
assert.match(serverText, /selfServiceWorkflowSource:\s*'phase2-same-port-allocation-link'/, 'health endpoint should expose the self-service workflow patch marker');
assert.match(serverText, /admin-default:\$\{adminFallback\.Username \|\| adminFallback\.UserID\}/, 'admin self-service fallback claim is missing');
assert.match(serverText, /LOWER\(u\.Role\) IN \(N'admin', N'manager', N'hr'\)/, 'admin self-service fallback should only apply to privileged users');
assert.match(serverText, /fn_ATLAS_IsAirfareEligibleEmployeeStatus\(Status\)/, 'admin self-service fallback should choose an active airfare-eligible employee');
assert.match(serverText, /function isPrivilegedSelfServiceUser/, 'self-service role guard helper is missing');
assert.match(serverText, /async function resolveSelfServiceEmployeeId/, 'self-service employee selector resolver is missing');
assert.match(serverText, /req\.query\.employeeId/, 'self-service summary and request APIs should accept a selected employee id');
assert.match(pageText, /Request for employee/, 'self-service admin employee selector is missing');
assert.match(pageText, /changeSelfServiceEmployee/, 'self-service employee selector should refresh the active employee context');
assert.match(pageText, /employeeId:\s*activeSelfServiceEmployeeId/, 'self-service submit should send the selected employee id for privileged users');
assert.match(pageText, /<option value="employee">Employee Self-Service<\/option>/, 'Security screen should expose an Employee Self-Service user role');
assert.match(serverText, /valid\('admin', 'manager', 'hr', 'employee', 'user', 'viewer'\)/, 'backend should accept the Employee Self-Service user role');
assert.match(pageText, /handleUserEmployeeChange/, 'Security ESS user form should select an employee from Employee Master');
assert.match(pageText, /employeeUserFields/, 'Security ESS user form should copy details from Employee Master');
assert.match(pageText, /Select employee from master/, 'Security ESS user form should show an employee selector');
assert.match(serverText, /syncEmployeeSelfServiceClaim/, 'backend should create the ESS user-to-employee mapping claim');
assert.match(serverText, /getEmployeeForSelfServiceUser/, 'backend should validate the selected Employee Master row');
assert.match(serverText, /Username = @Username/, 'backend should bind ESS usernames to the selected employee code');

console.log('Employee self-service allocation link source checks passed');
