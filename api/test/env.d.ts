/// <reference types="@cloudflare/vitest-plugin/types" />
import type { Env as WorkerEnv } from '../src/index'

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      TEST_MIGRATIONS: import('cloudflare:test').D1Migration[]
    }
  }
}
