let deferredInstall;
let registration;
let installing;
const notice = () => document.querySelector('#pwa-notice');
function banner(message, label, action) {
  notice()?.remove();
  const el = document.createElement('aside');
  el.id = 'pwa-notice';
  el.setAttribute('role', 'status');
  const text = document.createElement('span'); text.textContent = message;
  const button = document.createElement('button'); button.textContent = label; button.onclick = action;
  const close = document.createElement('button'); close.textContent = '×'; close.setAttribute('aria-label', '关闭提示'); close.onclick = () => el.remove();
  el.append(text, button, close); document.body.append(el);
}
export async function requestInstall() {
  if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) return 'installed';
  if (!deferredInstall) return 'manual';
  const prompt = deferredInstall; deferredInstall = null;
  await prompt.prompt();
  return (await prompt.userChoice).outcome;
}
export function registerPwa() {
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstall = event; });
  window.addEventListener('appinstalled', () => { deferredInstall = null; notice()?.remove(); });
  const offerUpdate = () => {
    if (!registration?.waiting || installing) return;
    banner('新版本已准备好，本机保存的数据会保留。', '立即更新', () => {
      installing = true;
      registration.waiting?.postMessage({ type: 'ACTIVATE_UPDATE' });
    });
  };
  if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', async () => {
      try {
        registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' });
        offerUpdate();
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          worker?.addEventListener('statechange', () => { if (worker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(); });
        });
      } catch (error) { console.warn('PWA 离线缓存尚未就绪:', error.message); }
    });
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (installing && !reloading) { reloading = true; location.reload(); }
    });
    let lastCheck = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - lastCheck > 60000) {
        lastCheck = Date.now(); registration?.update().catch(() => {}); offerUpdate();
      }
    });
  }
}
