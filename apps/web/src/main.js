import './style.css';
import './glass.css';
import './monochrome.css';
import { animatePage, captureTabPage, captureNavigation, animateNavigation, animateSheet, positionLens, installMotion } from './motion.js';
import './vendor/characters/geometry-data.js';
import './vendor/characters/chibi-shape.js';
import './vendor/characters/shiro-shape.js';
import './vendor/characters/mikan-shape.js';
import './vendor/characters/neko-shape.js';
import './vendor/characters/tsuki-shape.js';
import './vendor/characters/nemu-shape.js';
import { icon } from './icons.js';
import { registerPwa, requestInstall } from './pwa.js';
import { initConnection, connectionSheet, connected, values, put, stopCamera, connectionStatus } from './connection.js';
import './connection.css';
import {installExecution,chooseModels,showProviders,showCloud,sendChat,stopChat,runningConversation,queuedConversation,approvalCount,showApprovals,executionCatalog} from './execution.js';
import './execution.css';

// Unpaired mode uses demo content; paired mode uses the user's private service.
const bots = [
  { id: 'deepseek', name: '小深', role: '你的全能搭子', model: 'DeepSeek V3.2', shape: 'chibi', color: '#7e91d0', bg: '#e9edf8', tag: '日常助手', message: '整理好啦，今天也要记得早点休息。', time: '刚刚', unread: 2 },
  { id: 'claude', name: '阿橙', role: '灵感与文字搭子', model: 'Claude Sonnet 4.5', shape: 'mikan', color: '#d88b64', bg: '#f8ece2', tag: '创意写作', message: '关于新产品，我有几个有趣的想法。', time: '14:28' },
  { id: 'chatgpt', name: '小白', role: '认真做事的伙伴', model: 'GPT-5', shape: 'shiro', color: '#91a795', bg: '#edf1e8', tag: '效率工具', message: '周报已整理完成，随时可以查看。', time: '13:05' },
  { id: 'gemini', name: '小咪', role: '脑洞很大的研究员', model: 'Gemini 2.5 Pro', shape: 'neko', color: '#a89aca', bg: '#f0ebf6', tag: '学习研究', message: '发现了 3 篇你可能感兴趣的文章。', time: '昨天' },
  { id: 'grok', name: '月月', role: '陪你探索新鲜事', model: 'Grok 4', shape: 'tsuki', color: '#a5a3aa', bg: '#eeedf0', tag: '日常助手', message: '今天有什么新鲜事想一起聊聊？', time: '昨天' },
  { id: 'qwen', name: '眠眠', role: '细心的代码伙伴', model: 'Qwen3', shape: 'nemu', color: '#bf9ca9', bg: '#f5eaf0', tag: '代码开发', message: '代码的思路已经帮你梳理好了。', time: '星期三' },
];
const state = { tab: 'chat', filter: '全部', botFilter: '全部', chat: null, dark: false, device: 'phone', messages: {}, cloudAwake: false, drafts: {}, tasks: [true, true], sheet: null };
const demoBots=structuredClone(bots);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const avatar = (bot, cls = '') => {
  const p = window.GROK_GEO.shapes[bot.shape];
  return `<span class="avatar ${cls}" style="--bot-bg:${bot.bg};--bot-color:${bot.color}"><svg viewBox="0 0 229 229" role="img" aria-label="${escape(bot.name)}头像"><path fill="${bot.color}" d="${p.path}"/>${(p.decals || []).map(d => `<path fill="${d.fill}" d="${d.d}" fill-rule="${d.rule || 'nonzero'}"/>`).join('')}${p.iconFace?.anchors.map(([x,y]) => `<rect x="${x-p.iconFace.rx}" y="${y-p.iconFace.ry}" width="${p.iconFace.rx*2}" height="${p.iconFace.ry*2}" rx="${p.iconFace.rx}" fill="${p.iconFace.ink || '#282b29'}"/>`).join('') || ''}</svg></span>`;
};
const button = (name, action, label, cls = '') => `<button type="button" class="icon-button ${cls}" data-action="${action}" aria-label="${label}" title="${label}">${icon(name)}</button>`;
const sectionTitle = (title, trailing = '') => `<div class="section-title"><h2>${title}</h2>${trailing}</div>`;
const linkButton = (label, action) => `<button class="text-button" data-action="${action}">${label}${icon('chevron')}</button>`;
const statusBar = () => `<div class="status-bar" aria-hidden="true"><span>9:41</span><div class="dynamic-island"></div><div>${icon('signal')}${icon('wifi')}${icon('battery')}</div></div>`;
const nav = () => `<nav class="bottom-nav" aria-label="主导航"><span class="nav-lens" aria-hidden="true"></span>${[['chat','chat','对话'], ['bots','bots','伙伴'], ['work','grid','工作台'], ['me','user','我的']].map(([id,i,label]) => `<button data-tab="${id}" class="nav-item ${state.tab===id?'active':''}" ${state.tab===id?'aria-current="page"':''}><span class="nav-icon">${icon(i)}${id==='chat'?'<i></i>':''}</span><span>${label}</span></button>`).join('')}</nav><div class="home-indicator" aria-hidden="true"><span></span></div>`;
const header = (eyebrow, title, actions) => `<header class="page-header"><div><span class="eyebrow">${eyebrow}</span><h1>${title}<span class="title-period">.</span></h1></div><div class="header-actions">${actions}</div></header>`;
const conversation = bot => `<button class="conversation" data-chat="${bot.id}">${avatar(bot)}<span class="conversation-body"><span class="conversation-top"><strong>${escape(bot.name)}</strong><span class="conversation-time">${bot.time}</span></span><span class="conversation-bottom"><span>${escape(bot.message)}</span>${bot.unread?`<b class="unread">${bot.unread}</b>`:''}</span></span></button>`;

function chatPage() {
  const list = state.filter === '未读' ? bots.filter(b=>b.unread) : state.filter === '群聊' ? bots.filter(b=>b.group) : bots.slice(0,connected()?bots.length:4);
  return `${header('YOUR LITTLE AI SPACE', '对话', button('search','search','搜索对话')+button('plus','new','新建对话','filled'))}
    <div class="page-scroll home-scroll">
      <section class="greeting-card">
        <span class="greeting-date"><i></i> 今天也一起，慢慢来</span>
        <h2>留点时间，<br>给喜欢的事<span>。</span></h2>
        <button class="hero-link" data-chat="${bots[0]?.id||'waiting'}">剩下的，交给你的 AI 搭子 ${icon('arrow')}</button>
        <div class="hero-art" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><span class="little-spark">✳</span><span class="little-dot"></span>${avatar(bots[0]||emptyBot, 'hero-avatar')}<span class="floating-note">${icon('check')} 交给我就好</span><span class="hero-shadow"></span></div>
      </section>
      ${sectionTitle('常用搭子', linkButton('全部伙伴','all-bots'))}
      <div class="pinned-bots">${bots.slice(0,3).map((b,i)=>`<button class="pinned-bot" data-chat="${b.id}"><span class="pinned-portrait">${avatar(b)}<i class="presence"></i></span><strong>${escape(b.name)}</strong><span>${['随时待命','灵感在线','认真工作'][i]}</span></button>`).join('')}<button class="add-partner" data-action="new-bot"><span>${icon('plus')}</span><strong>新搭子</strong><span>认识一下</span></button></div>
      <div class="section-title recent-title"><h2>最近对话 <span class="count">${bots.length}</span></h2><div class="mini-tabs" aria-label="对话筛选">${['全部','未读','群聊'].map(x=>`<button data-filter="${x}" class="${state.filter===x?'selected':''}" aria-pressed="${state.filter===x}">${x}</button>`).join('')}</div></div>
      <div class="conversation-list">${list.length?list.map(conversation).join(''):`<div class="empty-state">${icon('chat')}<strong>还没有群聊</strong><p>叫上几个搭子，一起碰撞灵感。</p><button class="text-button" data-action="group">创建第一个群聊 ${icon('arrow')}</button></div>`}</div>
      <button class="cloud-strip" data-action="${connected()?'connection':'cloud'}"><span class="cloud-strip-icon">${icon('cloud')}</span><span><strong>${connected()?'设备与实时同步':'云电脑正在'+(state.cloudAwake?'运行':'休息')}</strong><small>${state.cloudAwake?'随时可以继续你的工作':'需要的时候，它会为你醒来'}</small></span><span class="sleep-label">${state.cloudAwake?'运行中':'Z z'} ${icon('chevron')}</span></button>
      <p class="end-note">一点灵感，一点效率，还有一点摸鱼 ${icon('leaf')}</p>
    </div>`;
}

function botsPage() {
  const filtered = state.botFilter === '全部' ? bots : bots.filter(b=>b.tag===state.botFilter);
  return `${header('A LITTLE TEAM, BIG POSSIBILITIES', '你的伙伴', button('plus','new-bot','添加伙伴','filled'))}<div class="page-scroll"><p class="page-intro">各有所长，随时在场。<br>找到那个和你最合拍的搭子。</p><div class="category-tabs">${['全部','日常助手','创意写作','效率工具','学习研究','代码开发'].map(t=>`<button data-bot-filter="${t}" class="${state.botFilter===t?'selected':''}" aria-pressed="${state.botFilter===t}">${t}</button>`).join('')}</div><div class="bot-grid">${filtered.map(b=>`<button class="bot-card" data-chat="${b.id}"><span class="bot-card-label">${b.tag}</span>${avatar(b)}<h2>${escape(b.name)}</h2><p>${escape(b.role)}</p><span class="model-label"><i></i>${escape(b.model)}</span><span class="bot-card-arrow">${icon('arrow')}</span></button>`).join('')}</div><button class="new-partner-card" data-action="new-bot">${icon('plus')}<span><strong>下一位伙伴，由你定义</strong><small>名字、性格和能力，都听你的</small></span>${icon('arrow')}</button><p class="end-note">一个人，也可以拥有一支小队。</p></div>`;
}
function computerArt() {
  return `<div class="computer-art" aria-hidden="true"><div class="computer-orbit"></div><span class="computer-star">✳</span><div class="monitor"><div class="monitor-toolbar"><i></i><i></i><i></i><span>moyu workspace</span></div><div class="monitor-content"><span class="monitor-sleep">${state.cloudAwake?icon('check'):'z<span>z</span>'}</span><span>${state.cloudAwake?'HELLO, WORLD.':'TAKING A LITTLE BREAK'}</span></div></div><span class="monitor-neck"></span><span class="monitor-foot"></span><span class="desk-line"></span>${icon('leaf','desk-leaf')}</div>`;
}
function workPage() {
  if(connected())return syncedWork();
  return `${header('LESS BUSY, MORE LIVING', '工作台', button('more','workspace-info','工作台信息'))}<div class="page-scroll"><div class="workspace-heading"><span class="tiny-label">你的共享云电脑</span><span class="status-pill ${state.cloudAwake?'awake':''}"><i></i>${state.cloudAwake?'运行中':'休眠中'}</span></div><section class="computer-card">${computerArt()}<h2>${state.cloudAwake?'一切就绪，开工吧。':'休息一下，也很好。'}</h2><p>你的文件和进度，都好好留在这里。</p><button class="primary-button" data-action="wake">${icon(state.cloudAwake?'moon':'spark')}${state.cloudAwake?'让电脑休息':'轻轻唤醒'}${icon('arrow')}</button><div class="computer-specs"><span>4 vCPU</span><i></i><span>8 GB 内存</span><i></i><span>共享工作空间</span></div></section><div class="resource-grid"><button data-action="files"><span class="resource-icon">${icon('folder')}</span><strong>我的文件</strong><small>12 个文件</small>${icon('chevron')}</button><button data-action="memories"><span class="resource-icon violet">${icon('spark')}</span><strong>长期记忆</strong><small>记住你的偏好</small>${icon('chevron')}</button></div>${sectionTitle('让小事自动发生', '<span class="tiny-label">2 个例行任务</span>')}<div class="task-list">${[['每日灵感早餐','每天 09:00 · 阿橙','sun'],['一周工作小结','每周五 18:00 · 小白','clock']].map(([t,s,i],idx)=>`<div class="task-row"><span class="task-icon">${icon(i)}</span><span><strong>${t}</strong><small>${s}</small></span><button class="toggle ${state.tasks[idx]?'on':''}" data-task="${idx}" role="switch" aria-checked="${state.tasks[idx]}" aria-label="${t}"><span></span></button></div>`).join('')}</div><p class="end-note">大家共用一台电脑，默契也可以很省心。</p></div>`;
}
function settingRow(i,title,sub,action,extra='') { return `<button class="setting-row" data-action="${action}"><span class="setting-icon">${icon(i)}</span><span><strong>${title}</strong>${sub?`<small>${sub}</small>`:''}</span>${extra||icon('chevron')}</button>`; }
function mePage() {
  return `${header('MAKE YOURSELF AT HOME', '我的空间', button('settings','preferences','偏好设置'))}<div class="page-scroll"><button class="profile-card" data-action="profile">${avatar(bots[0]||emptyBot)}<span><h2>${escape(profileName)}</h2><p>好好生活，顺便把事做好。</p><span class="profile-badge">${icon('leaf')} 个人工作空间</span></span>${icon('chevron')}</button><section class="stats-card"><div><strong>${bots.length}<span>位</span></strong><small>默契伙伴</small></div><div><strong>${connected()?values("messages").length:128}<span>条</span></strong><small>灵感碰撞</small></div><div><strong>${connected()?values("memories").length:24}<span>${connected()?"条":"天"}</span></strong><small>${connected()?"已同步记忆":"一起走过"}</small></div></section>${sectionTitle('为你量身定制')}<div class="settings-group">${settingRow('monitor',connected()?'设备与同步':'连接电脑',connected()?'已连接 · 管理实时同步':'扫码连接你的桌面工作空间','connection')}${settingRow('bots','模型与供应商','管理你的 AI 连接','providers')}${settingRow('chart','使用情况','看看伙伴们的工作足迹','usage')}${settingRow('globe','连接器','让常用工具彼此连通','connectors')}</div><div class="settings-group">${settingRow(state.dark?'moon':'sun','外观模式',state.dark?'纯黑 · 清透玻璃':'纯白 · 清透玻璃','theme',`<span class="theme-value">${state.dark?'深色':'浅色'} ${icon('chevron')}</span>`)}${settingRow('bell','通知偏好','','notifications')}${settingRow('shield','隐私与数据','','privacy')}</div><button class="install-card" data-action="install"><span class="install-icon">${icon('download')}</span><span><strong>把 MoyuBot 放进口袋</strong><small>添加到主屏幕，随时见个面。</small></span>${icon('arrow')}</button><div class="about-note"><img src="./logo.webp" alt=""/><strong>MoyuBot</strong><span>为轻松一点的每一天而造</span><small>PWA · v0.2</small></div></div>`;
}
function chatDetail() {
  if (connected()) return syncedChatDetail();
  const b = bots.find(b=>b.id===state.chat);
  const messages = state.messages[b.id] || [];
  return `<header class="chat-header">${button('back','back','返回对话列表')}<button class="chat-identity" data-action="bot-detail">${avatar(b)}<span><strong>${escape(b.name)}</strong><small><i></i>${escape(b.role)}</small></span></button>${button('more','chat-options','对话选项')}</header><div class="chat-model-bar">${icon('spark')} ${escape(b.model)}<span>一个伙伴，一段持续的对话</span></div><div class="page-scroll message-scroll" id="messages"><div class="chat-date">今天 14:32</div><div class="user-message">帮我安排一下今天剩下的时间吧。<small>14:32 ${icon('check')}</small></div><div class="assistant-message">${avatar(b,'message-avatar')}<div><div class="assistant-name">${escape(b.name)}<span>${escape(b.model)}</span></div><p>当然啦，忙了一天，接下来就留一点时间给自己 🌿</p><div class="plan-card"><span class="tiny-label">给今天，一点小小的安排</span>${[['15:00','收个尾','把手头的事情轻轻放下'],['16:00','出去走走','一杯咖啡，或者 20 分钟的阳光'],['18:00','好好吃饭','今天也值得一顿喜欢的晚餐']].map(([t,h,s])=>`<div class="plan-row"><span>${t}</span><i></i><div><strong>${h}</strong><small>${s}</small></div></div>`).join('')}<span class="plan-footer">${icon('leaf')} 不必把每一分钟，都安排得满满的。</span></div><p>要不要告诉我，你今天最想完成的一件小事？</p><div class="message-meta">14:32 · 记得给生活留白</div></div></div>${messages.map(m=>m.role==='user'?`<div class="user-message">${escape(m.text)}<small>刚刚 ${icon('check')}</small></div>`:`<div class="assistant-message">${avatar(b,'message-avatar')}<div><div class="assistant-name">${escape(b.name)}</div><p>${escape(m.text)}</p><span class="demo-message-label">原型演示回复</span></div></div>`).join('')}</div><div class="composer-area"><div class="suggestion-chips"><button data-suggest="帮我整理一下今天的待办">${icon('check')} 整理待办</button><button data-suggest="聊点轻松的吧">${icon('sun')} 随便聊聊</button></div><form class="composer" id="message-form">${button('plus','attachment','添加附件')}<textarea id="message-input" rows="1" placeholder="想到什么，就说什么…" aria-label="消息">${escape(state.drafts[b.id]||'')}</textarea><button class="send-button" type="submit" aria-label="发送演示消息">${icon('send')}</button></form><span class="composer-footnote">自在地聊，灵感会慢慢来。</span></div><div class="home-indicator"><span></span></div>`;
}

let lastPage = '';
const pageScrollPositions = new Map();
let chatOriginTab = 'chat';
let navigationMoving = false;
function render() {
  const oldNav = document.querySelector('.bottom-nav');
  const key = state.chat ? `chat:${state.chat}` : state.tab;
  const pageChanged = key !== lastPage;
  const navigatingChat = pageChanged && lastPage && (!!state.chat || lastPage.startsWith('chat:'));
  const returning = navigatingChat && !state.chat;
  const navigationSnapshot = navigatingChat ? captureNavigation() : null;
  const direction = ['chat','bots','work','me'].indexOf(state.tab) >= ['chat','bots','work','me'].indexOf(lastPage) ? 1 : -1;
  const outgoing = pageChanged && lastPage && !state.chat && !lastPage.startsWith('chat:') ? captureTabPage() : null;
  const oldScroll = document.querySelector('.page-scroll')?.scrollTop || 0;
  if (pageChanged && lastPage && !lastPage.startsWith('chat:')) pageScrollPositions.set(lastPage, oldScroll);
  document.querySelector('#app').innerHTML = `<main class="studio ${state.dark?'dark':''} ${state.device==='wide'?'wide-preview':''}"><header class="studio-header"><a class="studio-brand" href="./" aria-label="MoyuBot 首页"><img src="./logo.webp" alt=""/><strong>MoyuBot<span>随身工作空间</span></strong></a><div class="studio-header-right"><span class="prototype-badge"><i></i> ${connected()?'个人工作空间':'未连接 · 示例预览'}</span><button class="studio-theme" data-action="theme" aria-label="切换明暗主题">${icon(state.dark?'sun':'moon')}</button></div></header><aside class="studio-intro"><span class="studio-kicker">A LITTLE SPACE FOR YOU</span><h2>你的 AI 搭子，<br>随时<span>在身边。</span></h2><p>把琐事留给伙伴，<br>把时间还给生活。</p><div class="studio-divider"></div><span class="studio-caption">MoyuBot for mobile</span><div class="palette"><i></i><i></i><i></i><i></i><span>BLACK / WHITE · LIQUID GLASS</span></div></aside><div class="device-wrap"><div class="device"><div class="phone-screen ${state.chat?'in-chat':''}">${statusBar()}<div class="screen-content">${state.chat?chatDetail():({chat:chatPage,bots:botsPage,work:workPage,me:mePage}[state.tab])()}${state.chat?'':nav()}</div><div class="sheet-host"></div><div class="toast" role="status" aria-live="polite"></div></div></div><div class="device-caption"><span><i></i> ${state.device==='phone'?'MOBILE · 402 × 852':'TABLET · 680 × 852'}</span><span>DESIGN PREVIEW 01</span></div></div><aside class="studio-controls"><span class="studio-kicker">EXPLORE THE PROTOTYPE</span><div class="preview-pages">${[['chat','01','对话','灵感，从一句话开始'],['bots','02','伙伴','找到你的默契搭子'],['work','03','工作台','把小事交给小队'],['me','04','我的','这里，一切都很像你']].map(([id,n,t,s])=>`<button data-tab="${id}" class="${state.tab===id?'current':''}"><span>${n}</span><div><strong>${t}</strong><small>${s}</small></div>${icon('arrow')}</button>`).join('')}</div><div class="preview-size"><button data-device="phone" class="${state.device==='phone'?'selected':''}" aria-label="手机尺寸" aria-pressed="${state.device==='phone'}">${icon('user')} 手机</button><button data-device="wide" class="${state.device==='wide'?'selected':''}" aria-label="平板尺寸" aria-pressed="${state.device==='wide'}">${icon('monitor')} 平板</button></div><p class="studio-note">点一点，认识你的新空间。<br>${connected()?'设备已连接，数据保存在本机。':'未连接电脑，当前展示示例内容。'}</p></aside><footer class="studio-footer"><span>MADE FOR A LITTLE MORE LIFE.</span><span>WEB APP CONCEPT <i>©</i> MOYUBOT</span></footer></main>`;
  if (!state.chat) {
    const content = document.querySelector('.screen-content');
    const page = document.createElement('section');
    page.className = 'tab-page';
    // Header and scroll region travel as one sheet; the dock stays outside.
    [...content.children].filter(el => !el.matches('.bottom-nav,.home-indicator')).forEach(el => page.append(el));
    content.prepend(page);
  }
  if(state.chat) document.querySelector('.message-scroll').scrollTop = document.querySelector('.message-scroll').scrollHeight;
  else if(returning) document.querySelector('.page-scroll').scrollTop = pageScrollPositions.get(state.tab) || 0;
  else if(state.preserveScroll) document.querySelector('.page-scroll').scrollTop = oldScroll;
  state.preserveScroll = false;
  if (oldNav && !state.chat) {
    document.querySelector('.bottom-nav').replaceWith(oldNav);
    oldNav.querySelectorAll('.nav-item').forEach(item => {
      const active = item.dataset.tab === state.tab;
      item.classList.toggle('active', active);
      if (active) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
  }
  positionLens(document.querySelector('.bottom-nav'), !!oldNav);
  if (navigatingChat) {
    navigationMoving = true;
    animateNavigation(returning, navigationSnapshot, () => { navigationMoving = false; flushSyncedRefresh(); });
  } else if (lastPage && pageChanged) animatePage(direction, false, outgoing);
  lastPage = key;
}

let previousFocus;
let sheetClosing = false;
function openSheet(title, subtitle, body) {
  const wasOpen = state.sheet;
  sheetClosing = false;
  state.sheet = true;
  if (!wasOpen) previousFocus = document.activeElement;
  document.querySelector('.screen-content').inert = true;
  document.querySelector('.status-bar').inert = true;
  const host = document.querySelector('.sheet-host');
  const heading = `<div><h2 id="sheet-title">${title}</h2><p>${subtitle}</p></div>${button('close','dismiss','关闭弹层')}`;
  if (wasOpen && host.querySelector('.bottom-sheet')) {
    host.querySelector('.sheet-heading').innerHTML = heading;
    host.querySelector('.sheet-content').innerHTML = body;
  } else {
    host.innerHTML = `<div class="sheet-backdrop" data-action="dismiss"></div><section class="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title"><span class="sheet-handle"></span><div class="sheet-heading">${heading}</div><div class="sheet-content">${body}</div></section>`;
    animateSheet(host.querySelector('.bottom-sheet'), host.querySelector('.sheet-backdrop'));
  }
  // Avoid iOS keyboard and viewport changes during the sheet entrance.
  host.querySelector('.sheet-heading button')?.focus({ preventScroll: true });
}
function closeSheet() {
  stopCamera();
  state.sheet = null;
  const sheet = document.querySelector('.bottom-sheet');
  const backdrop = document.querySelector('.sheet-backdrop');
  document.querySelector('.screen-content').inert = false;
  document.querySelector('.status-bar').inert = false;
  previousFocus?.focus({ preventScroll: true });
  if (!sheet) { flushSyncedRefresh(); return; }
  sheet.style.pointerEvents = 'none';
  backdrop.style.pointerEvents = 'none';
  sheetClosing = true;
  animateSheet(sheet, backdrop, true, () => { sheet.remove(); backdrop.remove(); if (!state.sheet) sheetClosing = false; flushSyncedRefresh(); });
}
let toastTimer;
function toast(message) { const el=document.querySelector('.toast'); el.textContent=message; el.classList.add('visible'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove('visible'),3000); }
function showSearch() {
  openSheet('找一找你的搭子', '名字、消息，或者一个灵感。', `<div class="search-field">${icon('search')}<input id="search-input" placeholder="搜索伙伴或最近的消息…" autocomplete="off" aria-label="搜索伙伴或消息"/></div><span class="tiny-label search-label">最近联系</span><div id="search-results">${bots.map(conversation).join('')}</div>`);

}
function newBot() {
  openSheet('认识一位新搭子', '先取个名字，再选一个合眼缘的模样。', `<form id="new-bot-form"><label class="field-label" for="bot-name">伙伴的名字</label><input class="sheet-input" id="bot-name" name="name" placeholder="比如：灵感小助手" required maxlength="16"/><label class="field-label">选择形象</label><div class="avatar-options">${bots.slice(0,4).map((b,i)=>`<label><input type="radio" name="portrait" value="${b.id}" ${i===0?'checked':''}/>${avatar(b)}${icon('check')}</label>`).join('')}</div><label class="field-label" for="bot-role">一句话介绍</label><input class="sheet-input" id="bot-role" name="role" placeholder="比如：陪我一起写点有意思的东西" maxlength="60"/><p class="form-note">先认识一下，模型和能力之后再慢慢配置。</p><button type="submit" class="primary-button full-width">就是你啦 ${icon('arrow')}</button></form>`);
}
const actions = {
  connection: () => connectionSheet(openSheet),
  search: showSearch,
  new: () => openSheet('从哪里开始？','每段好对话，都从一点好奇心开始。', `<div class="sheet-bot-list">${bots.slice(0,4).map(conversation).join('')}</div><div class="sheet-divider"></div>${settingRow('plus','认识新伙伴','给你的 AI 小队加一位成员','new-bot')}${settingRow('chat','来一场群聊','和几个伙伴一起聊聊','group')}`),
  'new-bot': newBot,
  'all-bots': () => navigate('bots'),
  dismiss: closeSheet,
  back: () => { state.chat=null; state.tab=chatOriginTab; render(); },
  theme: () => { if(state.sheet)closeSheet(); state.dark=!state.dark; state.preserveScroll=true; render(); document.querySelector('meta[name="theme-color"]').content=state.dark?'#09090b':'#ffffff'; },
  cloud: () => openSheet('你的小小云电脑','所有伙伴共用一个工作空间。', `${computerArt()}<div class="cloud-detail-stats"><span><small>当前状态</small><strong>${state.cloudAwake?'运行中':'休眠中'}</strong></span><span><small>工作空间</small><strong>/data/moyubot</strong></span><span><small>休眠策略</small><strong>空闲 3 分钟</strong></span></div><p class="form-note">需要处理文件或执行任务时，伙伴会唤醒电脑。休眠后，文件和工作进度依然保留。</p><button class="primary-button full-width" data-action="wake">${icon(state.cloudAwake?'moon':'spark')}${state.cloudAwake?'让电脑休息':'唤醒电脑'}${icon('arrow')}</button>`),
  wake: () => { const hadSheet=state.sheet; if(hadSheet)closeSheet(); state.cloudAwake=!state.cloudAwake; state.preserveScroll=true; render(); if(hadSheet)actions.cloud(); toast(state.cloudAwake?'演示：电脑醒来啦，一切准备就绪。':'演示：电脑开始休息，进度好好保留。'); },
  'bot-detail': () => { const b=bots.find(b=>b.id===state.chat); openSheet(`认识${escape(b.name)}`, b.role, `<div class="bot-detail-portrait">${avatar(b)}<h3>${escape(b.name)}</h3><span class="model-label">${escape(b.model)}</span></div><p class="detail-description">在这里，想到什么都可以聊。帮你理清思路、整理日常，也陪你放空一会儿。</p>${settingRow('spark','长期记忆','记住你的小偏好','memories')}${settingRow('cloud','共享云电脑','随时接着做事','cloud')}`); },
  'chat-options': () => openSheet('对话的小设置','让每一次聊天，都更合你的心意。', `${settingRow('bots','伙伴资料','','bot-detail')}${settingRow('spark','长期记忆','','memories')}${settingRow('folder','对话文件','','files')}`),
  files: () => openSheet('工作空间里的小成果','每一份灵感，都有好好收着。', `<div class="file-list">${[['folder','产品灵感','文件夹 · 5 个文件'],['folder','每周工作记录','文件夹 · 4 个文件'],['image','品牌灵感板.png','图片 · 2.4 MB'],['chart','十月工作小结.md','文档 · 12 KB']].map(([i,t,s])=>settingRow(i,t,s,'file-preview')).join('')}</div>`),
  'file-preview': () => toast('这是示例文件，完整文件预览将在后续接入。'),
  memories: () => connected()?syncedMemories():openSheet('记住一点点关于你','不用反复介绍，我们会越来越默契。', `<div class="memory-card"><span>${icon('pin')} 生活偏好</span><p>喜欢简洁、自然的设计，也喜欢给生活留一点空白。</p><small>来自与小深的对话 · 10 月 28 日</small></div><div class="memory-card"><span>${icon('spark')} 工作习惯</span><p>习惯先梳理思路，再动手做事。偏爱清晰、直接的表达。</p><small>来自与阿橙的对话 · 10 月 26 日</small></div><p class="form-note">这些是原型中的示例记忆。</p>`),
  preferences: () => openSheet('舒服就好','按你的习惯，慢慢调整。', `${settingRow('sun','外观模式',state.dark?'深色':'浅色','theme')}${settingRow('bell','通知偏好','','notifications')}${settingRow('shield','隐私与数据','','privacy')}`),
  profile: () => openSheet('让空间更像你','一个名字，一点心情，就是你的地盘。', `<form id="profile-form"><label class="field-label" for="profile-name">工作空间名称</label><input id="profile-name" name="name" class="sheet-input" value="${escape(profileName)}" required maxlength="20"/><p class="form-note">连接后，名称可随工作空间同步。</p><button class="primary-button full-width" type="submit">保存这个名字 ${icon('check')}</button></form>`),
  providers: () => openSheet('模型与供应商','不同的能力，在同一个小空间里。', `${bots.slice(0,4).map(b=>`<div class="provider-row">${avatar(b)}<span><strong>${escape(b.model)}</strong><small>${escape(b.role)}</small></span><span class="demo-badge">示例</span></div>`).join('')}<p class="form-note">当前为设计预览，尚未连接真实模型。</p>`),
  usage: () => openSheet('每一点灵感，都算数','这里是小队本周的工作足迹。', `<div class="usage-summary"><small>本周对话</small><strong>128 <span>次</span></strong><span>比上周多了 18 次有趣的碰撞</span></div><div class="usage-bars">${[35,65,48,90,72,57,25].map((h,i)=>`<div><span style="height:${h}%"></span><small>${['一','二','三','四','五','六','日'][i]}</small></div>`).join('')}</div><p class="form-note">数据仅用于展示页面效果。</p>`),
  connectors: () => openSheet('把熟悉的工具连起来','让你的 AI 搭子，多一点拿手好戏。', `${[['globe','Notion','笔记与知识库'],['folder','Google Drive','文件与协作'],['chat','Slack','团队消息'],['grid','GitHub','项目与代码']].map(([i,t,s])=>`<div class="connector-row"><span class="setting-icon">${icon(i)}</span><span><strong>${t}</strong><small>${s}</small></span><span class="demo-badge">即将见面</span></div>`).join('')}`),
  notifications: () => openSheet('只在需要时，轻轻提醒','给生活留白，也给消息留一点分寸。', `<div class="task-row"><span><strong>伙伴的新消息</strong><small>有新进展时告诉你</small></span><button class="toggle on" role="switch" aria-checked="true" data-local-toggle aria-label="伙伴的新消息"><span></span></button></div><div class="task-row"><span><strong>例行任务完成</strong><small>事情办好了，给你一个小提醒</small></span><button class="toggle on" role="switch" aria-checked="true" data-local-toggle aria-label="例行任务完成"><span></span></button></div><p class="form-note">这是通知样式预览，不会请求系统通知权限。</p>`),
  privacy: () => openSheet('你的空间，你做主','让信任从清晰透明开始。', `<div class="privacy-illustration">${icon('shield')}</div><h3 class="center-title">安心聊，自在做。</h3><p class="detail-description">未连接时显示示例内容。扫码并开启同步后，对话、伙伴资料和记忆会保存在本机与服务器。同步开关只控制当前设备，API 密钥和本机工具权限不会上传。</p>`),
  install: async () => { const result=await requestInstall();if(result==='accepted'||result==='installed'){toast(result==='installed'?'已安装到主屏幕':'安装已开始');return;}openSheet('把搭子，放到主屏幕','下一次见面，少一点距离。', `<div class="install-preview"><img src="./logo.webp" alt="MoyuBot 应用图标"/><strong>MoyuBot</strong></div><div class="install-step"><b>1</b><p>在手机浏览器中打开这个页面</p></div><div class="install-step"><b>2</b><p>iPhone：点击「分享」，选择「添加到主屏幕」<br>Android：打开浏览器菜单，选择「添加到主屏幕」或「安装应用」</p></div><p class="form-note">首次在线加载完成后，应用界面可离线打开。手机数据保存在本机，恢复网络后自动同步。iPhone 请使用 Safari 添加到主屏幕。</p>`); },
  attachment: () => openSheet('给灵感加点素材','有时一张图，比一段话更清楚。', `<div class="attachment-choices"><button data-action="attachment-preview">${icon('image')}图片</button><button data-action="attachment-preview">${icon('folder')}文件</button><button data-action="attachment-preview">${icon('mic')}语音</button></div><p class="form-note">附件操作仅展示交互样式，后续接入真实上传。</p>`),
  'attachment-preview': () => toast('已看到你的选择，真实上传将在后续接入。'),
  'workspace-info': () => openSheet('一个空间，一起做事','MoyuBot 共享工作台', `<p class="detail-description">伙伴们共享同一台云电脑和文件空间。任务、文件和记忆都在这里，换个设备，也能接着来。</p>${settingRow('cloud','查看云电脑','','cloud')}${settingRow('folder','浏览文件','','files')}`),
  group: () => openSheet('来一场灵感碰头会','选上几位伙伴，一起聊点有意思的。', `<form id="group-form"><label class="field-label" for="group-name">群聊名称</label><input class="sheet-input" id="group-name" name="name" placeholder="比如：周五灵感小会" maxlength="24"/><div class="group-choices">${bots.slice(0,4).map((b,i)=>`<label>${avatar(b)}<span><strong>${escape(b.name)}</strong><small>${escape(b.role)}</small></span><input type="checkbox" name="members" value="${b.id}" ${i<2?'checked':''}/></label>`).join('')}</div><button type="submit" class="primary-button full-width">大家坐好，开始聊聊 ${icon('arrow')}</button></form>`),
};
let profileName='摸鱼事务所';
const emptyBot={id:'waiting',name:'等待同步',role:'在设备与同步中开启同步',model:'未连接模型',shape:'chibi',color:'#999999',bg:'#eeeeee'};
let syncedRefreshPending = false;
function flushSyncedRefresh() {
  if (syncedRefreshPending && !state.sheet && !sheetClosing && !navigationMoving) { syncedRefreshPending = false; refreshSynced(); }
}
function refreshSynced(){
  // Incoming sync never detaches a visible sheet or restarts its animation.
  if (state.sheet || sheetClosing || navigationMoving) { syncedRefreshPending = true; return; }
  if(!connected()){if(!bots.some(b=>b.id==='deepseek')){bots.splice(0,bots.length,...structuredClone(demoBots));state.chat=null;render();}return;}
  const remote=values('bots'),convs=values('conversations').filter(c=>!c.deletedAt),messages=values('messages');
  bots.splice(0,bots.length,...remote.map(b=>{
    const conv=convs.find(c=>c.botId===b.id&&!c.group);
    const list=messages.filter(m=>m.conversationId===conv?.id).sort((a,b)=>a.createdAt-b.createdAt);
    return {id:b.id,name:b.name,providerId:b.providerId,workspaceId:b.workspaceId,model:b.model,role:'已同步的伙伴',shape:window.GROK_GEO.shapes[b.avatar?.shape]?b.avatar.shape:'chibi',color:/^#[a-f0-9]{3,8}$/i.test(b.avatar?.from)?b.avatar.from:'#999999',bg:'#eeeeee',tag:'已连接',conversationId:conv?.id,message:list.at(-1)?.content||'还没有消息',time:conv?new Date(conv.updatedAt).toLocaleDateString():'',createdAt:b.createdAt};
  }));
  for(const conv of convs.filter(c=>c.group)){
    const list=messages.filter(m=>m.conversationId===conv.id).sort((a,b)=>a.createdAt-b.createdAt);
    bots.push({...emptyBot,id:conv.id,name:conv.title,role:'共享群聊',model:'群聊',tag:'群聊',conversationId:conv.id,message:list.at(-1)?.content||'还没有消息',time:new Date(conv.updatedAt).toLocaleDateString(),group:true});
  }
  profileName=values('profile')[0]?.userName||'我的工作空间';
  if(state.chat&&!bots.some(b=>b.id===state.chat))state.chat=null;
  // Preserve open sheet, composer focus and scroll while background replication arrives.

  const active=document.activeElement,selection=active?.selectionStart;
  const scroll=document.querySelector('.page-scroll')?.scrollTop;
  state.preserveScroll=true;render();
  if(active?.id==='message-input'){const input=document.querySelector('#message-input');input?.focus({preventScroll:true});if(input&&selection!==null)input.setSelectionRange(selection,selection);}
  if(scroll!==undefined)document.querySelector('.page-scroll').scrollTop=scroll;
}
function syncedChatDetail(){
  const b=bots.find(b=>b.id===state.chat)||emptyBot;
  const conv=values('conversations').find(c=>c.id===b.conversationId);
  const messages=values('messages').filter(m=>m.conversationId===conv?.id).sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id));
  const running=runningConversation(conv?.id),awaiting=approvalCount(),queued=queuedConversation(conv?.id);
  return `<header class="chat-header">${button('back','back','返回对话列表')}<button class="chat-identity" data-action="bot-detail">${avatar(b)}<span><strong>${escape(b.name)}</strong><small>自建服务器执行</small></span></button>${button('more','chat-options','对话选项')}</header><div class="chat-model-bar"><button class="runtime-model-trigger" data-action="runtime-model">${icon('spark')}<span>${escape(b.model)} ⌄</span></button><span>${running?'正在回复':connectionStatus().enabled?'同步已开启':'同步已暂停'}</span></div>${awaiting?'<button class="runtime-notice" data-action="runtime-approvals">有 '+awaiting+' 项工具操作等待你确认 →</button>':''}<div class="page-scroll message-scroll" id="messages">${messages.length?messages.map(m=>m.role==='user'?`<div class="user-message">${escape(m.content)}<small>${new Date(m.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</small></div>`:`<div class="assistant-message">${avatar(b,'message-avatar')}<div><div class="assistant-name">${escape(m.botName||b.name)}</div><p class="synced-message">${escape(m.content||(m.streaming?'正在思考…':''))}</p>${m.error?'<p class="form-note">'+escape(m.error)+'</p>':''}</div></div>`).join(''):'<div class="empty-state"><p>选择已授权的模型，开始聊天。</p></div>'}</div><div class="composer-area">${queued?'<button class="runtime-notice" data-runtime-retry="'+escape(queued.requestId)+'">'+escape(queued.error||'等待网络恢复后发送')+' · 点击重试</button>':''}${running?'<button class="text-button" data-action="runtime-stop">停止回复</button>':''}<form class="composer" id="message-form"><textarea id="message-input" rows="1" placeholder="想到什么，就说什么…" aria-label="消息">${escape(state.drafts[b.id]||'')}</textarea><button class="send-button" type="submit" aria-label="发送消息" ${running?'disabled':''}>${icon('send')}</button></form><span class="composer-footnote">由你的服务器调用模型 · 云电脑操作需授权</span></div>`;
}
let sendingSynced=false;
async function sendSynced(text){
  const b=bots.find(b=>b.id===state.chat);if(!b||sendingSynced)return;
  if(b.group){toast('当前手机暂不支持群聊执行，请选择伙伴私聊');return;}
  sendingSynced=true;
  try{
    let id=b.conversationId;const now=Date.now();
    if(!id){id=crypto.randomUUID();put('conversations',id,{id,botId:b.id,title:b.name,workspaceId:b.workspaceId||'workspace_cloud',createdAt:now,updatedAt:now});}
    state.drafts[b.id]='';await sendChat(b,id,text);document.querySelector('#message-input')?.focus({preventScroll:true});
  }catch(e){state.drafts[b.id]=text;render();toast(e.message);}finally{sendingSynced=false;}
}
function syncedMemories(){
  const memories=values('memories');
  openSheet('长期记忆','工作空间里的记忆，也可以随身带着',`${memories.map(m=>`<div class="memory-card"><span>${icon('spark')} 已同步记忆</span><p>${escape(m.text)}</p><small>${escape(bots.find(b=>b.id===m.botId)?.name||'伙伴')}</small></div>`).join('')||'<p class="form-note">还没有同步的记忆。</p>'}<form id="sync-memory-form"><label for="memory-text" class="field-label">记下一件事</label><input class="sheet-input" id="memory-text" required maxlength="4000" placeholder="希望伙伴记住什么？"/><button class="primary-button full-width" type="submit">保存记忆</button></form>`);
}
document.addEventListener('submit',event=>{if(event.target.id==='sync-memory-form'){event.preventDefault();const text=document.querySelector('#memory-text').value.trim();if(!text||!bots.length)return;const id=crypto.randomUUID();put('memories',id,{id,text,botId:state.chat||bots[0].id,pinned:false,source:'manual',createdAt:Date.now()});syncedMemories();}});
function syncedWork(){
  const schedules=values('schedules');
  return `${header('YOUR SHARED SPACE','工作台',button('settings','connection','设备与同步'))}<div class="page-scroll">${sectionTitle('任务进度')}<p class="form-note">这里查看桌面端同步的任务。执行由电脑端负责；数据同步不会启动任务。</p>${schedules.map(s=>`<div class="task-row"><span><strong>${escape(s.title||s.prompt?.slice(0,40)||'任务')}</strong><small>${escape(s.lastStatus||'等待执行')} · ${s.enabled?'已启用':'已暂停'}</small></span></div>`).join('')||'<div class="empty-state"><p>还没有同步的任务</p></div>'}${settingRow('cloud','云电脑','连接文件与执行环境','cloud')}${settingRow('spark','模型与服务商','查看服务器已授权模型','providers')}${settingRow('spark','长期记忆','查看或添加工作空间记忆','memories')}${settingRow('monitor','设备与同步','管理连接状态','connection')}</div>`;
}
function navigate(tab) { if(state.sheet) closeSheet(); if (state.tab === tab && !state.chat) return; state.tab=tab; state.chat=null; state.filter='全部'; render(); }

document.addEventListener('click', event => {
  const el=event.target.closest('button, [data-action]'); if(!el)return;
  if(el.dataset.tab)navigate(el.dataset.tab);
  else if(el.dataset.chat){ if(state.sheet)closeSheet(); if(!state.chat)chatOriginTab=state.tab; state.chat=el.dataset.chat; render(); }
  else if(el.dataset.filter){state.filter=el.dataset.filter; state.preserveScroll=true; render();}
  else if(el.dataset.botFilter){state.botFilter=el.dataset.botFilter; state.preserveScroll=true; render();}
  else if(el.dataset.device){state.device=el.dataset.device; state.preserveScroll=true; render();}
  else if(el.dataset.task!==undefined){const i=Number(el.dataset.task); state.tasks[i]=!state.tasks[i]; el.classList.toggle('on',state.tasks[i]); el.setAttribute('aria-checked',String(state.tasks[i])); toast(state.tasks[i]?'演示：任务已开启':'演示：任务已暂停');}
  else if(el.hasAttribute('data-local-toggle')){const on=el.classList.toggle('on'); el.setAttribute('aria-checked',String(on));}
  else if(el.dataset.suggest){const input=document.querySelector('#message-input'); input.value=el.dataset.suggest; state.drafts[state.chat]=input.value; input.focus();}
  else if(el.dataset.action)actions[el.dataset.action]?.();
});
document.addEventListener('dock-select', event => { if (event.target.dataset.tab) navigate(event.target.dataset.tab); });
document.addEventListener('input',event=>{
  if(event.target.id==='search-input') { const q=event.target.value.trim().toLowerCase(); const result=bots.filter(b=>[b.name,b.role,b.message,b.model].some(t=>t.toLowerCase().includes(q))); document.querySelector('#search-results').innerHTML=result.length?result.map(conversation).join(''):'<div class="empty-state"><p>暂时没有找到，换个词试试吧。</p></div>'; }
  if(event.target.id==='message-input') { state.drafts[state.chat]=event.target.value; event.target.style.height='auto'; event.target.style.height=`${Math.min(event.target.scrollHeight,104)}px`; }
});
document.addEventListener('submit',event=>{
  event.preventDefault();
  if(event.target.id==='message-form'){
    const input=document.querySelector('#message-input');const text=input.value.trim(); if(!text)return;
    if(connected()){sendSynced(text);return;}
    state.messages[state.chat] ||= []; state.messages[state.chat].push({role:'user',text},{role:'assistant',text:'收到啦！这是设计原型里的演示回复。等接入真实模型后，我们就可以一起把这件事做好。🌿'}); state.drafts[state.chat]=''; render(); document.querySelector('#message-input').focus();
  } else if(event.target.id==='new-bot-form') {
    const form=new FormData(event.target);const base=bots.find(b=>b.id===form.get('portrait'))||bots[0]; const name=String(form.get('name')).trim(); if(!name)return;
    if(connected()){const id=crypto.randomUUID(),now=Date.now();put('bots',id,{id,name,handle:name,model:base?.model||'待配置',providerId:'openai-compatible',avatar:{shape:base?.shape||'chibi',from:'#999999',to:'#cccccc',glyph:name[0]},workspaceId:'workspace_cloud',createdAt:now,updatedAt:now});closeSheet();navigate('bots');toast('伙伴已保存；请在桌面端配置模型和能力。');return;}
    bots.push({...base,id:`demo-${Date.now()}`,name,role:String(form.get('role')).trim()||'你的新伙伴',message:'很高兴认识你，来聊聊吧。',time:'刚刚',unread:0,tag:'日常助手'});closeSheet();navigate('bots');toast('新搭子已加入这次演示，刷新后会恢复。');
  } else if(event.target.id==='profile-form') {profileName=String(new FormData(event.target).get('name')).trim()||'摸鱼事务所';if(connected())put('profile','user',{userName:profileName});closeSheet();document.querySelector('.profile-card h2').textContent=profileName;toast('这个名字，很适合你。');
  } else if(event.target.id==='group-form'){const form=new FormData(event.target); if(form.getAll('members').length<2){toast('至少叫上两位搭子，一起聊聊吧。');return;}closeSheet();toast('群聊创建流程预览完成，真实群聊将在后续接入。');}
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&state.sheet)closeSheet();
  if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.target.id==='message-input'){event.preventDefault();document.querySelector('#message-form').requestSubmit();}
  if(event.key==='Tab'&&state.sheet){const elements=[...document.querySelectorAll('.bottom-sheet button,.bottom-sheet input,.bottom-sheet [tabindex="0"]')].filter(e=>!e.disabled); const first=elements[0],last=elements.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
});
render();
Object.assign(actions,{
  'runtime-model':()=>chooseModels(state.chat),
  'runtime-stop':()=>stopChat(bots.find(b=>b.id===state.chat)?.conversationId),
  'runtime-approvals':showApprovals,
});
for(const [name,fn] of Object.entries({providers:showProviders,cloud:showCloud,files:showCloud,wake:showCloud})){const demo=actions[name];actions[name]=()=>connected()?fn():demo?.();}
installExecution({open:openSheet,close:closeSheet,toast,refresh:refreshSynced});
installMotion();
registerPwa();
initConnection(reason=>{if(reason==='open-connection'){actions.connection();return;}refreshSynced();}).catch(error=>toast('本机存储暂不可用：'+error.message));




