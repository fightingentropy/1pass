import type { NextConfig } from "next";

const useReactCompiler = process.env.NEXT_USE_REACT_COMPILER === "true";

const nextConfig: NextConfig = {
  // React Compiler is opt-in until the Babel plugin resolves correctly in the current toolchain.
  reactCompiler: useReactCompiler || undefined,
  
  // Optimize images
  images: {
    formats: ['image/avif', 'image/webp'],
    dangerouslyAllowSVG: true,
    contentDispositionType: 'attachment',
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    qualities: [75, 85],
  },
  
  // Optimize bundle output
  output: 'standalone',
  
  // Compiler optimizations
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? {
      exclude: ['error', 'warn'],
    } : false,
  },
  
  // Note: swcMinify is always enabled in Next.js 16, no need to specify
  // Note: modularizeImports for lucide-react removed - causes issues with Turbopack
};

export default nextConfig;
