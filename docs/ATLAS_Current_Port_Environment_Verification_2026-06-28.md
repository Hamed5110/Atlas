# ATLAS Current Port and Development Environment Verification

Date: 2026-06-28

## Current Active Port

ATLAS is currently running on:

```text
0.0.0.0:3355
```

Process:

```text
node.exe server.js
```

Meaning:

- `3355` is the active application port.
- `0.0.0.0` means the app listens on all local network interfaces.
- Port `80` is the friendly-name/IIS proxy fallback.

## User URLs

Use:

```text
http://FOCUSSERVER/
```

Direct application URL:

```text
http://FOCUSSERVER:3355/
```

Local direct URL:

```text
http://127.0.0.1:3355/
```

## Consolidated Development Environment

All development and deployment commands are now rooted at:

```text
C:\Airfare_Allowance
```

Primary commands:

```text
npm run verify:env
npm run deploy:devops
npm run check
npm run test:full
```

Frontend source remains under:

```text
C:\Airfare_Allowance\atlas-hcm-next
```

Backend source remains:

```text
C:\Airfare_Allowance\server.js
```

Deployment automation remains:

```text
C:\Airfare_Allowance\tools\Deploy-ATLAS-DevOps.ps1
C:\Airfare_Allowance\tools\Verify-ATLAS-Environment.ps1
```

## Latest Verification

Environment verification report:

```text
test-reports/atlas-environment-verification-20260628124432.md
```

Deployment report:

```text
test-reports/atlas-devops-deploy-20260628124442.md
```

Both passed.

## Network Fallback

Verified:

```text
http://127.0.0.1:3355/api/health
http://FOCUSSERVER:3355/api/health
http://192.168.15.208:3355/api/health
http://127.0.0.1/api/health
http://FOCUSSERVER/api/health
```

Fallback order:

1. `http://FOCUSSERVER/`
2. `http://FOCUSSERVER:3355/`
3. `http://192.168.15.208:3355/`
4. `http://127.0.0.1:3355/`
