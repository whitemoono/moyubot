export function normalizeSyncServer(input: string): string {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error('请填写完整服务器地址，例如 https://sync.example.com'); }
  const local = ['localhost', [127,0,0,1].join('.'), '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('服务器必须使用 HTTPS；本机开发可使用 http://localhost');
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('请只填写服务器域名和端口，不要包含路径、账号或参数');
  return url.origin;
}
