import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The LLM adapter and Supabase service-role client are server-only.
  // Keeping serverExternalPackages ensures the Anthropic SDK is never bundled
  // into a client build.
  serverExternalPackages: ["@anthropic-ai/sdk"],
};

export default nextConfig;
