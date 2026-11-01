/* ============================================================
   墨鱼 · Liquid Glass 原型交互
   ============================================================ */
"use strict";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ---------- 数据 ---------- */

const BOTS = {
  aiagent: {
    name: "AI AGENT Bot", color: "#F6A518", shape: "sq", online: true, badge: true,
    time: "02:08", preview: "BIBIAI 现在值 19.45 U 左右，比成本 14…", unread: true, group: "新分组",
  },
  issue: {
    name: "issue monitor bot", color: "#E9453C", shape: "sq",
    time: "昨天", preview: "设置好了：简体中文、北京时间；X 监控…", group: "未分组",
  },
  aigc: {
    name: "AIGC Bot", color: "#F07C10", shape: "flower",
    time: "00:01", preview: "🖼 图片", previewIcon: true, group: "未分组",
  },
  gang: {
    name: "GANG TRADE BOT", color: "#EFA61B", shape: "flower",
    time: "星期一", preview: "📊 你更想先让我帮我盯哪一块？ — 行情…", group: "未分组",
  },
};

const XIAOMIAO = { id: "xiaomiao", name: "小喵", avatar: "hero" };

/* ---------- 小工具 ---------- */

// Bot 图标：squircle / 花朵 + 双竖条
function botSVG(color, shape, size = 58) {
  const bars = `<rect x="35.5" y="34" width="10.5" height="32" rx="5.2" fill="#fff"/>
                <rect x="54" y="34" width="10.5" height="32" rx="5.2" fill="#fff"/>`;
  const body = shape === "flower"
    ? `<g fill="${color}"><circle cx="50" cy="25" r="19"/><circle cx="75" cy="43" r="19"/><circle cx="66" cy="72" r="19"/><circle cx="34" cy="72" r="19"/><circle cx="25" cy="43" r="19"/><circle cx="50" cy="50" r="23"/></g>`
    : `<rect x="7" y="7" width="86" height="86" rx="27" fill="${color}"/>`;
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}">${body}${bars}</svg>`;
}

const chevDown = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`;
const STAR_BADGE = `<span class="star-badge"><svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9L12 2.6Z"/></svg></span>`;
const imgIcon = `<span class="pv-ico"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8E8E93" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="3.5"/><circle cx="9" cy="10" r="1.7" fill="#8E8E93" stroke="none"/><path d="M5 18.2l4.6-4.6 3.2 3.2 4.2-4.2 3 3" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;

/* ---------- 会话列表渲染 ---------- */

function botIconHTML(id, b, size = 58) {
  if (id === "xiaomiao") return $("#hero .hero-avatar svg").outerHTML.replace('width="100" height="100"', `width="${size}" height="${size}"`);
  if (b.shape === "custom") return `<svg viewBox="0 0 100 100" width="${size}" height="${size}">${CS_SHAPES[b.customShape].c(b.color)}${CS_EYES_BARS}</svg>`;
  return botSVG(b.color, b.shape, size);
}

function rowHTML(id, b, forSearch = false, i = 0) {
  const icon = botIconHTML(id, b, 58);
  const preview = (b.previewIcon ? imgIcon : "") + `<span class="row-preview">${b.preview ?? ""}</span>`;
  const right = forSearch
    ? `<span class="row-tag">Bot</span>`
    : `${b.time ? `<span class="row-time">${b.time}</span>` : ""}`;
  return `<button class="row pressable" data-bot="${id}"${forSearch ? ` style="--i:${i}"` : ""}>
    <span class="ava">${icon}${b.badge ? STAR_BADGE : (b.online ? `<i class="online-dot"></i>` : "")}</span>
    <span class="row-main">
      <span class="row-top"><span class="row-name">${b.name}</span>${right}</span>
      ${forSearch ? "" : `<span class="row-sub">${preview}${b.unread ? `<i class="unread"></i>` : ""}</span>`}
    </span>
  </button>`;
}

function renderHome() {
  const groups = {};
  Object.entries(BOTS).forEach(([id, b]) => (groups[b.group] ??= []).push(id));
  $("#chatList").innerHTML = Object.entries(groups).map(([g, ids]) => `
    <button class="group-head" data-g="${g}">${g} ${chevDown}</button>
    <div class="group-body">${ids.map((id) => rowHTML(id, BOTS[id])).join("")}</div>
  `).join("");
}

function renderSearch(filter = "all", kw = "") {
  const kwq = kw.trim().toLowerCase();
  const pool = [["xiaomiao", XIAOMIAO], ...Object.entries(BOTS)];
  const items = pool
    .filter(([, b]) => b.name.toLowerCase().includes(kwq))
    .filter(([, b]) =>
      filter === "all" || filter === "msg" || filter === "bot" ? true : false
    );
  $("#searchResults").innerHTML = items
    .map(([id, b], i) => rowHTML(id, b, true, i))
    .join("");
  $("#searchEmpty").hidden = items.length > 0;
}

/* ---------- 按压反馈（压缩→弹簧回弹） ---------- */

document.addEventListener("pointerdown", (e) => {
  const t = e.target.closest(".pressable");
  if (!t) return;
  t.classList.add("pressed");
});
["pointerup", "pointercancel", "pointerleave"].forEach((ev) =>
  document.addEventListener(ev, () => $$(".pressed").forEach((t) => t.classList.remove("pressed")), { passive: true })
);

/* ---------- 玻璃高光跟随指尖 ---------- */

document.addEventListener("pointermove", (e) => {
  const g = e.target.closest(".glass");
  if (!g || !g.hasAttribute("data-glint")) return;
  const r = g.getBoundingClientRect();
  g.style.setProperty("--gx", ((e.clientX - r.left) / r.width) * 100 + "%");
  g.style.setProperty("--gy", ((e.clientY - r.top) / r.height) * 100 + "%");
}, { passive: true });

document.addEventListener("pointerdown", (e) => {
  const g = e.target.closest(".glass[data-glint]");
  if (g) g.classList.add("glint-on");
}, { passive: true });
["pointerup", "pointercancel"].forEach((ev) =>
  document.addEventListener(ev, () => $$(".glint-on").forEach((g) => g.classList.remove("glint-on")), { passive: true })
);

/* ---------- 导航：会话列表 ⇄ 聊天 ---------- */

const homeView = $("#view-home");
const chatView = $("#view-chat");
const profileView = $("#view-profile");
const chatScroll = $("#chatScroll");
let currentBotId = "aiagent";

function openChat(id) {
  const b = id === "xiaomiao" ? XIAOMIAO : BOTS[id];
  if (!b) return;
  currentBotId = id;
  $("#chatTitleName").textContent = b.name;
  $("#chatTitleIcon").innerHTML = botIconHTML(id, b, 31);
  if (id !== "xiaomiao" && b.online) $("#chatTitleIcon").classList.add("has-dot");
  $("#composerInput").placeholder = `向 ${b.name} 提问`;

  homeView.classList.add("pushed");
  chatView.classList.add("active");
  chatView.setAttribute("aria-hidden", "false");

  requestAnimationFrame(() => {
    chatScroll.scrollTop = chatScroll.scrollHeight;
    cascade();
  });
}

function closeChat() {
  toggleChatMenu(false);
  homeView.classList.remove("pushed");
  chatView.classList.remove("active");
  chatView.setAttribute("aria-hidden", "true");
}

// 首次打开：消息瀑布式弹入
function cascade() {
  $$(".msg, .unread-divider, .subagent", chatScroll).forEach((el, i) => {
    el.classList.remove("enter");
    void el.offsetWidth; // 重新触发动画
    el.classList.add("enter");
    el.style.animationDelay = `${i * 55}ms`;
  });
}

$("#backBtn").addEventListener("click", closeChat);
$("#chatList").addEventListener("click", (e) => {
  const row = e.target.closest(".row");
  if (row) openChat(row.dataset.bot);
});

/* ---------- Bot 资料页 ---------- */

function openProfile() {
  const b = currentBotId === "xiaomiao" ? XIAOMIAO : BOTS[currentBotId];
  if (!b) return;
  $("#profileName").textContent = b.name;
  $("#profileIcon").innerHTML =
    botIconHTML(currentBotId, b, 150) +
    `<span class="star-badge"><svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9L12 2.6Z"/></svg></span>`;
  chatView.classList.add("pushed");
  profileView.classList.add("active");
  profileView.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => ($("#profileScroll").scrollTop = 0));
}

function closeProfile() {
  chatView.classList.remove("pushed");
  profileView.classList.remove("active");
  profileView.setAttribute("aria-hidden", "true");
}

$("#chatTitle").addEventListener("click", openProfile);
$("#profileBackBtn").addEventListener("click", closeProfile);
$("#profileMoreBtn").addEventListener("click", () => {});
$("#editBtn").addEventListener("click", () => {});
$("#notifyToggle").addEventListener("click", function () {
  this.classList.toggle("on");
  this.setAttribute("aria-checked", this.classList.contains("on"));
});

/* ---------- 定时任务页 ---------- */

const tasksView = $("#view-tasks");

function openTasks() {
  profileView.classList.add("pushed");
  tasksView.classList.add("active");
  tasksView.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => ($("#tasksScroll").scrollTop = 0));
}

function closeTasks() {
  profileView.classList.remove("pushed");
  tasksView.classList.remove("active");
  tasksView.setAttribute("aria-hidden", "true");
}

$("#pfTasksRow").addEventListener("click", openTasks);
$("#tasksBackBtn").addEventListener("click", closeTasks);

$("#view-tasks").addEventListener("click", (e) => {
  const sw = e.target.closest(".task-switch");
  if (!sw) return;
  sw.classList.toggle("on");
  sw.setAttribute("aria-checked", sw.classList.contains("on"));
  const status = sw.closest(".task-item")?.querySelector(".task-status");
  if (status) status.textContent = sw.classList.contains("on") ? "运行中" : "已暂停";
});

$("#pfTasksRow").addEventListener("click", openTasks);
$("#tasksBackBtn").addEventListener("click", closeTasks);

$("#view-tasks").addEventListener("click", (e) => {
  const sw = e.target.closest(".task-switch");
  if (!sw) return;
  sw.classList.toggle("on");
  sw.setAttribute("aria-checked", sw.classList.contains("on"));
  const status = sw.closest(".task-item")?.querySelector(".task-status");
  if (status) status.textContent = sw.classList.contains("on") ? "运行中" : "已暂停";
});

/* ---------- 资料库页 ---------- */

// fav: x | bsc | globe
const LIB_ITEMS = [
  { fav: "x", title: "x.com/adita66_/status/2116396836120505422", sub: "x.com" },
  { fav: "bsc", title: "bscscan.com/address/0x096243e21b2926d3cc2f16c31d01a2b6e3a1c8f2", sub: "bscscan.com" },
  { fav: "x", title: "x.com/SAFUFundBNB/status/2116396836120505422", sub: "x.com" },
  { fav: "globe", title: "safufund.live", sub: "safufund.live" },
  { fav: "x", title: "x.com/agentmao_/status/2116370416060375042", sub: "x.com" },
  { fav: "globe", title: "agentmao.fun", sub: "agentmao.fun" },
  { fav: "bsc", title: "bscscan.com/tx/0xd515d657f4fc6a9c21d0f0d8f5e1b2a3c4d5e6f7", sub: "bscscan.com" },
  { fav: "bsc", title: "bscscan.com/tx/0x1c2dc124b17f9a8b7c6d5e4f3a2b1c0d9e8f7a6b", sub: "bscscan.com" },
  { fav: "globe", title: "quorumkin.pages.dev", sub: "quorumkin.pages.dev" },
  { fav: "globe", title: "agentsloth.netlify.app", sub: "agentsloth.netlify.app" },
];

const LIB_FAV = {
  x: `<span class="fav fav-x"><svg width="17" height="17" viewBox="0 0 24 24" fill="#fff"><path d="M17.7 3H21l-7.3 8.3L22.2 21h-6.7l-5.3-6.2L4.2 21H1l7.8-8.9L1.5 3h6.9l4.8 5.6L17.7 3Zm-1.2 16h1.9L6.4 4.9H4.4L16.5 19Z"/></svg></span>`,
  bsc: `<svg width="38" height="38" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="#0E1B33"/><rect x="9.5" y="19" width="4.6" height="10" rx="2.3" fill="#fff"/><rect x="17.7" y="13.5" width="4.6" height="15.5" rx="2.3" fill="#fff"/><rect x="25.9" y="8.5" width="4.6" height="20.5" rx="2.3" fill="#F8B33E"/></svg>`,
  globe: `<span class="fav fav-globe"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="8.6"/><path d="M3.4 12h17.2M12 3.4c3 3.4 3 13.8 0 17.2-3-3.4-3-13.8 0-17.2Z"/></svg></span>`,
};

function renderLibrary() {
  $("#libList").innerHTML = LIB_ITEMS.map((it) => `
    <button class="lib-item">
      <span class="lib-ico">${LIB_FAV[it.fav]}</span>
      <span class="lib-main">
        <span class="lib-title">${it.title}</span>
        <span class="lib-sub">${it.sub}</span>
      </span>
    </button>`).join("");
}

const libraryView = $("#view-library");

function openLibrary() {
  profileView.classList.add("pushed");
  libraryView.classList.add("active");
  libraryView.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => ($("#libraryScroll").scrollTop = 0));
}

function closeLibrary() {
  profileView.classList.remove("pushed");
  libraryView.classList.remove("active");
  libraryView.setAttribute("aria-hidden", "true");
}

$("#pfLibraryRow").addEventListener("click", openLibrary);
$("#libraryBackBtn").addEventListener("click", closeLibrary);
attachEdgeSwipe(libraryView, closeLibrary);

$("#pfLibraryRow").addEventListener("click", openLibrary);
$("#libraryBackBtn").addEventListener("click", closeLibrary);
attachEdgeSwipe(libraryView, closeLibrary);

/* ---------- 电脑（远程屏幕）页 ---------- */

const pcView = $("#view-pc");

function openPc() {
  const b = currentBotId === "xiaomiao" ? XIAOMIAO : BOTS[currentBotId];
  $("#pcTitleName").textContent = b?.name ?? "AI AGENT Bot";
  $("#pcTitleIcon").innerHTML = currentBotId === "xiaomiao"
    ? $("#hero .hero-avatar svg").outerHTML.replace('width="100" height="100"', "")
    : botSVG(b.color, b.shape, 32);
  profileView.classList.add("pushed");
  pcView.classList.add("active");
  pcView.setAttribute("aria-hidden", "false");
}

function closePc() {
  profileView.classList.remove("pushed");
  pcView.classList.remove("active");
  pcView.setAttribute("aria-hidden", "true");
}

$("#pfPcRow").addEventListener("click", openPc);
$("#pcBackBtn").addEventListener("click", closePc);
$("#pcHelpBtn").addEventListener("click", () => {});
$("#takeoverBtn").addEventListener("click", () => {});
attachEdgeSwipe(pcView, closePc);

/* ---------- 已隐藏对话页 ---------- */

const hiddenView = $("#view-hidden");

function openHidden() {
  homeView.classList.add("pushed");
  hiddenView.classList.add("active");
  hiddenView.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => ($("#hiddenScroll").scrollTop = 0));
}

function closeHidden() {
  homeView.classList.remove("pushed");
  hiddenView.classList.remove("active");
  hiddenView.setAttribute("aria-hidden", "true");
}

$("#hiddenRow").addEventListener("click", openHidden);
$("#hiddenBackBtn").addEventListener("click", closeHidden);
$("#hiddenHelpBtn").addEventListener("click", () => {});
attachEdgeSwipe(hiddenView, closeHidden);

$("#hiddenList").addEventListener("click", (e) => {
  const btn = e.target.closest(".unhide-btn");
  if (!btn) return;
  const item = btn.closest(".hidden-item");
  item.style.transition = "opacity .3s ease, transform .45s var(--spring)";
  item.style.opacity = "0";
  item.style.transform = "scale(.9)";
  setTimeout(() => {
    item.remove();
    if (!$("#hiddenList").children.length) $("#hiddenEmpty").hidden = false;
  }, 330);
});

/* ---------- 聊天「…」菜单 ---------- */

const chatMenu = $("#chatMenu");
const chatMenuScrim = $("#chatMenuScrim");

function toggleChatMenu(force) {
  const open = force ?? !chatMenu.classList.contains("open");
  chatMenu.classList.toggle("open", open);
  chatMenuScrim.classList.toggle("on", open);
}

$("#moreBtn").addEventListener("click", () => toggleChatMenu());
chatMenuScrim.addEventListener("click", () => toggleChatMenu(false));

chatMenu.addEventListener("click", (e) => {
  const item = e.target.closest(".chat-menu-item");
  if (!item) return;
  toggleChatMenu(false);
  if (item.dataset.act === "profile") openProfile();
});

/* ---------- 主页「+」菜单 ---------- */

const homeMenu = $("#homeMenu");
const homeMenuScrim = $("#homeMenuScrim");

function toggleHomeMenu(force) {
  const open = force ?? !homeMenu.classList.contains("open");
  homeMenu.classList.toggle("open", open);
  homeMenuScrim.classList.toggle("on", open);
}

$("#addBtn").addEventListener("click", () => toggleHomeMenu());
homeMenuScrim.addEventListener("click", () => toggleHomeMenu(false));
homeMenu.addEventListener("click", (e) => {
  const item = e.target.closest(".chat-menu-item");
  if (!item) return;
  toggleHomeMenu(false);
  if (item.dataset.act === "newbot") openCreateSheet();
  if (item.dataset.act === "newgroup") openGroupSheet();
});

/* ---------- 新建群聊 弹层（两步） ---------- */

const GS_EXTRA = {
  xpost: { name: "X POST BOT", color: "#0f0f0f", shape: "splat" },
};
const GS_MEMBERS = ["aiagent", "xiaomiao", "aigc", "xpost", "gang", "issue"];
const SPLAT_SVG = `<svg viewBox="0 0 100 100"><path d="M50 5 C58 33 67 42 95 50 C67 58 58 67 50 95 C42 67 33 58 5 50 C33 42 42 33 50 5 Z" fill="#0f0f0f" transform="rotate(-8 50 50)"/><rect x="39" y="38" width="8.5" height="24" rx="4.2" fill="#fff"/><rect x="52.5" y="38" width="8.5" height="24" rx="4.2" fill="#fff"/></svg>`;
const gsSel = new Set(["aiagent", "xiaomiao"]);
const groupSheet = $("#groupSheet");
const groupScrim = $("#groupScrim");

function gsIcon(id, size) {
  if (id === "xpost") return `<svg viewBox="0 0 100 100" width="${size}" height="${size}">${SPLAT_SVG}</svg>`;
  return botIconHTML(id, id === "xiaomiao" ? XIAOMIAO : BOTS[id], size);
}

function gsRenderList(kw = "") {
  const q = kw.trim().toLowerCase();
  $("#gsList").innerHTML = GS_MEMBERS
    .filter((id) => (GS_EXTRA[id] || BOTS[id] || XIAOMIAO).name.toLowerCase().includes(q))
    .map((id) => {
      const b = GS_EXTRA[id] || BOTS[id] || XIAOMIAO;
      return `<button class="gs-row${gsSel.has(id) ? " sel" : ""}" data-id="${id}">
        <span class="ava">${gsIcon(id, 47)}</span>
        <span class="gs-row-name">${b.name}</span>
        <svg class="gs-check" viewBox="0 0 24 24" fill="none" stroke="#101013" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5.2 5L20 6.5"/></svg>
      </button>`;
    }).join("");
  $("#gsCount").textContent = `${gsSel.size} selected`;
}

function gsRenderStack() {
  const ids = [...gsSel];
  $("#gsStack").innerHTML = ids.slice(0, 2).map((id, i) =>
    `<span class="gs-stack-ico" style="transform:translate(${i * 36 - 18}px,${i * 30 - 15}px) rotate(${i ? 0 : -10}deg);z-index:${i}">${gsIcon(id, 92)}</span>`
  ).join("") || "";
}

function openGroupSheet() {
  groupSheet.classList.add("active");
  groupSheet.setAttribute("aria-hidden", "false");
  groupScrim.classList.add("on");
  gsRenderList();
}

function closeGroupSheet() {
  groupSheet.classList.remove("active", "step2");
  groupSheet.setAttribute("aria-hidden", "true");
  groupScrim.classList.remove("on");
  $("#groupNextBtn").hidden = false;
  $("#groupBackBtn").hidden = true;
  $("#groupTopSpacer").hidden = true;
  $("#gsSearch").value = "";
  $("#gsName").value = "";
  $("#gsSearch").blur();
  $("#gsName").blur();
}

function gsSetStep(step2) {
  groupSheet.classList.toggle("step2", step2);
  $("#groupCloseBtn").hidden = step2;
  $("#groupNextBtn").hidden = step2;
  $("#groupBackBtn").hidden = !step2;
  $("#groupTopSpacer").hidden = !step2;
  if (step2) { gsRenderStack(); setTimeout(() => $("#gsName").focus({ preventScroll: true }), 420); }
}

$("#groupCloseBtn").addEventListener("click", closeGroupSheet);
groupScrim.addEventListener("click", closeGroupSheet);
$("#groupNextBtn").addEventListener("click", () => gsSetStep(true));
$("#groupBackBtn").addEventListener("click", () => gsSetStep(false));
$("#gsSkipBtn").addEventListener("click", closeGroupSheet);
$("#gsName").addEventListener("keydown", (e) => { if (e.key === "Enter") closeGroupSheet(); });

$("#gsList").addEventListener("click", (e) => {
  const row = e.target.closest(".gs-row");
  if (!row) return;
  const id = row.dataset.id;
  gsSel.has(id) ? gsSel.delete(id) : gsSel.add(id);
  row.classList.toggle("sel", gsSel.has(id));
  $("#gsCount").textContent = `${gsSel.size} selected`;
  if (groupSheet.classList.contains("step2")) gsRenderStack();
});

$("#gsSearch").addEventListener("input", () => gsRenderList($("#gsSearch").value));

/* ---------- 创建新 Bot 弹层 ---------- */

const CS_EYES_BARS = `<rect x="35" y="41" width="9.5" height="23" rx="4.7" fill="#fff"/><rect x="55.5" y="41" width="9.5" height="23" rx="4.7" fill="#fff"/>`;
const CS_EYES_ARC = `<path d="M30 44q7 -10 14 0" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M56 44q7 -10 14 0" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round"/>`;

const CS_SHAPES = [
  { c: (v) => `<circle cx="50" cy="52" r="40" fill="${v}"/>` },
  { c: (v) => `<g fill="${v}"><circle cx="27" cy="58" r="21"/><circle cx="50" cy="41" r="24"/><circle cx="73" cy="58" r="21"/><rect x="23" y="49" width="54" height="30" rx="15"/></g>` },
  { c: (v) => `<rect x="17" y="17" width="66" height="66" rx="20" fill="${v}" transform="rotate(8 50 50)"/>` },
  { c: (v) => `<g fill="${v}"><rect x="37" y="9" width="26" height="82" rx="13"/><rect x="9" y="37" width="82" height="26" rx="13"/></g>` },
  { c: (v) => `<g fill="${v}"><circle cx="50" cy="25" r="19"/><circle cx="75" cy="43" r="19"/><circle cx="66" cy="72" r="19"/><circle cx="34" cy="72" r="19"/><circle cx="25" cy="43" r="19"/><circle cx="50" cy="50" r="23"/></g>` },
  { c: (v) => `<path d="M50 85 C20 63 11 44 19 30 C26 17 43 17 50 30 C57 17 74 17 81 30 C89 44 80 63 50 85 Z" fill="${v}"/>` },
  { c: (v) => `<g fill="${v}">${[0,1,2,3,4,5].map(i=>{const a=i*Math.PI/3-Math.PI/2;return `<circle cx="${50+27*Math.cos(a)}" cy="${50+27*Math.sin(a)}" r="17"/>`}).join("")}<circle cx="50" cy="50" r="25"/></g>` },
  { c: (v) => `<path d="M50 10 C68 10 84 34 84 58 C84 78 69 90 50 90 C31 90 16 78 16 58 C16 34 32 10 50 10 Z" fill="${v}"/>` },
  { c: (v) => `<rect x="7" y="30" width="86" height="40" rx="20" fill="${v}"/>` },
  { c: (v) => `<path d="M50 13 L87 75 L13 75 Z" fill="${v}" stroke="${v}" stroke-width="19" stroke-linejoin="round"/>` },
  { c: (v) => `<path d="M50 9 L89 37 L74 84 L26 84 L11 37 Z" fill="${v}" stroke="${v}" stroke-width="15" stroke-linejoin="round"/>` },
  { c: (v) => `<g fill="${v}">${[0,1,2,3,4,5,6].map(i=>{const a=i*2*Math.PI/7-Math.PI/2;return `<circle cx="${50+30*Math.cos(a)}" cy="${50+30*Math.sin(a)}" r="15"/>`}).join("")}<circle cx="50" cy="50" r="29"/></g>` },
  { c: (v) => `<path d="M30 15 L70 15 L91 50 L70 85 L30 85 L9 50 Z" fill="${v}" stroke="${v}" stroke-width="15" stroke-linejoin="round"/>` },
  { c: (v) => `<rect x="45" y="8" width="10" height="18" rx="5" fill="#7A4A21"/><ellipse cx="50" cy="57" rx="41" ry="34" fill="${v}"/>`, fixed: "#E87A1F" },
];

const CS_COLORS = ["#111114", "#8B6C42", "#E9453C", "#F07C10", "#F6A518", "#4CAF50", "#35B8A5", "#2F7CF6", "#8B5CF6", "#E935A1", "#8E8E93"];

const createSheet = $("#createSheet");
const createScrim = $("#createScrim");
let csShapeIdx = 9;   // 默认：圆角三角（与参考图一致）
let csColorIdx = 6;   // 默认：湖绿

function csShapeColor(i) { return CS_SHAPES[i].fixed || CS_COLORS[csColorIdx]; }

function csRenderPreview() {
  $("#csPreview").innerHTML =
    `<svg viewBox="0 0 100 100">${CS_SHAPES[csShapeIdx].c(csShapeColor(csShapeIdx))}${CS_EYES_ARC}</svg>`;
}

function csRenderGrid() {
  $("#csShapes").innerHTML = CS_SHAPES.map((s, i) =>
    `<button class="cs-shape${i === csShapeIdx ? " sel" : ""}" data-i="${i}" aria-label="形状 ${i + 1}">
      <svg viewBox="0 0 100 100">${s.c(csShapeColor(i))}${CS_EYES_BARS}</svg>
    </button>`).join("");
}

function csRenderColors() {
  $("#csColors").innerHTML = CS_COLORS.map((c, i) =>
    `<button class="cs-dot${i === csColorIdx ? " sel" : ""}" data-i="${i}" style="background:${c}" aria-label="颜色 ${i + 1}"></button>`).join("");
}

function openCreateSheet() {
  createSheet.classList.add("active");
  createSheet.setAttribute("aria-hidden", "false");
  createScrim.classList.add("on");
  csRenderPreview();
  requestAnimationFrame(() => setTimeout(() => $("#csName").focus({ preventScroll: true }), 420));
}

function closeCreateSheet() {
  createSheet.classList.remove("active");
  createSheet.setAttribute("aria-hidden", "true");
  createScrim.classList.remove("on");
  $("#csName").blur();
}

$("#createCloseBtn").addEventListener("click", closeCreateSheet);
createScrim.addEventListener("click", closeCreateSheet);

$("#csShapes").addEventListener("click", (e) => {
  const b = e.target.closest(".cs-shape");
  if (!b) return;
  csShapeIdx = Number(b.dataset.i);
  csRenderGrid();
  csRenderPreview();
});

$("#csColors").addEventListener("click", (e) => {
  const b = e.target.closest(".cs-dot");
  if (!b) return;
  csColorIdx = Number(b.dataset.i);
  csRenderColors();
  csRenderPreview();
  csRenderGrid();
});

$("#csName").addEventListener("input", () => {
  $("#csCreateBtn").disabled = !$("#csName").value.trim();
});

$("#csCreateBtn").addEventListener("click", () => {
  const name = $("#csName").value.trim();
  if (!name) return;
  const id = `cs_${Date.now()}`;
  BOTS[id] = {
    name, color: csShapeColor(csShapeIdx),
    shape: "custom", customShape: csShapeIdx,
    time: "刚刚", preview: "打个招呼吧 👋", group: "未分组",
  };
  renderHome();
  closeCreateSheet();
  $("#csName").value = "";
  $("#csCreateBtn").disabled = true;
});

/* iOS 侧滑返回（聊天页与资料页通用） */
function attachEdgeSwipe(viewEl, onClose) {
  let startX = 0, dragging = false, w = 0;
  viewEl.addEventListener("pointerdown", (e) => {
    if (!viewEl.classList.contains("active")) return;
    if (e.clientX - viewEl.getBoundingClientRect().left > 32) return;
    if (e.target.closest("input, .glass")) return;
    startX = e.clientX; dragging = true; w = viewEl.clientWidth;
    viewEl.classList.add("dragging");
  });
  viewEl.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = Math.max(0, e.clientX - startX);
    viewEl.style.transform = `translateX(${dx}px)`;
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    const dx = Math.max(0, e.clientX - startX);
    viewEl.classList.remove("dragging");
    void viewEl.offsetWidth; // 先恢复 transition，再释放内联 transform，让 CSS 曲线接管
    viewEl.style.transform = "";
    if (dx > Math.min(120, w * 0.32)) onClose();
  };
  viewEl.addEventListener("pointerup", end);
  viewEl.addEventListener("pointercancel", end);
}
attachEdgeSwipe(chatView, closeChat);
attachEdgeSwipe(profileView, closeProfile);
attachEdgeSwipe(tasksView, closeTasks);

/* ---------- 搜索：玻璃药丸 FLIP 形变 ---------- */

const searchView = $("#view-search");
const openSearchBtn = $("#openSearch");
const searchInput = $("#searchInput");
const closeSearchBtn = $("#closeSearch");

let searchAnimating = false;

function openSearch() {
  if (searchAnimating || searchView.classList.contains("active")) return;
  searchAnimating = true;
  searchView.classList.add("active");
  searchView.setAttribute("aria-hidden", "false");
  setTimeout(() => searchAnimating = false, 480);
  setTimeout(() => searchInput.focus({ preventScroll: true }), 200);
}

function closeSearch() {
  if (searchAnimating || !searchView.classList.contains("active")) return;
  searchAnimating = true;
  searchInput.blur();
  searchView.classList.remove("active");
  searchView.setAttribute("aria-hidden", "true");
  setTimeout(() => searchAnimating = false, 340);
}

openSearchBtn.addEventListener("click", openSearch);
closeSearchBtn.addEventListener("click", closeSearch);
searchInput.addEventListener("input", () => renderSearch(activeFilter, searchInput.value));
searchInput.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSearch(); });
$("#searchResults").addEventListener("click", (e) => {
  const row = e.target.closest(".row");
  if (row) { closeSearch(); setTimeout(() => openChat(row.dataset.bot), 200); }
});

/* ---------- 分组筛选药丸（弹簧滑动） ---------- */

const chipsBar = $("#chipsBar");
const chipThumb = $("#chipThumb");
const chips = $$(".chip", chipsBar);
let activeFilter = "all";

function placeThumb(animate = true) {
  const active = chips.find((c) => c.classList.contains("on"));
  if (!active) return;
  if (!animate) chipThumb.style.transition = "none";
  chipThumb.style.left = active.offsetLeft + "px";
  chipThumb.style.width = active.offsetWidth + "px";
  if (!animate) {
    void chipThumb.offsetWidth;
    chipThumb.style.transition = "";
  }
}

chipsBar.addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip || chip.classList.contains("on")) return;
  chips.forEach((c) => c.classList.remove("on"));
  chip.classList.add("on");
  placeThumb();
  activeFilter = chip.dataset.f;
  renderSearch(activeFilter, searchInput.value);
});

/* ---------- 分组折叠 ---------- */

$("#chatList").addEventListener("click", (e) => {
  const head = e.target.closest(".group-head");
  if (!head) return;
  head.classList.toggle("collapsed");
  head.nextElementSibling.classList.toggle("collapsed");
});

/* ---------- 子任务卡展开 ---------- */

$("#subagentChip").addEventListener("click", () => {
  $("#subagent").classList.toggle("open");
});

/* ---------- 发消息（模拟回复流） ---------- */

const composerInput = $("#composerInput");
const canned = [
  "收到，我先去查一下，有结果马上告诉你。",
  "好的，我分三步来：先查数据源，再交叉对比挂单，最后给你一份结论摘要。",
  "查到了：流动性正常，24h 成交略有回落，详细数据我整理好发你。",
];
let cannedIdx = 0;

function addMsg(cls, html) {
  const el = document.createElement("div");
  el.className = `msg ${cls} enter`;
  el.innerHTML = html;
  chatScroll.appendChild(el);
  chatScroll.scrollTop = chatScroll.scrollHeight;
  return el;
}

function send() {
  const t = composerInput.value.trim();
  if (!t) return;
  composerInput.value = "";
  addMsg("me", t);

  setTimeout(() => {
    const ty = document.createElement("div");
    ty.className = "msg bot typing";
    ty.innerHTML = "<i></i><i></i><i></i>";
    chatScroll.appendChild(ty);
    chatScroll.scrollTop = chatScroll.scrollHeight;

    setTimeout(() => {
      ty.remove();
      addMsg("bot", canned[cannedIdx++ % canned.length]);
    }, 1500);
  }, 550);
}

composerInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); send(); }
});
$("#voiceBtn").addEventListener("click", send);
$("#meBtn").addEventListener("click", () => {});

/* ---------- 键盘高度（iPhone Safari 视口补偿） ---------- */

if (window.visualViewport) {
  const vv = window.visualViewport;
  const update = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty("--kb", kb + "px");
  };
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
}

/* ---------- 桌面预览：Esc 关闭 ---------- */

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (groupSheet.classList.contains("active")) closeGroupSheet();
  else if (createSheet.classList.contains("active")) closeCreateSheet();
  else if (searchView.classList.contains("active")) closeSearch();
});

/* ---------- 滚动视差：首页 hero 液态缩放 ---------- */

(() => {
  const hero = $("#hero");
  const sc = $("#homeScroll");
  sc.addEventListener("scroll", () => {
    const y = Math.min(sc.scrollTop, 220);
    hero.style.transform = `translateY(${-y * 0.28}px) scale(${1 - y * 0.0009})`;
    hero.style.opacity = String(Math.max(0, 1 - y / 190));
  }, { passive: true });
})();

/* ---------- 启动 ---------- */

renderHome();
renderSearch();
renderLibrary();
csRenderGrid();
csRenderColors();
$("#subagentIcon").innerHTML = botSVG("#F6A518", "sq", 31);
$("#chatTitleIcon").innerHTML = botSVG("#F6A518", "sq", 31);

requestAnimationFrame(() => requestAnimationFrame(() => placeThumb(false)));
window.addEventListener("resize", () => placeThumb(false));
