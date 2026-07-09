declare namespace Cloudflare {
  interface Env {
    BOOTSTRAP_SECRET: string;
    TEST_MIGRATIONS: Array<{ name: string; queries: string[] }>;
  }
}
