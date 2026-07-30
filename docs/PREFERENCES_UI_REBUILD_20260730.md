# Preferences UI rebuild - 2026-07-30

## Scope

- Rebuilt the Preferences workspace into a cleaner settings command center.
- Removed old stacked notes/metric feel and replaced it with a responsive hero, insight cards, appearance settings card, protected-default card, and safer airfare rule editor.
- Kept the protected global airfare default behavior from the previous fix.
- Changed bulk delete display so it counts editable non-global rows only.

## Open-source / GitHub research signal used

- GitHub global settings documentation separates shared/global configuration from scoped repository controls.
- GitHub safe-settings centralizes organization settings in an admin repository so default governance is deliberate and auditable.
- Open-source admin dashboard patterns favor responsive summary cards, clear bulk-action toolbars, and protected destructive actions.

## Important product decision

The global airfare default is still not deletable. It is the fallback used when no company, employee, department, or pay-group rule applies. Admin users can change it by saving a new global preference value. Delete tools remove scoped airfare rules only.

## Verification

- `npm run check` passed.
- `npm run test:company-admin` passed.
- `npm --prefix atlas-hcm-next test` passed.
- `npm --prefix atlas-hcm-next run build` passed.
- `npm run test:full` passed.

Full system report:

- `C:\Airfare_Allowance\test-reports\atlas-full-system-test-20260730090527.md`
- `C:\Airfare_Allowance\test-reports\atlas-full-system-test-20260730090527.json`

## Artifact

- MSI: `C:\Airfare_Allowance\artifacts\patch-2.3.78-preferences-ui-rebuild\ATLAS-Airfare-Allowance-2.3.78-x64.msi`
- SHA256: `FB8A69F0DCCFBEDBF204F4742F4ABDF9FB49FC53FB0D3F7B76D10D7AAABBE9BA`
