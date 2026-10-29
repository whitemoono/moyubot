import type { ProviderConfig } from '../types';

let systemTransport: typeof fetch | undefined;
let directTransport: typeof fetch | undefined;

/** Desktop supplies Chromium networking so provider requests respect system proxies. */
export function setProviderFetch(system: typeof fetch, direct?: typeof fetch): void {
  systemTransport = system;
  directTransport = direct;
}

export function providerFetch(config: Pick<ProviderConfig, 'networkMode'>, input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
  const transport = config.networkMode === 'system' ? systemTransport : directTransport;
  return (transport ?? globalThis.fetch)(input, init);
}
