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

console.log('Employee self-service allocation link source checks passed');
