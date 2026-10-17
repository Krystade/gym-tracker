import type { Env as WorkerEnv } from '../src/env';

// `env` from cloudflare:workers is the Worker's own Env in tests.
declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
  }
}
