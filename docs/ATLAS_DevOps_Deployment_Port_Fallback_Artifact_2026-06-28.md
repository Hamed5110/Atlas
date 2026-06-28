# ATLAS DevOps Deployment and Port Fallback Artifact

Date: 2026-06-28

## Implemented Logic

1. Pre-build duplicate link scan.
   - Scans frontend JSX `href="..."` values before build.
   - Records duplicate links in the deployment report.
   - Current result: no duplicate frontend links found.

2. Default build/deploy.
   - Runs the production frontend build.
   - Keeps ATLAS deployed on port `3355`.
   - Uses bind address `0.0.0.0` by default for LAN access.

3. Error handling and conflict checks.
   - Detects listeners on port `3355`.
   - If the listener is an unhealthy ATLAS `server.js` process, it is stopped and relaunched.
   - If another process owns the port, the conflict is recorded and the script avoids killing unrelated software.
   - If `3355` fails health checks after default bind, the script retries with localhost bind `127.0.0.1`.
   - Port `80` is checked as the IIS/reverse-proxy fallback path.

## Application Bind Address

`server.js` now supports:

```text
PORT=3355
ATLAS_BIND_HOST=0.0.0.0
```

Default:

```text
0.0.0.0:3355
```

Fallback:

```text
127.0.0.1:3355
```

## Command

```text
npm run deploy:devops
```

## Latest Deployment Result

Report:

```text
test-reports/atlas-devops-deploy-20260628123700.md
```

Result:

```text
PASSED
```

Checked URLs:

```text
http://127.0.0.1:3355/api/health
http://<LAN-IP>:3355/api/health
http://<COMPUTER-NAME>:3355/api/health
http://127.0.0.1/api/health
```

## Research Used

- Node.js/Express host binding pattern: bind to `0.0.0.0` for LAN, `127.0.0.1` for local-only.
- Windows process/port conflict detection with `Get-NetTCPConnection`.
- IIS URL Rewrite and ARR as port `80` reverse proxy to Node.
- Windows port-forward/proxy fallback concepts through HTTP.sys/IIS.
