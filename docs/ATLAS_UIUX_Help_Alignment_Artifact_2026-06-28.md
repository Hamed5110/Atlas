# ATLAS UI/UX Help and Alignment Artifact

Date: 2026-06-28

## Support Screen Help Links

The Support screen now links the Word help document directly:

```text
/help/ATLAS_Airfare_HCM_Support_Guide_2026-06-28.docx
```

Preview images are available on the same screen:

```text
/help/atlas-system-integrity-ai-insights-20260628.png
/help/atlas-live-ui-companies-20260628.png
```

Source files were copied into:

```text
atlas-hcm-next/public/help/
```

After `npm run build`, these assets are published with the frontend and can be opened from:

```text
http://<server-name>/help/
```

## Core Alignment Techniques Applied

- Stable two-column support grid on desktop.
- Single-column stacking on tablet and mobile.
- Left-aligned body text with a separate action area.
- Button links use the same inline-flex alignment as real buttons.
- Card titles wrap instead of overlapping actions.
- Panels are allowed to shrink inside grids with `min-width: 0`.
- Screenshot previews use a fixed `16 / 9` aspect ratio.
- Help workflow cards use equal minimum height for scan-friendly rhythm.

## Verification

The source layout test now checks:

- Word help guide link.
- AI Insights screenshot preview.
- Company process screenshot preview.
- Document action alignment.
- Shared panel shrink behavior.
- Wrapped card titles.
- Link-button alignment.
- Responsive tablet and mobile support layout rules.
