import type { NextConfig } from "next";
import { readFileSync, existsSync } from "node:fs";

const isDev = process.env.NODE_ENV === "development";

/** Prefer sidecar V3 API port written by start-service (escapes zombie :3389). */
function resolveApiOrigin(): string {
  const fromEnv = (process.env.HCM_API_ORIGIN || process.env.HCM_API_PORT || "").trim();
  if (fromEnv.startsWith("http")) return fromEnv.replace(/\/$/, "");
  if (/^\d+$/.test(fromEnv)) return `http://127.0.0.1:${fromEnv}`;
  const portFile = "C:/HCM Airfare/var/api_port.txt";
  try {
    if (existsSync(portFile)) {
      const port = readFileSync(portFile, "utf8").trim();
      if (/^\d+$/.test(port)) return `http://127.0.0.1:${port}`;
    }
  } catch {
    /* fall through */
  }
  return "http://127.0.0.1:3389";
}

const apiOrigin = resolveApiOrigin();

const atlasVersion =
  process.env.NEXT_PUBLIC_ATLAS_VERSION ||
  process.env.ATLAS_VERSION ||
  (() => {
    try {
      return JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version as string;
    } catch {
      return "3.0.15";
    }
  })();

const config: NextConfig = {
  output: "export",
  distDir: "out",
  trailingSlash: true,
  images: { unoptimized: true },
  env: {
    NEXT_PUBLIC_ATLAS_VERSION: atlasVersion,
  },
  ...(isDev
    ? {
        async rewrites() {
          return [
            { source: "/v1/:path*", destination: `${apiOrigin}/v1/:path*` },
          ];
        },
      }
    : {}),
};

export default config;
