/**
 * 出厂默认不再预置任何模型供应商，测试自己声明一个"未绑定槽位"供应商。
 * id 留空，正好对上默认 Bot 的 providerId ''；各测试用 baseUrl 覆盖成本地假服务。
 */
export const TEST_PROVIDER = {
  id: '',
  name: 'Test provider',
  kind: 'openai',
  baseUrl: 'http://127.0.0.1:1/v1',
  defaultModel: 'test-model',
  models: ['test-model'],
  createdAt: 0,
};

export const testProvider = (overrides = {}) => ({ ...TEST_PROVIDER, ...overrides });