# Port policy — 3389 only

HCM Airfare + `atlas-next` UI serve on **http://127.0.0.1:3389** only.

| Do | Don't |
|----|-------|
| `ATLAS_E2E_BASE_URL=http://127.0.0.1:3389` | Default tests to `:3355` |
| Deploy UI to `C:\HCM Airfare\...\web_dist_next` | Serve old `web_dist` on 3355 for this product |
| Playwright `baseURL` → 3389 | Hardcode 3355 in e2e specs |

Legacy ATLAS Node scripts that still mention 3355 are **out of scope** for the HCM :3389 path.
