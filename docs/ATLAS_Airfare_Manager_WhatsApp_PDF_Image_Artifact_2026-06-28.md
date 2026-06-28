# ATLAS Airfare Manager WhatsApp PDF/Image Artifact

Date: 2026-06-28

## Purpose

Add a professional A4 approval format for Airfare Allocation manager WhatsApp communication without using WhatsApp Business API.

## Implemented Workflow

1. Open Airfare Allocation.
2. Select employee and complete ticket/allocation details.
3. Type the manager WhatsApp number.
4. Review the live manager message preview.
5. Use `PDF / print A4` to open a professional A4 approval document and save/print as PDF.
6. Use `Download A4 image` to create a high-resolution PNG approval sheet.
7. Use `Open manager WhatsApp` to open normal WhatsApp with the text filled, then attach the PDF/image manually and press Send.

## Design Logic

- No airfare, loan, year-end, report, company, or formula rule was changed.
- The document is generated from already-calculated Airfare Allocation preview values.
- The A4 format includes company name, company logo when available, employee details, route/ticket data, amount cards, approval message, and signature sections.
- Image output uses browser canvas export to create a PNG attachment.
- PDF output uses the browser print dialog so the user can save as PDF on Windows/Chrome/Edge.

## Research Basis

- Normal WhatsApp click-to-chat supports opening a chat with a prefilled text message using a WhatsApp link.
- Automated media/document sending requires WhatsApp Business Platform / Cloud API style integration, which is outside this request because there is no Business WhatsApp API.
- Browser canvas can export image data as PNG, which is used for the A4 image attachment workflow.

## Verification

- Server syntax check passed.
- UI layout source test passed.
- Production frontend build passed.

## User Operation Note

Normal WhatsApp does not allow the system to silently attach and send files. The system prepares the PDF/image and opens WhatsApp. The sender attaches the generated PDF/image and presses Send manually.
