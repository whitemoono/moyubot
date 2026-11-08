// InstaBox 视频封面：免费 4 核 8G 云服务器能拿来干嘛？
// 设计语言沿用 media/moyubot-film-v2/cover.js：深蓝网格 + 荧光绿强调 + 右侧产品窗口。
// 改文案或构图只需改本文件，然后运行 node render.cjs。
(function () {
  const W = 1920, BASE = 1080;
  const LIME = '#dfff72', LIME2 = '#cfff6c', WHITE = '#fff', SUB = '#c1d2ee';
  const YAHEI = '"Microsoft YaHei","PingFang SC",sans-serif';
  const MONO = 'Consolas,"Cascadia Mono",monospace';

  function build(canvas, height, scale) {
    canvas.width = W * scale;
    canvas.height = height * scale;
    const c = canvas.getContext('2d');
    c.setTransform(scale, 0, 0, scale, 0, 0);
    c.textBaseline = 'alphabetic';
    c.textAlign = 'left';

    const rr = (x, y, w, h, r, fill, stroke, lw = 2) => {
      c.beginPath(); c.roundRect(x, y, w, h, r);
      if (fill) { c.fillStyle = fill; c.fill(); }
      if (stroke) { c.lineWidth = lw; c.strokeStyle = stroke; c.stroke(); }
    };
    const font = (size, weight, f) => { c.font = `${weight} ${size}px ${f}`; };
    const tw = (s, size, weight, f = YAHEI) => { font(size, weight, f); return c.measureText(s).width; };
    const text = (s, x, y, size, color = WHITE, weight = 900, f = YAHEI) => {
      font(size, weight, f); c.fillStyle = color; c.fillText(s, x, y);
    };
    const tcenter = (s, x, y, size, color = WHITE, weight = 900, f = YAHEI) => {
      font(size, weight, f); c.fillStyle = color; c.textAlign = 'center';
      c.fillText(s, x, y); c.textAlign = 'left';
    };
    const line = (x, y, X, Y, color, width = 2) => {
      c.beginPath(); c.moveTo(x, y); c.lineTo(X, Y);
      c.lineWidth = width; c.strokeStyle = color; c.stroke();
    };
    const dot = (x, y, r, color) => { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fillStyle = color; c.fill(); };

    // 等轴方块 logo（无现成标，用几何体表达“盒子”）
    const cube = (x, y, size) => {
      const g = c.createLinearGradient(x, y, x + size, y + size);
      g.addColorStop(0, '#4d7dff'); g.addColorStop(1, '#1d3c9e');
      rr(x, y, size, size, size * 0.24, g, '#9fc0ff55', 2);
      const cx = x + size / 2, cy = y + size / 2, s = size * 0.225;
      const p0 = [cx, cy - s], p1 = [cx + s, cy - s * 0.52], p2 = [cx + s, cy + s * 0.58],
        p3 = [cx, cy + s * 1.06], p4 = [cx - s, cy + s * 0.58], p5 = [cx - s, cy - s * 0.52];
      const face = (a, b, d, fill) => {
        c.beginPath(); c.moveTo(...a); c.lineTo(...b); c.lineTo(...d); c.lineTo(cx, cy); c.closePath();
        c.fillStyle = fill; c.fill();
      };
      face(p5, p0, p1, '#ffffff'); face(p5, p4, p3, '#b9d1ff'); face(p1, p2, p3, '#94b6ff');
      c.beginPath(); c.moveTo(...p0); for (const p of [p1, p2, p3, p4, p5]) c.lineTo(...p);
      c.closePath(); c.lineWidth = 2.6; c.strokeStyle = '#1b3aa0'; c.stroke();
      for (const p of [p5, p1, p3]) line(cx, cy, p[0], p[1], '#1b3aa0', 2.4);
    };

    const chip = (x, y, label, tint = '#7fe0a0') => {
      const w = tw(label, 22, 600, MONO) + 66;
      c.save(); c.shadowColor = '#04101faa'; c.shadowBlur = 18; c.shadowOffsetY = 8;
      rr(x, y, w, 52, 26, '#12294bdd', '#8fb4ff40', 1.6);
      c.restore();
      dot(x + 27, y + 26, 6.5, tint);
      text(label, x + 44, y + 34, 22, '#dbe8ff', 600, MONO);
    };

    // ---------- 背景 ----------
    const bg = c.createLinearGradient(0, 0, W, height);
    bg.addColorStop(0, '#07172d'); bg.addColorStop(0.54, '#102b55'); bg.addColorStop(1, '#2844bd');
    c.fillStyle = bg; c.fillRect(0, 0, W, height);
    const glow = c.createRadialGradient(1500, height * 0.44, 30, 1500, height * 0.44, 820);
    glow.addColorStop(0, '#3b71ff8c'); glow.addColorStop(1, '#14326700');
    c.fillStyle = glow; c.fillRect(0, 0, W, height);
    for (let x = 0; x < W; x += 80) line(x, 0, x, height, '#9cbdff10', 1);
    for (let y = 0; y < height; y += 80) line(0, y, W, y, '#9cbdff10', 1);
    c.beginPath(); c.moveTo(1230, -140); c.lineTo(W, -140); c.lineTo(W, height + 140); c.lineTo(910, height + 140);
    c.closePath(); c.fillStyle = '#4d6dff13'; c.fill();

    c.save(); c.translate(0, (height - BASE) / 2);

    // ---------- 品牌行 ----------
    cube(99, 71, 76);
    text('InstaBox', 197, 124, 43, WHITE, 750);
    const pillX = 197 + tw('InstaBox', 43, 750) + 26;
    rr(pillX, 82, tw('免费 4 核 8G 云沙箱', 23, 700) + 44, 48, 24, '#e7ff7220', '#dfff7255');
    text('免费 4 核 8G 云沙箱', pillX + 22, 114, 23, '#deff80', 700);

    // ---------- 主标题 ----------
    rr(100, 252, 86, 8, 4, LIME2);
    text('4 核 8G', 93, 452, 236, LIME);
    text('云服务器', 93, 612, 150, WHITE);
    text('能拿来干嘛？', 93, 766, 150, LIME);
    text('跑 AI · 建站 · 挂机 · 远程桌面', 105, 852, 38, SUB, 600);
    rr(102, 936, 302, 62, 14, '#f1f5ff');
    text('免费额度 · 开箱即用', 124, 978, 29, '#162b56', 800);
    text('instabox.sh', 434, 978, 31, '#b9d0f7', 600, MONO);

    // ---------- 右侧云电脑窗口 ----------
    c.save(); c.translate(1455, 620); c.rotate(-0.045);
    c.shadowColor = '#0005'; c.shadowBlur = 46; c.shadowOffsetY = 25;
    rr(-372, -220, 744, 462, 27, '#f5f8ff', '#b9d1ff');
    c.shadowColor = 'transparent';
    rr(-372, -220, 744, 55, 27, '#dce7fc');
    c.fillStyle = '#dce7fc'; c.fillRect(-372, -192, 744, 27);
    ['#fe8276', '#efc45b', '#66be92'].forEach((color, i) => dot(-339 + i * 24, -192, 6, color));
    text('InstaBox · 云电脑', -229, -183, 20, '#627da7', 650);
    rr(-347, -144, 694, 361, 17, '#0b1a2e');
    text('$ instabox create --template universal', -320, -104, 19, '#7f9dc4', 500, MONO);
    text('✓ machine ready · 28s', -320, -72, 19, '#8ff0c0', 500, MONO);
    line(-320, -56, 300, -56, '#1e3554', 1.5);
    text('4', -320, 62, 104, LIME, 900, 'Arial,sans-serif');
    text('vCPU', -320, 98, 23, '#8fa8cc', 600);
    text('8', -150, 62, 104, WHITE, 900, 'Arial,sans-serif');
    text('GiB 内存', -150, 98, 23, '#8fa8cc', 600);
    text('20', 32, 62, 104, WHITE, 900, 'Arial,sans-serif');
    text('GiB 数据盘', 32, 98, 23, '#8fa8cc', 600);
    rr(-324, 122, 648, 88, 15, '#10263f');
    text('✓ 免费开机，随用随停', -296, 170, 25, '#b7f2d1', 650);
    text('$ no card · 4c8g ready', -296, 199, 18, '#8daccf', 500, MONO);
    // 光标指向结果条
    c.save(); c.translate(250, 118); c.rotate(-0.12); c.scale(0.85, 0.85);
    c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 91); c.lineTo(25, 70); c.lineTo(43, 109);
    c.lineTo(62, 99); c.lineTo(45, 63); c.lineTo(83, 63); c.closePath();
    c.fillStyle = LIME; c.fill(); c.strokeStyle = '#10214d'; c.lineWidth = 5; c.stroke();
    c.restore();
    c.restore();

    // 免费贴纸压在窗口右上
    c.save(); c.translate(1762, 470); c.rotate(-0.14);
    c.shadowColor = '#0a1d3f77'; c.shadowBlur = 22; c.shadowOffsetY = 10;
    rr(-80, -34, 160, 68, 16, LIME, '#0f2a12', 3);
    c.shadowColor = 'transparent';
    tcenter('免费', 0, 14, 41, '#123019', 900);
    c.restore();

    // ---------- 漂浮能力标签 ----------
    chip(1116, 296, 'Python', '#7fe0a0');
    chip(1444, 226, 'Docker', '#8fb4ff');
    chip(1704, 300, 'AI Agent', LIME);
    chip(1082, 902, 'Node.js', '#7fe0a0');
    chip(1394, 976, '远程桌面', '#8fb4ff');
    chip(1710, 896, '挂机', LIME);

    c.restore();
    return canvas;
  }

  const main = () => document.querySelector('#cover');

  window.cover = {
    draw(height = 1200) { build(main(), height, 1); window.COVER_READY = true; return main(); },
    render(height = 1200, scale = 1) { return build(document.createElement('canvas'), height, scale); },
    jpeg(width, height, quality = 0.92) {
      const big = this.render(height, 1);
      const out = document.createElement('canvas');
      out.width = width; out.height = height;
      const g = out.getContext('2d');
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(big, 0, 0, width, height);
      return out.toDataURL('image/jpeg', quality);
    },
  };

  document.fonts.ready.then(() => {
    try { window.cover.draw(); } catch (e) { window.COVER_ERROR = String(e); console.error(e); }
  });
})();