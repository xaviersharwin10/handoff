import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root — a stray package-lock.json above this repo otherwise
  // makes Next infer the wrong root and resolve the wrong node_modules in prod.
  outputFileTracingRoot: import.meta.dirname,
};

export default nextConfig;
