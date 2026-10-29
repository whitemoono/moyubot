import { net, session } from 'electron';
import { setProviderFetch } from '@moyu/core';

/** Keep explicit direct requests separate from the system proxy session. */
export function initializeProviderNetworking(): void {
  let directReady: Promise<Electron.Session> | undefined;
  setProviderFetch(
    (input, init) => net.fetch(input instanceof URL ? input.toString() : input, init),
    async (input, init) => {
      directReady ??= (async () => {
        const direct = session.fromPartition('provider-direct', { cache: false });
        await direct.setProxy({ mode: 'direct' });
        return direct;
      })();
      const direct = await directReady;
      return direct.fetch(input instanceof URL ? input.toString() : input, init);
    },
  );
}
