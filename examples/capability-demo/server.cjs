// Run through MoyuBot's stdio MCP transport; stdout is reserved for JSON-RPC.
const { createRequire } = require('node:module');
const path = require('node:path');
const projectRequire = createRequire(path.resolve(__dirname, '../../packages/core/package.json'));
const { Server } = projectRequire('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = projectRequire('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = projectRequire('@modelcontextprotocol/sdk/types.js');

const server = new Server({ name: 'moyubot-demo', version: '1.0.0' }, { capabilities: { tools: {} } });
const textResult = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
  {
    name: 'echo', description: '原样返回输入文本和本次调用时间，用于验证 MCP 实际调用。',
    inputSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 2000 } }, required: ['text'], additionalProperties: false },
  },
  {
    name: 'add_numbers', description: '将两个有限数字相加，返回输入和结果。',
    inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'], additionalProperties: false },
  },
] }));

server.setRequestHandler(CallToolRequestSchema, async request => {
  const args = request.params.arguments ?? {};
  if (request.params.name === 'echo') {
    if (typeof args.text !== 'string' || args.text.length > 2000) throw new Error('text 必须是最多 2000 字符的文本');
    return textResult({ text: args.text, calledAt: new Date().toISOString() });
  }
  if (request.params.name === 'add_numbers') {
    if (typeof args.a !== 'number' || typeof args.b !== 'number' || !Number.isFinite(args.a) || !Number.isFinite(args.b)) throw new Error('a 和 b 必须是有限数字');
    const sum = args.a + args.b;
    if (!Number.isFinite(sum)) throw new Error('计算结果超出数值范围');
    return textResult({ a: args.a, b: args.b, sum });
  }
  throw new Error('未知工具');
});

server.connect(new StdioServerTransport()).catch(() => { console.error('测试 MCP 启动失败'); process.exitCode = 1; });
