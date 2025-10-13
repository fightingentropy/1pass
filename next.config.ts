import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable React Compiler for automatic optimizations (moved to top-level in Next.js 16)
  reactCompiler: true,
  
  // Optimize images
  images: {
    formats: ['image/avif', 'image/webp'],
    dangerouslyAllowSVG: true,
    contentDispositionType: 'attachment',
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
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
