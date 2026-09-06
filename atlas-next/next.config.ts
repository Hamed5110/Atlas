import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

const config: NextConfig = {
  output: "export",
  distDir: "out",
  trailingSlash: true,
  images: { unoptimized: true },
  ...(isDev
    ? {
        async rewrites() {
          return [
            { source: "/v1/:path*", destination: "http://127.0.0.1:3389/v1/:path*" },
          ];
        },
      }
    : {}),
};

export default config;
