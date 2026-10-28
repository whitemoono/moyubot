/* L3 — eye morph, wink, blink queue, placement. Source en / ks / mn / P2. */
(function (g) {
  const {
    clamp, lerpPoly, centroid, polyPath, Dke, spanAt, spanPoly, Rn,
  } = g.GROK_MATH;

  function queueBlink(q, now) {
    q.push(
      { at: now, v: 0.05 },
      { at: now + 70, v: 0.05 },
      { at: now + 150, v: 1.08 },
      { at: now + 300, v: 1 }
    );
    if (Math.random() < 0.14) {
      q.push({ at: now + 370, v: 0.05 }, { at: now + 480, v: 1 });
    }
  }

  function consumeBlink(q, now) {
    let key = null;
    while (q.length && now >= q[0].at) key = q.shift().v;
    return key;
  }

  function winkLid(base, now, winkAt, winkEye, i) {
    let lid = Math.max(base, 0.04);
    if (i === winkEye && now < winkAt + 320) {
      const xr = (now - winkAt) / 320;
      const Fr = xr < 0.42 ? 1 - xr / 0.42 : (xr - 0.42) / 0.58;
      lid = Math.max(lid * clamp(Fr, 0, 1), 0.04);
    }
    return lid;
  }

  const ICON_CIRCLE = (() => {
    const n = 28;
    let d = "";
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      d += `${i ? "L" : "M"}${Math.cos(a).toFixed(4)} ${Math.sin(a).toFixed(4)}`;
    }
    return d + "Z";
  })();

  function iconPill(ratio) {
    const h = Math.max(ratio - 1, 0).toFixed(4);
    return `M-1 ${-h}A1 1 0 0 1 1 ${-h}L1 ${h}A1 1 0 0 1 -1 ${h}Z`;
  }

  function paintIconFace(opt) {
    const {
      now, shape, blinkX, gazeX, gazeY, winkAt, winkEye, pointer, overlayX, eyeEls, badgeEl, extras,
    } = opt;
    const face = shape.iconFace;
    const boost = clamp(opt.eyeBoostX, 0.82, 1.35);
    const show = overlayX < 0.5;
    for (let i = 0; i < 2; i++) {
      const lid = winkLid(blinkX, now, winkAt, winkEye, i);
      let jx = Math.sin(now * 42e-5 + i) * 0.55;
      let jy = Math.sin(now * 58e-5 + i * 1.3) * 0.35;
      if (pointer && opt.tracking) {
        jx += pointer.x * face.gaze;
        jy += pointer.y * face.gaze;
      }
      jx += (gazeX || 0) * face.gaze + ((extras && extras.Zr) || 0) * 0.25;
      jy += (gazeY || 0) * face.gaze + ((extras && extras.wi) || 0) * 0.25;
      const [ax, ay] = face.anchors[i];
      const el = eyeEls[i];
      el.style.display = show ? "" : "none";
      el.setAttribute("fill", face.ink || "var(--bg, #f3efe6)");
      const rx0 = face.rx || face.radius;
      const ry0 = face.ry || face.radius;
      const sx = rx0 * boost;
      const sy = Math.max(rx0 * boost * lid, 0.35);
      el.setAttribute("d", ry0 > rx0 * 1.15 ? iconPill(ry0 / rx0) : ICON_CIRCLE);
      el.setAttribute(
        "transform",
        `translate(${(ax + jx).toFixed(2)} ${(ay + jy).toFixed(2)}) scale(${sx.toFixed(3)} ${sy.toFixed(3)})`
      );
    }
    if (badgeEl) badgeEl.style.display = "none";
  }

  function paintEyes(opt) {
    if (opt.shape && opt.shape.iconFace && !(opt.manualMix > 0.5)) {
      paintIconFace(opt);
      return;
    }
    const {
      now, polys, morphT, shape, face, faceTune, uniformEyes, eyeScaleProp,
      blinkX, gazeX, gazeY, winkAt, winkEye, turn, cr, pointer, notifyX,
      overlayX, eyeEls, badgeEl, badgeColor, Re, G9e, VJt, extras, ringHint, manualHold,
    } = opt;
    const mix = clamp(opt.manualMix ?? (manualHold ? 1 : 0), 0, 1);
    const pulse = 1 + 0.07 * Math.sin(morphT * Math.PI);
    const $i = {
      x: face.x,
      y: face.y,
      sx: face.sx * (faceTune?.gap ?? 1),
      sy: face.sy * (faceTune?.height ?? 1),
      eye: face.eye * (faceTune?.size ?? 1),
      leftDX: face.leftDX ?? 0,
    };
    const tune = opt.tune || null;
    if (tune) $i.sx *= 1 + (clamp(tune.spacing ?? 35, 0, 150) / 35 - 1) * mix;
    const sX = uniformEyes ? $i.leftDX : 0;
    const cents = [centroid(polys[0]), centroid(polys[1])];
    let a1 = 0, o1 = 0;
    for (const p of polys[0]) a1 = Math.max(a1, Math.abs(p[0] - cents[0][0]));
    for (const p of polys[1]) o1 = Math.max(o1, Math.abs(p[0] - cents[1][0]));
    const l1 = Math.abs(cents[1][0] - (cents[0][0] + sX)) * $i.sx;
    const pre = uniformEyes ? 0 : VJt;
    const _ee = a1 + o1 > 0.5 ? clamp((l1 - pre) / (a1 + o1), 0.35, 4) : 4;
    const Uee = (uniformEyes ? 1 : $i.eye) * clamp(eyeScaleProp, 0.25, 4);
    const oX = Math.min(clamp(opt.eyeBoostX, 0.2, 2) * Uee, _ee / pulse);
    const Hee0 = Math.min(oX * clamp(faceTune?.eyeWidth ?? 1, 0.2, 3), _ee / pulse);
    const u10 = oX * clamp(faceTune?.eyeHeight ?? 1, 0.2, 3);
    const liveSpan = ringHint
      ? (y) => spanPoly(ringHint, y, Re)
      : spanAt(shape.path, Re);
    const top = opt.top ?? shape.top;
    const bottom = opt.bottom ?? shape.bottom;
    const Vn = opt.emphasisBlend || 0;
    const midX = (cents[0][0] + cents[1][0]) / 2;
    const midY = (cents[0][1] + cents[1][1]) / 2;
    const pullX = (Re - midX) * 0.42 * Vn;
    const pullY = (Re - midY) * 0.42 * Vn;
    const gazeW = opt.tracking ? 0.2 : 1;
    const badgeRing = opt.badgeRing || ringHint;
    const Yl = badgeRing
      ? badgeRing[Math.round(badgeRing.length * 7 / 8) % badgeRing.length]
      : [Re, shape.top];

    for (let i = 0; i < 2; i++) {
      eyeEls[i].setAttribute("fill", "var(--bg, #f3efe6)");
      const poly = polys[i];
      const [Gn, Ti] = cents[i];
      eyeEls[i].setAttribute("d", polyPath(poly));
      const lid = winkLid(blinkX, now, winkAt, winkEye, i);
      const sideTune = tune?.[i === 0 ? "left" : "right"];
      const tuneW = sideTune ? 1 + (clamp(sideTune.width ?? 20, 10, 100) / 20 - 1) * mix : 1;
      const tuneH = sideTune ? 1 + (clamp(sideTune.height ?? 50, 10, 100) / 50 - 1) * mix : 1;
      const tuneS = sideTune ? 1 + (clamp(sideTune.size ?? 1, 0.35, 2.2) - 1) * mix : 1;
      const tuneA = sideTune ? (sideTune.angle ?? 0) * Math.PI / 180 * mix : 0;
      const tuneX = sideTune ? (sideTune.x ?? 0) * mix : 0;
      const tuneY = sideTune ? (sideTune.y ?? 0) * mix : 0;
      const Hee = Math.min(Hee0 * tuneW * tuneS, _ee / pulse);
      const u1 = u10 * tuneH * tuneS;
      const Ea = Gn + (i === 0 ? sX : 0);
      let Ca = Re + $i.x;
      let Wo = (Ea - Re) * $i.sx;
      let _c = 1, vre = 1, km = 1, Ree = 0, Fee = 0, zee = 1, bre = true, Tre = 1;
      let Sre = clamp(Re + $i.y + (Ti - Re) * $i.sy, top + 2, bottom - 2);
      const use3d = !!cr;

      if (use3d) {
        const xr = (Ea - Re) / Re;
        const Fr = (Re - Ti) / Re;
        const Ia = Math.sqrt(Math.max(0, 1 - xr * xr - Fr * Fr)) || 0.02;
        const li = cr[0] * xr + cr[1] * Fr + cr[2] * Ia;
        const bl = cr[3] * xr + cr[4] * Fr + cr[5] * Ia;
        const Io = cr[6] * xr + cr[7] * Fr + cr[8] * Ia;
        Wo = li * Re * $i.sx;
        Sre = clamp(Re + $i.y - bl * Re * $i.sy, top + 2, bottom - 2);
        let uo = -Fr * xr, Tl = 1 - Fr * Fr, Zi = -Fr * Ia;
        const Yo = Math.hypot(uo, Tl, Zi);
        if (Yo < 1e-6) {
          uo = 0; Tl = 0; Zi = 1;
        } else {
          uo /= Yo; Tl /= Yo; Zi /= Yo;
        }
        const md = Fr * Zi - Ia * Tl, Oc = Ia * uo - xr * Zi, yu = xr * Tl - Fr * uo;
        const vm = cr[0] * uo + cr[1] * Tl + cr[2] * Zi;
        const Hme = cr[3] * uo + cr[4] * Tl + cr[5] * Zi;
        const Nre = cr[0] * md + cr[1] * Oc + cr[2] * yu;
        const Ere = cr[3] * md + cr[4] * Oc + cr[5] * yu;
        const Cre = md, Ha = -Oc, ci = uo, Ys = -Tl;
        const ku = Cre * Ys - ci * Ha || 1e-6;
        const Ql = Ys / ku, Gee = -ci / ku, bm = -Ha / ku, Ire = Cre / ku;
        km = Nre * Ql + vm * bm;
        Fee = Nre * Gee + vm * Ire;
        Ree = -Ere * Ql + -Hme * bm;
        zee = -Ere * Gee + -Hme * Ire;
        _c = Math.max(Math.hypot(km, Ree), 0.02);
        vre = Math.max(Math.hypot(Fee, zee), 0.02);
        bre = Io > 0.02;
        Tre = Dke(clamp(Io / 0.5, 0, 1));
      }

      if (turn != null) {
        const [spL, spR] = liveSpan(Sre);
        const rad = Math.max((spR - spL) / 2, 12);
        Ca = (spL + spR) / 2;
        const li0 = Math.asin(clamp(Wo / rad, -1, 1));
        const bl0 = li0 + turn;
        const Io0 = Math.cos(bl0);
        const uo0 = Math.max(Math.cos(li0), 0.02);
        bre = Io0 > 0.02;
        _c = Math.max(Io0, 0.02) / uo0;
        Wo = rad * Math.sin(bl0);
        Tre = Dke(clamp(Io0 / 0.5, 0, 1));
      }

      let Kj = (1 - mix) * (Math.sin(now * 42e-5 + i) * 1.4 + Math.sin(now * 0.001 + i * 2) * 0.5);
      let Ko = (1 - mix) * Math.sin(now * 58e-5 + i) * 0.9;
      if (pointer) {
        const Zl = Rn(0.16);
        pointer.x += (pointer.tx - pointer.x) * Zl;
        pointer.y += (pointer.ty - pointer.y) * Zl;
        Kj += pointer.x * (1 - 0.6 * Vn) + pullX;
        Ko += pointer.y * (1 - 0.6 * Vn) + pullY;
      } else {
        Kj += pullX;
        Ko += pullY;
      }
      Kj += gazeX * gazeW + (extras.Zr || 0);
      Ko += gazeY * gazeW + (extras.wi || 0);
      const $ee = clamp(notifyX, 0, 1);
      Kj -= 10 * $ee;
      Ko += 7 * $ee;

      const Vee = clamp(_c * Hee * pulse, 0.02, 2.4);
      const _2 = clamp(vre * lid * u1 * pulse, 0.02, 2.4);
      eyeEls[i].style.display = bre && overlayX < 0.5 ? "" : "none";
      const useTurnOr3d = turn != null || use3d;
      const Ume = G9e * _2 + 2;
      const vl = clamp(
        useTurnOr3d ? Sre + Ko * $i.sy : Re + $i.y + (Ti + Ko - Re) * $i.sy,
        top + Ume,
        bottom - Ume
      );
      let O2 = -Infinity, Xl = Infinity;
      for (let p = 0; p < poly.length; p += 2) {
        const Frp = (poly[p][0] - Gn) * Vee;
        const [Ia2, li2] = liveSpan(vl + (poly[p][1] - Ti) * _2);
        if (Ia2 - Frp > O2) O2 = Ia2 - Frp;
        if (li2 - Frp < Xl) Xl = li2 - Frp;
      }
      const xre = Ca + Wo + Kj * $i.sx + tuneX;
      const lX = O2 <= Xl ? clamp(xre, O2, Xl) : (O2 + Xl) / 2;
      let dd = lX + (xre - lX) * (1 - Tre);
      let Yj = vl + tuneY;
      if (notifyX > 0.01) {
        const xr = 20 * clamp(notifyX, 0, 1.4);
        const Fr = dd - Yl[0], Ia = Yj - Yl[1];
        const li = Math.hypot(Fr, Ia) || 1;
        const bl = Fr / li, Io = Ia / li;
        const uo = (i === 0 ? a1 : o1) * Vee;
        const Tl = Math.hypot(uo * bl, G9e * _2 * Io);
        const Zi = xr + Tl + 5;
        if (li < Zi) {
          dd += bl * (Zi - li);
          Yj += Io * (Zi - li);
        }
      }

      const rot = tuneA
        ? ` rotate(${(tuneA * 180 / Math.PI).toFixed(2)})`
        : "";
      if (use3d) {
        const FrM = clamp((turn != null ? _c : 1) * Hee * pulse, 0.02, 2.4);
        const IaM = clamp(lid * u1 * pulse, 0.02, 2.4);
        const liM = km * FrM, blM = Ree * FrM, IoM = Fee * IaM, uoM = zee * IaM;
        eyeEls[i].setAttribute(
          "transform",
          `translate(${dd.toFixed(2)} ${Yj.toFixed(2)})${rot} matrix(${liM.toFixed(4)} ${blM.toFixed(4)} ${IoM.toFixed(4)} ${uoM.toFixed(4)} 0 0) translate(${(-Gn).toFixed(2)} ${(-Ti).toFixed(2)})`
        );
      } else {
        eyeEls[i].setAttribute(
          "transform",
          `translate(${dd.toFixed(2)} ${Yj.toFixed(2)})${rot} scale(${Vee.toFixed(4)} ${_2.toFixed(4)}) translate(${(-Gn).toFixed(2)} ${(-Ti).toFixed(2)})`
        );
      }
    }

    if (badgeEl) {
      const amt = clamp(notifyX, 0, 1.4);
      if (amt <= 0.01) badgeEl.style.display = "none";
      else {
        badgeEl.style.display = "";
        badgeEl.style.fill = badgeColor || "var(--gb-badge, #1d9bf0)";
        badgeEl.setAttribute("cx", Yl[0].toFixed(1));
        badgeEl.setAttribute("cy", Yl[1].toFixed(1));
        badgeEl.setAttribute("r", (20 * amt).toFixed(2));
      }
    }
  }

  const EYE_HOME = { turn: 17, tilt: -14, roll: 29 };
  const DEFAULT_EYE = { width: 20, height: 50, size: 1, angle: 0, x: 0, y: -7 };
  const DEFAULT_EYES = { left: DEFAULT_EYE, right: DEFAULT_EYE, spacing: 35 };
  const OVERLAY = 300;
  const OVERLAY_HALF = OVERLAY / 2;
  const FACE_R = 120;
  const FOCAL = 620;
  const ARC_N = 14;

  const quatMul = (a, b) => [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
  const quatAxis = (axis, angle) => {
    const h = angle / 2;
    const s = Math.sin(h);
    return [Math.cos(h), axis[0] * s, axis[1] * s, axis[2] * s];
  };
  const quatEuler = (tilt, turn, roll) => {
    const d = Math.PI / 180;
    return quatMul(quatMul(quatAxis([0, 0, 1], roll * d), quatAxis([1, 0, 0], tilt * d)), quatAxis([0, 1, 0], turn * d));
  };
  const quatRotate = (q, p) => {
    const tx = 2 * (q[2] * p[2] - q[3] * p[1]);
    const ty = 2 * (q[3] * p[0] - q[1] * p[2]);
    const tz = 2 * (q[1] * p[1] - q[2] * p[0]);
    return [
      p[0] + q[0] * tx + (q[2] * tz - q[3] * ty),
      p[1] + q[0] * ty + (q[3] * tx - q[1] * tz),
      p[2] + q[0] * tz + (q[1] * ty - q[2] * tx),
    ];
  };
  const screenOf = (pose, home) => {
    const h = quatEuler(home.tilt, home.turn, home.roll);
    const vis = quatMul(quatEuler(pose.tilt, pose.turn, pose.roll), [h[0], -h[1], -h[2], -h[3]]);
    return [vis[0], -vis[1], vis[2], -vis[3]];
  };

  function roundedRect(width, height) {
    const hw = width / 2;
    const hh = height / 2;
    const r = Math.min(hw, hh);
    const pts = [];
    const line = (a, b) => {
      const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 1.5));
      for (let i = 0; i < n; i++) {
        const t = i / n;
        pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    };
    const arc = (cx, cy, start) => {
      for (let i = 0; i < ARC_N; i++) {
        const a = start + (i / ARC_N) * Math.PI / 2;
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
    };
    line([-hw + r, -hh], [hw - r, -hh]);
    arc(hw - r, -hh + r, -Math.PI / 2);
    line([hw, -hh + r], [hw, hh - r]);
    arc(hw - r, hh - r, 0);
    line([hw - r, hh], [-hw + r, hh]);
    arc(-hw + r, hh - r, Math.PI / 2);
    line([-hw, hh - r], [-hw, -hh + r]);
    arc(-hw + r, -hh + r, Math.PI);
    return pts;
  }

  function projectEye(pose, home, faceX, faceY, lx, ly, angle, rim) {
    const a = (angle || 0) * Math.PI / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const x = faceX + lx * c - ly * s;
    const y = faceY + lx * s + ly * c;
    // Face coords are authored against FACE_R=120 (original lab units) but the
    // physical head rides `rim` overlay units so the eye sphere's silhouette
    // lands on the visible head edge. Past the rim points stay raw on the z=0
    // plane (ellipsoidFrontSample semantics): the eye rides over the edge and
    // gets sliced by the head clip instead of folding back inward.
    const headR = rim || 95;
    const dx = x / FACE_R;
    const dy = y / FACE_R;
    const dz = Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
    const rotated = quatRotate(screenOf(pose, home), [dx, dy, dz]);
    const depth = rotated[2] * headR;
    const sc = FOCAL / Math.max(FOCAL - depth, 0.0001);
    return [rotated[0] * headR * sc, rotated[1] * headR * sc, rotated[2]];
  }

  function overlayToSvg(svg, x, y) {
    const box = svg.viewBox?.baseVal;
    const w = box?.width || OVERLAY;
    const h = box?.height || OVERLAY;
    const ox = box?.x || 0;
    const oy = box?.y || 0;
    return [ox + ((x + OVERLAY_HALF) / OVERLAY) * w, oy + ((y + OVERLAY_HALF) / OVERLAY) * h];
  }

  function resampleRing(pts, n) {
    if (!pts?.length) return Array.from({ length: n }, () => [0, 0]);
    const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
    let total = 0;
    const segs = pts.map((p, i) => {
      const d = dist(p, pts[(i + 1) % pts.length]) || 1e-6;
      total += d;
      return d;
    });
    const out = [];
    let i = 0;
    let acc = 0;
    for (let k = 0; k < n; k++) {
      const target = (k / n) * total;
      while (acc + segs[i % segs.length] < target && i < pts.length * 2) {
        acc += segs[i % segs.length];
        i++;
      }
      const a = pts[i % pts.length];
      const b = pts[(i + 1) % pts.length];
      const sl = segs[i % segs.length];
      const t = clamp((target - acc) / sl, 0, 1);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    return out;
  }

  function sampleEl(el, n) {
    if (!el || typeof el.getTotalLength !== "function") return null;
    let len = 0;
    try {
      len = el.getTotalLength();
    } catch {
      return null;
    }
    const m = el.transform.baseVal.consolidate()?.matrix;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const p = el.getPointAtLength(len > 0 ? (i / n) * len : 0);
      pts.push(m ? [m.a * p.x + m.c * p.y + m.e, m.b * p.x + m.d * p.y + m.f] : [p.x, p.y]);
    }
    return pts;
  }

  function customEyePolys({ pose, eyes, svg, n = 48, home = EYE_HOME, rim }) {
    if (!svg || !pose) return null;
    const src = eyes || DEFAULT_EYES;
    const sides = ["left", "right"];
    return sides.map((side) => {
      const tune = { ...DEFAULT_EYE, ...(src[side] || {}) };
      const faceX = (side === "left" ? -1 : 1) * clamp(src.spacing ?? 35, 0, 150) / 2 + tune.x;
      const faceY = tune.y;
      const local = roundedRect(Math.max(tune.width, 1), Math.max(tune.height, 1));
      let z = 0;
      const projected = local.map(([lx, ly]) => {
        const p = projectEye(pose, home, faceX, faceY, lx, ly, tune.angle, rim);
        z += p[2];
        return overlayToSvg(svg, p[0], p[1]);
      });
      return { pts: resampleRing(projected, n), visible: z > 0, zAvg: z / Math.max(local.length, 1) };
    });
  }

  // Visibility hysteresis: drag jitter around the silhouette boundary would
  // otherwise pop the eye in and out every few frames.
  const VIS_HIDE = -0.006;
  const VIS_SHOW = 0.004;

  function blendCustomEyes({ eyeEls, pose, eyes, svg, mix, n = 48, rim }) {
    const k = clamp(mix, 0, 1);
    if (k <= 0.002 || !eyeEls) return;
    const custom = customEyePolys({ pose, eyes, svg, n, rim });
    if (!custom) return;
    const gate = 0.22;
    const shapeK = k >= gate ? 1 : Dke(k / gate);
    for (let i = 0; i < 2; i++) {
      const el = eyeEls[i];
      const expr = sampleEl(el, n);
      if (!el || !expr || !custom[i]) continue;
      let shown = el.__eyeShown != null ? el.__eyeShown : custom[i].visible;
      if (shown && custom[i].zAvg < VIS_HIDE) shown = false;
      if (!shown && custom[i].zAvg > VIS_SHOW) shown = true;
      el.__eyeShown = shown;
      el.setAttribute("d", polyPath(lerpPoly(custom[i].pts, expr, 1 - shapeK)));
      el.removeAttribute("transform");
      if (shapeK > 0.55) el.style.display = shown ? "" : "none";
    }
  }

  g.GROK_EYES = { queueBlink, consumeBlink, paintEyes, lerpPoly, sampleEl, customEyePolys, blendCustomEyes };
})(window);
