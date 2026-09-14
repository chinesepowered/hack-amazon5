import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Strands SDK lazily imports optional AWS SDK modules; bundling it breaks the Turbopack build.
  serverExternalPackages: ["@strands-agents/sdk"],
};

export default nextConfig;
