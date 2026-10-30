"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setProviderFetch = setProviderFetch;
exports.providerFetch = providerFetch;
let systemTransport;
let directTransport;
/** Desktop supplies Chromium networking so provider requests respect system proxies. */
function setProviderFetch(system, direct) {
    systemTransport = system;
    directTransport = direct;
}
function providerFetch(config, input, init) {
    const transport = config.networkMode === 'system' ? systemTransport : directTransport;
    return (transport ?? globalThis.fetch)(input, init);
}
