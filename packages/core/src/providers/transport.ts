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

/** 供 GitHub 等其他外部调用复用：跟随系统代理的传输（桌面端注入 Chromium 网络）。 */
export function systemFetch(): typeof fetch | undefined {
  return systemTransport;
}
