import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  // The LLM adapter and Supabase service-role client are server-only.
  // Keeping serverExternalPackages ensures the Anthropic SDK is never bundled
  // into a client build.
  serverExternalPackages: ["@anthropic-ai/sdk"],
};

// i18n: next-intl routing nélkül — a request-konfig a src/i18n/request.ts.
const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
