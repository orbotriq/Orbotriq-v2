import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  output: "standalone",
  outputFileTracingRoot: path.resolve(__dirname),
};

export default nextConfig;