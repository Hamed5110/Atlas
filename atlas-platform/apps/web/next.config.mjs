import { fileURLToPath } from "url";
import path from "path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "export",
  trailingSlash: true,
  images: {
    unoptimized: true
  },
  turbopack: {
    root: path.dirname(fileURLToPath(import.meta.url))
  }
};

export default nextConfig;
