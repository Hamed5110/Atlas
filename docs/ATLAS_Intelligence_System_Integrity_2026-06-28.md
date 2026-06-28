# ATLAS Intelligence Control Center and System Integrity Artifact

Date: 2026-06-28

## Purpose

This artifact documents the automatic verification layer added around ATLAS Airfare HCM. It is a read-only intelligence layer. It does not change airfare formulas, year-end rules, loan rules, report formulas, company processing, approval rules, or SQL policy logic.

## New Automatic Model

Endpoint:

```text
GET /api/intelligence/system-integrity
```

Authenticated users receive one combined model:

- `modelName`: ATLAS Automatic Verification Model
- `mode`: read-only observer
- `rulesLocked`: true
- `formulaPolicy`: confirms that business formulas and rules are not changed
- `integrityStatus`: Verified, Review recommended, or Action required
- `integrityScore`: combined evidence score from existing SQL verification plus diagnostics
- `controlSignals`: counts for failed checks, warnings, risks, diagnostics, and status
- `automationPlan`: grouped verification plan for formulas, approvals, loans, year-end, company, backup, security, and reports
- `actionQueue`: prioritized review items from SQL verification and diagnostics
- `evidence`: source summaries from the existing SQL procedures and diagnostics

## Evidence Sources

The model uses existing ATLAS evidence only:

- `dbo.sp_ATLAS_GetIntelligenceControlCenter`
- `dbo.sp_ATLAS_RunSystemVerification`
- Read-only system diagnostics for SQL, published frontend build, and optional external APIs

No write operation is performed by the model.

## Coverage

The automatic plan groups the current verification checks into operating areas:

- Formula and policy snapshot integrity
- Approval and import control integrity
- Loan register integrity
- Year-end readiness integrity
- Company, backup, and security integrity
- Report and view display integrity

## Dashboard

The AI Insights screen now shows:

- Automatic verification model status
- Integrity score
- Failed check count
- Warning count
- Diagnostic status
- Action count
- Intelligence Control Center plan with target screen buttons

## Testing

Regression coverage was added to:

- `tests/acceptance-regression-test.js`
- `atlas-hcm-next/tests/ui-layout-source.test.mjs`

The acceptance regression validates that:

- The system integrity endpoint loads
- The model name is correct
- Rules are locked
- The automation plan is returned
- The action queue is returned
- The formula policy explicitly protects business formulas

## Operating Notes

Use the AI Insights screen after any correction or operational change. Refresh intelligence to recalculate live status from SQL and diagnostics.

For LAN access without depending on a changing IP address, use:

```text
http://FOCUSSERVER/
```

If name resolution is temporarily unavailable on another PC, the current fallback address remains:

```text
http://192.168.15.208/
```
