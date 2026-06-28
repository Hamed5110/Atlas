# ATLAS Normal WhatsApp Message Workflow Artifact

Date: 2026-06-28

## Request

Add WhatsApp messaging through the system without WhatsApp Business API. Employee WhatsApp number should be stored in Employee Master. Manager/custom WhatsApp number should be typed during sending. The message should have a clean print format and page setup.

## Implemented

- Added `WhatsAppNumber` to Employee Master.
- Added WhatsApp number input in Add/Edit Employee Master.
- Added a WhatsApp message composer on the Employee Master screen.
- Composer supports:
  - Employee WhatsApp from Employee Master
  - Manager WhatsApp typed by user
  - Other/custom WhatsApp typed by user
- Added formatted message preview.
- Added `Print format` output with A4 page setup.
- Added `Open WhatsApp` using normal WhatsApp click-to-chat link.

## Logic

1. User selects employee.
2. User chooses recipient type.
3. System resolves recipient number:
   - employee: stored `WhatsAppNumber`
   - manager: typed manager number
   - custom: typed custom number
4. System builds a formatted message with company, subject, employee, department, reporting manager, reference, body, and footer.
5. System prints the same formatted message when requested.
6. System opens `https://wa.me/<number>?text=<encoded message>`.
7. User presses Send manually in WhatsApp.

## Safety

- No background/automatic send is attempted.
- No WhatsApp Business API credentials are required.
- Phone number is normalized to digits only before link creation.
- Message text is URL encoded before opening WhatsApp.
- User remains in control of final Send action.

## Research Basis

- Normal WhatsApp click-to-chat links use `wa.me/<number>?text=<message>`.
- True programmatic sending requires Meta WhatsApp Business Platform / Cloud API.
- URL text must be encoded before being placed in a link.

## Verification

- Backend syntax check: passed
- Frontend UI layout source test: passed
- Frontend production build: passed
- Live Employee Master WhatsApp API probe: passed
- Smoke test: passed
- Acceptance regression: passed
- Environment/network fallback verification: passed
- Full system test: passed

## Reports

- Full system: `C:\Airfare_Allowance\test-reports\atlas-full-system-test-20260628132954.md`
- Acceptance: `C:\Airfare_Allowance\test-reports\atlas-acceptance-regression-20260628132940.md`
- Environment: `C:\Airfare_Allowance\test-reports\atlas-environment-verification-20260628162941.md`
