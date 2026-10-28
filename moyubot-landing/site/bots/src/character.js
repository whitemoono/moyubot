/* L2 — GrokCharacter. Orchestrates pose, eyes, tricks, overlays. Source $_t + sd(). */
(function (g) {
  const M = g.GROK_MATH;
  const T = g.GROK_TABLES;
  const { applyPose, nextGaze } = g.GROK_POSE;
  const TR = g.GROK_TRICKS;
  const EY = g.GROK_EYES;
  const FX = g.GROK_FX;
  const {
    spring, stepSpring, springSteps, clamp, rand, sign, K2, Dke, lerpPoly, lerpFace, relRot, mapPointer, Rn,
  } = M;
  const {
    GROUPS, EYE_PLAYLIST, EYE_HOLD_MS, BLINK_MS,
    ONBOARDING, ONBOARDING_MS, onboardMood,
    SPRINGS, FACE_TUNE, POSE, POSE_HOME, UNIFORM_EYES,
    V_T, B_T, WINK_STATES, poseScale, shapeEyeScale, overlayViewZoom,
    VIEW, VIEW_HALF, VIEW_MID, inkFg, inkCss, EYE_BG,
  } = T;

  const snapSpring = (s, v) => {
    s.x = s.t = v;
    s.v = 0;
  };
  const springBusy = (s) => Math.abs(s.x - s.t) > 0.002 || Math.abs(s.v) > 0.04;

  const HOLD_GAZE = {
    curious: { x: 12, y: -6 }, sad: { x: 2, y: 8 }, shy: { x: 10, y: 7 },
    proud: { x: 0, y: -6 }, bored: { x: 12, y: 6 }, suspicious: { x: -15, y: 3 },
    confused: { x: 12, y: 3 }, thinking: { x: 12, y: -7 }, angry: { x: 0, y: 2 },
    drowsy: { x: 4, y: 7 }, searching: { x: 14, y: -4 }, working: { x: 3, y: 7 },
    notifying: { x: 7, y: -3 }, playful: { x: 10, y: -4 }, happy: { x: -6, y: -4 },
    laughing: { x: 4, y: -4 }, listening: { x: 5, y: -2 }, scared: { x: 12, y: 2 },
  };
  // Still-frame eyes. Shy playlist starts at idle 0; 24 is the look-down face.
  const HOLD_EYE = { shy: 24 };

  class GrokCharacter {
    constructor(svg, opts = {}) {
      this.svg = svg;
      this.shapeName = opts.shape || "zeta";
      this.colorId = opts.color || "black";
      this.scheme = opts.scheme || "light";
      this.mode = opts.mode || "hold";
      this.state = opts.state || "idle";
      this.onChange = opts.onChange || (() => {});
      this.frameHalf = opts.frameHalf || VIEW_HALF;
      this.fitBox = !!opts.fitBox;
      this.loginWrap = opts.loginWrap !== false;
      this.eyeTopology = opts.eyeTopology ?? this.loginWrap;
      this.faceTune = opts.faceTune ?? (this.loginWrap ? FACE_TUNE : null);
      this.pose = { ...(this.loginWrap ? POSE : { turn: 0, tilt: 0, roll: 0, scale: 1 }), ...opts.pose };
      this.poseRest = { turn: this.pose.turn, tilt: this.pose.tilt, roll: this.pose.roll };
      this.poseHome = opts.poseHome || (this.loginWrap ? POSE_HOME : { turn: 0, tilt: 0, roll: 0 });
      this.manualHold = false;
      this.manualMix = spring(0);
      this.manualTx = 0;
      this.manualTy = 0;
      this.manualSpin = 0;
      this.eyeTune = null;
      this.uniformEyes = opts.uniformEyes ?? (this.loginWrap ? UNIFORM_EYES : false);
      this.eyeScaleProp = opts.eyeScale ?? (this.loginWrap ? shapeEyeScale(this.shapeName) : 1);
      this.emphasis = !!opts.emphasis;
      this.followPointer = !!opts.followPointer;
      this.gazeTarget = opts.gazeTarget || null;
      this.frozen = opts.paused === "hold-pose";
      this.holdAt = 900;
      this.clockHold = 0;
      this.frozenAt = 0;
      this.driven = !!opts.driven;
      this.paused = !!opts.paused;
      this.reduceMotion = opts.reduceMotion ?? (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
      // autoTricks gates the AUTOMATIC spin sources (wantPn, celebrate re-arm,
      // idle trick loop, shape-change trick). State-inherent rotation
      // (humming/loading ovSpin) and explicit spinOnce stay untouched.
      this.autoTricks = opts.autoTricks !== false;
      this.badgeColor = opts.badgeColor || "var(--gb-badge, #1d9bf0)";
      this.sizePx = opts.sizePx || null;
      this.eyeColor = opts.eyeColor || null;
      this.inkFlat = opts.inkFlat || null;
      this.inkGrad = opts.inkGrad || null;
      this.geo = opts.geo || g.GROK_GEO;
      if (!this.geo.shapes?.[this.shapeName]) {
        const keys = Object.keys(this.geo.shapes || {});
        this.shapeName = this.geo.shapes?.zeta ? "zeta" : (keys[0] || "zeta");
      }
      this.playlists = opts.playlist || EYE_PLAYLIST;

      this.spin = spring(0);
      this.tx = spring(0);
      this.ty = spring(0);
      this.squash = spring(1);
      this.blink = spring(1);
      this.eyeScale = spring(1);
      this.gazeX = spring(0);
      this.gazeY = spring(0);
      this.eyeMorph = spring(1);
      this.overlay = spring(0);
      this.overlayMix = spring(1);
      this.notify = spring(0);
      this.humDots = spring(0);
      this.shapeSpring = spring(1);
      this.overlayTurn = spring(0);
      this.emphasisBlend = 0;

      this.eyeFrom = 0;
      this.eyeTo = 0;
      this.eyeStiffness = 7;
      this.eyeIdx = 0;
      this.eyeHoldMs = 0;
      this.eyeRemain = 0;
      this.playlistHold = false;
      this.eyePinned = false;
      this._fromPolys = null;

      this.t0 = performance.now();
      this.stateAt = this.t0;
      this.last = this.t0;
      this.moodN = 0;
      this.eyeUntil = this.t0 + rand(...EYE_HOLD_MS.idle);
      this.blinkUntil = this.t0 + rand(1500, 7000);
      this.gazeUntil = this.t0 + 800;
      this.blinkQueue = [];
      this.winkAt = -1e9;
      this.winkEye = 0;
      this.winkUntil = this.t0 + rand(3000, 8000);
      this.spinTurn = null;
      this.trick = null;
      this.hopAt = -1;
      this.trickAt = this.t0 + rand(2500, 5000);
      this.trickCycle = Math.floor(rand(0, 5));
      this.wildWide = false;
      this.ovSpin = 0;
      this.ovTurnAcc = 0;
      this.ovOn = false;
      this.ovTurnDir = 1;
      this.pointer = { x: 0, y: 0, tx: 0, ty: 0 };
      this.pointerRaw = null;
      this.rectCache = null;
      this.rectAt = -1e9;
      this.prevShape = this.shapeName;
      this.prevFace = null;
      this.prevRing = null;
      this.prevTilt = null;
      this.prevBelt = null;
      this.ctx = this._freshCtx(this.t0);
      this.ovKind = null;
      this.ovPrev = null;
      this.ovTarget = null;
      this.ovRest = false;
      this.ovRestAt = 0;
      this.pxW = opts.sizePx || 190;
      this.pxAt = 0;
      this.partScale = 1;
      this.celebrateAt = -1;
      this.gazeSpin = 0;
      this.extras = { turn: null, Kr: 0, yi: 0, ki: 0, Yr: 0, Zr: 0, wi: 0, hop: 0 };
      this.poseOut = { spin: 0, tx: 0, ty: 0, squash: 1, lid: 1, eyeBoost: 1 };

      this._build();
      this.setColor(this.colorId, this.scheme);
      this._applyPoseScale();
      this.setState(this.state, { resetEyes: true });
      this.eyePinned = Number.isFinite(opts.eyeIndex) && !!(this.geo.eyes && this.geo.eyes[opts.eyeIndex]);
      if (this.eyePinned) {
        const id = opts.eyeIndex;
        this.eyeFrom = id;
        this.eyeTo = id;
        this.eyeMorph.x = 1;
        this.eyeMorph.t = 1;
        this.eyeMorph.v = 0;
        this._fromPolys = null;
        const list = this.playlists[this.state] || [];
        const slot = list.indexOf(id);
        this.eyeIdx = slot >= 0 ? slot : 0;
      }
      if (!this.driven) this._bindPointer();
      if (this.frozen) {
        this.holdFrame();
      } else if (this.driven) {
        this._paint(this.t0);
      } else {
        this._paint(this.t0);
        this._armTick();
      }
    }

    destroy() {
      cancelAnimationFrame(this._raf);
      this._unbindPointer();
      this.particles?.clear();
    }

    _freshCtx(now) {
      return {
        nodUntil: now + rand(1200, 2200),
        nodEnd: 0,
        angryShakeUntil: 0,
        impulseAt: now + rand(500, 1200),
        tyKick: 0,
        spinKick: 0,
        forceSleepEye: false,
        wakeEye: null,
        wakeBlink: false,
        wakingBlinked: false,
        slumpAt: 0,
        stAt: now + rand(6000, 10000),
        wantPn: null,
        wantBlink: false,
        dragCycle: -1,
        notifyPop: false,
        wantBurst: null,
        wakingBurst: false,
      };
    }

    setMode(mode) {
      this.mode = mode;
      if (mode === "onboarding") {
        this.moodN = 0;
        this.stateAt = performance.now();
        this.setState("idle", { resetEyes: true });
      }
    }

    setPaused(v) {
      if (v === "hold-pose") {
        this.holdFrame();
        return;
      }
      if (!v && this.frozen && this.frozenAt) {
        this.clockHold += performance.now() - this.frozenAt;
      }
      this.frozenAt = 0;
      this.frozen = false;
      this.paused = !!v;
      this._armTick();
    }

    _armTick() {
      if (this.frozen || this.driven || this._raf) return;
      this.last = this._clock();
      this._raf = requestAnimationFrame((t) => this._tick(t - this.clockHold));
    }

    _wake() {
      if (this.driven) return;
      if (this.frozen) {
        this._paint(this.last || this.t0);
        return;
      }
      this._armTick();
    }

    step(dt) {
      this._tick(this.last + Math.max(0, dt) * 1000);
    }

    setEmphasis(v) {
      this.emphasis = !!v;
    }

    setFollowPointer(v) {
      this.followPointer = !!v;
      if (!v) {
        this.pointerRaw = null;
        this.gazeTarget = null;
      }
    }

    setPose(next) {
      if (!next) return;
      if (next.turn != null) this.pose.turn = next.turn;
      if (next.tilt != null) this.pose.tilt = next.tilt;
      if (next.roll != null) this.pose.roll = next.roll;
      this._wake();
    }

    setManualOffset(next) {
      if (!next) return;
      if (next.tx != null) this.manualTx = next.tx;
      if (next.ty != null) this.manualTy = next.ty;
      if (next.spin != null) this.manualSpin = next.spin;
      this._wake();
    }

    setEyeTune(tune) {
      this.eyeTune = tune || null;
      this._wake();
    }

    _clearFx() {
      this.trick = null;
      this.spinTurn = null;
      this.gazeOrbit = null;
      this.gazeSpin = 0;
      this.hopAt = -1;
      this.wildWide = false;
      this.ovKind = null;
      this.ovPrev = null;
      this.ovTarget = null;
      this.ovOn = false;
      this.ovRest = false;
      this.ovSpin = 0;
      snapSpring(this.overlay, 0);
      snapSpring(this.overlayMix, 1);
      snapSpring(this.notify, 0);
      snapSpring(this.humDots, 0);
      this.particles?.clear();
      this.fx?.resetInk();
      this.fx?.resetRecv();
      this.fx?.hideAll();
      if (this.group) this.group.style.opacity = "1";
    }

    _snapBodyRest() {
      snapSpring(this.spin, 0);
      snapSpring(this.tx, 0);
      snapSpring(this.ty, 0);
      snapSpring(this.squash, 1);
      snapSpring(this.eyeScale, 1);
      this.extras = { ...this.extras, turn: null, Kr: 0, yi: 0, ki: 0, Yr: 0, Zr: 0, wi: 0, hop: 0 };
    }

    flushPerformance() {
      this._clearFx();
      this._snapBodyRest();
      this._wake();
    }

    _mix() {
      return clamp(this.manualMix.x, 0, 1);
    }

    _angLerp(from, to, t) {
      let d = to - from;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      return from + d * t;
    }

    _poseNow() {
      const k = this._mix();
      return {
        turn: this._angLerp(this.poseRest.turn, this.pose.turn, k),
        tilt: this._angLerp(this.poseRest.tilt, this.pose.tilt, k),
        roll: this._angLerp(this.poseRest.roll, this.pose.roll, k),
        scale: this.pose.scale,
      };
    }

    setManualHold(on) {
      const next = !!on;
      const changed = next !== this.manualHold;
      this.manualHold = next;
      if (next) {
        this.manualMix.t = 1;
        this.trickAt = Infinity;
        this.gazeUntil = Infinity;
        this.gazeX.t = 0;
        this.gazeY.t = 0;
        this.pointer.tx = 0;
        this.pointer.ty = 0;
        this.ctx.wantPn = null;
        this.ctx.wantBurst = null;
        this.ctx.tyKick = 0;
        this.ctx.spinKick = 0;
        this.ctx.forceSleepEye = false;
        this.ctx.wakeEye = null;
        this.setFollowPointer(false);
        this.trick = null;
        this.spinTurn = null;
        this.hopAt = -1;
        this.wildWide = false;
        this.ovKind = null;
        this.ovPrev = null;
        this.ovTarget = null;
        this.ovOn = false;
        this.overlay.t = 0;
        this.notify.t = 0;
        this.humDots.t = 0;
        this.particles?.clear();
        this.fx?.hideAll();
      } else {
        this.manualMix.t = 0;
        if (changed) {
          this.ctx = this._freshCtx(this._clock());
          this.gazeUntil = this._clock();
          this.blinkUntil = this._clock() + rand(1500, 7000);
          this.trickAt = this._clock() + rand(4000, 8000);
        }
      }
      this._wake();
    }

    parts() {
      return { svg: this.svg, body: this.body, eyes: this.eyeEls, group: this.group };
    }

    setGazeTarget(pt) {
      this.gazeTarget = pt;
    }

    setShape(name) {
      if (!this.geo.shapes[name] || name === this.shapeName) return;
      const R = this.geo.Re;
      const k = K2(clamp(this.shapeSpring.x, 0, 1));
      const rest = FX.shapeMetrics(this.geo.shapes[this.shapeName], R);
      if (k >= 1 || !this.prevFace || !this.prevRing) {
        this.prevFace = rest.face;
        this.prevRing = rest.ring;
        this.prevTilt = rest.tilt;
        this.prevBelt = rest.belt;
      } else {
        this.prevFace = lerpFace(this.prevFace, rest.face, k);
        this.prevRing = FX.lerpRing(this.prevRing, rest.ring, k);
        this.prevTilt += (rest.tilt - this.prevTilt) * k;
        this.prevBelt += (rest.belt - this.prevBelt) * k;
      }
      this.prevShape = this.shapeName;
      this.shapeName = name;
      this.shapeSpring.x = 0;
      this.shapeSpring.v = 0;
      this.shapeSpring.t = 1;
      if (this.loginWrap) this.eyeScaleProp = shapeEyeScale(name);
      this._applyPoseScale();
      this._cycleShapeTrick();
      this._wake();
    }

    setColor(id, scheme) {
      this.colorId = id;
      if (scheme) this.scheme = scheme;
      if (this.inkGrad) {
        this._paintInkGrad();
      } else {
        if (this.inkFlat) {
          this.svg.style.setProperty("--fg", this.inkFlat);
        } else if (this.loginWrap) {
          this.svg.style.setProperty("--fg", inkFg(id));
        } else {
          const pal = this.geo.palette[id] || this.geo.palette.black;
          this.svg.style.setProperty("--fg", this.scheme === "dark" ? pal.dark : pal.light);
        }
        this.svg.style.setProperty("--ink", inkCss(id));
        this.body.setAttribute("fill", "var(--fg, #000)");
      }
      this.svg.style.setProperty("--bg", this.eyeColor || EYE_BG);
    }

    _paintInkGrad() {
      const spec = this.inkGrad;
      const vb = this.geo.viewBox;
      const cx = vb.minX + vb.width / 2;
      const cy = vb.minY + vb.height / 2;
      if (spec.radial) {
        const r = (Math.hypot(vb.width, vb.height) / 2) * 0.72;
        this.inkRadialEl.setAttribute("cx", cx);
        this.inkRadialEl.setAttribute("cy", vb.minY + vb.height * 0.42);
        this.inkRadialEl.setAttribute("r", r);
        this.inkRadialStops[0].setAttribute("stop-color", spec.from);
        this.inkRadialStops[1].setAttribute("stop-color", spec.to);
        this.body.setAttribute("fill", `url(#${this.inkRadialId})`);
        this.svg.style.setProperty("--fg", spec.from);
        this.svg.style.setProperty("--ink", `radial-gradient(circle at 50% 42%, ${spec.from}, ${spec.to})`);
        return;
      }
      const deg = ((Number(spec.angle) || 0) % 360 + 360) % 360;
      const rad = (deg * Math.PI) / 180;
      const span = Math.hypot(vb.width, vb.height) / 2;
      const dx = Math.sin(rad) * span;
      const dy = -Math.cos(rad) * span;
      this.inkGradEl.setAttribute("x1", cx - dx);
      this.inkGradEl.setAttribute("y1", cy - dy);
      this.inkGradEl.setAttribute("x2", cx + dx);
      this.inkGradEl.setAttribute("y2", cy + dy);
      this.inkStops[0].setAttribute("stop-color", spec.from);
      this.inkStops[1].setAttribute("stop-color", spec.to);
      this.body.setAttribute("fill", `url(#${this.inkGradId})`);
      this.svg.style.setProperty("--fg", spec.from);
      this.svg.style.setProperty("--ink", `linear-gradient(${deg}deg, ${spec.from}, ${spec.to})`);
    }

    setInk(flat) {
      this.inkFlat = flat || null;
      if (this.inkFlat) this.inkGrad = null;
      this.setColor(this.colorId);
    }

    setInkGrad(grad) {
      this.inkGrad = grad ? { ...grad } : null;
      if (this.inkGrad) this.inkFlat = null;
      this.setColor(this.colorId);
    }

    setEyeColor(color) {
      this.eyeColor = color || null;
      this.svg.style.setProperty("--bg", this.eyeColor || EYE_BG);
    }

    _clock() {
      if (this.driven) return this.last;
      return performance.now() - this.clockHold;
    }

    // settle snaps t = x (stop); pause keeps the current targets.
    freezeNow({ settle = false } = {}) {
      const already = this.frozen;
      this.frozen = true;
      this.paused = true;
      if (!already) this.frozenAt = performance.now();
      this.last = this._clock();
      if (this._raf) {
        cancelAnimationFrame(this._raf);
        this._raf = 0;
      }
      for (const s of [
        this.spin,
        this.tx,
        this.ty,
        this.squash,
        this.blink,
        this.eyeScale,
        this.gazeX,
        this.gazeY,
        this.eyeMorph,
        this.overlay,
        this.overlayMix,
        this.notify,
        this.humDots,
        this.shapeSpring,
        this.overlayTurn,
        this.manualMix,
      ]) {
        if (settle) s.t = s.x;
        s.v = 0;
      }
      this.ctx.wantPn = null;
      this.ctx.wantBurst = null;
      this.ctx.tyKick = 0;
      this.ctx.spinKick = 0;
      this._paint(this.last);
      return this.snapshot();
    }

    setState(name, { resetEyes = false } = {}) {
      if (!this.playlists[name]) return;
      this.state = name;
      this.stateAt = this._clock();
      if (this.driven) {
        this.trick = null;
        this.spinTurn = null;
        this.hopAt = -1;
        this.wildWide = false;
      }
      const list = this.playlists[name];
      this.eyeIdx = 0;
      if (resetEyes) {
        this.eyeFrom = list[0];
        this.eyeTo = list[0];
        this._fromPolys = null;
        this.eyeMorph.x = 1;
        this.eyeMorph.t = 1;
        this.eyeMorph.v = 0;
      } else if (name !== "sleeping" && name !== "waking") {
        this._morphEyes(list[0], name === "excited" ? 10 : 8);
      }
      const hold = rand(...EYE_HOLD_MS[name]);
      this.eyeHoldMs = hold;
      this.eyeRemain = hold;
      this.eyeUntil = this.stateAt + hold;
      this.playlistHold = false;
      const blink = BLINK_MS[name];
      this.blinkUntil = blink ? this.stateAt + rand(1500, 7000) : Infinity;
      this.gazeUntil = this.stateAt + rand(500, 1400);
      this.winkUntil = this.stateAt + rand(3000, 8000);
      this.ctx = this._freshCtx(this.stateAt);
      this.ctx.stAt = this.stateAt + (
        name === "excited" ? rand(400, 1100)
        : name === "searching" ? rand(800, 1600)
        : name === "working" ? rand(1200, 2400)
        : rand(6000, 10000)
      );
      this.celebrateAt = name === "celebrate" ? this.stateAt + 140 : -1;
      this.fx?.resetInk();
      this.fx?.resetRecv();
      if (name !== "waking" && name !== "sleeping" && name !== "drowsy") {
        EY.queueBlink(this.blinkQueue, this.stateAt);
      }
      this._wake();
      try {
        this.onChange(this.snapshot());
      } catch (_) { /* host UI may not be ready */ }
    }

    snapshot() {
      return {
        state: this.state,
        mode: this.mode,
        shape: this.shapeName,
        color: this.colorId,
        scheme: this.scheme,
        eyeFrom: this.eyeFrom,
        eyeTo: this.eyeTo,
        spin: this.spin.x,
        tx: this.tx.x,
        ty: this.ty.x,
        squash: this.squash.x,
        blink: this.blink.x,
        overlay: this.ovKind,
        overlayX: this.overlay.x,
        notify: this.notify.x,
        trick: this.trick?.kind || (this.spinTurn ? "pn" : null),
        shapeSpring: this.shapeSpring.x,
        badge: this.badge && this.badge.style.display !== "none"
          ? { x: +this.badge.getAttribute("cx"), y: +this.badge.getAttribute("cy") }
          : null,
      };
    }

    seekEye(index, { snap = false } = {}) {
      const list = this.playlists[this.state];
      if (!list?.length) return;
      const i = ((index % list.length) + list.length) % list.length;
      this.eyeIdx = i;
      if (snap) {
        this.eyeFrom = list[i];
        this.eyeTo = list[i];
        this.eyeMorph.x = 1;
        this.eyeMorph.t = 1;
        this.eyeMorph.v = 0;
        this._fromPolys = null;
      } else {
        this._morphEyes(list[i], this.state === "searching" || this.state === "excited" ? 10 : 6);
      }
      const hold = rand(...(EYE_HOLD_MS[this.state] || [2000, 3600]));
      this.eyeHoldMs = hold;
      this.eyeRemain = hold;
      this.eyeUntil = this._clock() + hold;
      this._wake();
    }

    setPlaylistHold(on) {
      const next = !!on;
      if (next === this.playlistHold) return;
      if (next) this.eyeRemain = Math.max(0, this.eyeUntil - this._clock());
      else {
        this.eyeUntil = this._clock() + (this.eyeRemain || 0);
        this._wake();
      }
      this.playlistHold = next;
    }

    setAutoTricks(on) {
      this.autoTricks = !!on;
    }

    playback() {
      const remain = this.playlistHold
        ? (this.eyeRemain || 0)
        : Math.max(0, this.eyeUntil - this._clock());
      return {
        state: this.state,
        eyeIdx: this.eyeIdx || 0,
        holdMs: this.eyeHoldMs || 0,
        remainMs: remain,
        held: !!this.playlistHold,
        frozen: !!this.frozen,
        manualMix: this._mix(),
      };
    }

    spinOnce(turns = 1) {
      if (this.manualHold) return;
      this._wake();
      this._pn(turns);
    }
    bounceOnce() {
      if (this.manualHold) return;
      this._wake();
      this._hop(performance.now());
    }
    burstOnce() {
      if (!this.manualHold && !this.reduceMotion && !this.paused) this.particles.burst(22, 1.1, 0.3);
    }

    orbitGaze(ms = 1500) {
      if (this.reduceMotion || this.frozen || this.manualHold) return;
      this.gazeOrbit = { at: performance.now(), dur: Math.max(ms, 1), from: Math.PI * 2 };
      this._armTick();
    }

    holdFrame(at = 900) {
      this.frozen = true;
      this.paused = true;
      this.holdAt = at;
      if (this._raf) {
        cancelAnimationFrame(this._raf);
        this._raf = 0;
      }
      const now = this.t0 + at;
      const mt = at / 1000;
      const pose = applyPose(this.state, mt, mt, now, this.ctx, {
        eyeTo: this.eyeTo,
        eyeMorphX: 1,
        blinkX: this.blink.x,
        playlist: this.playlists,
        prev: this.poseOut,
      });
      this.ctx.wantPn = null;
      this.ctx.wantBurst = null;
      this.ctx.tyKick = 0;
      this.ctx.spinKick = 0;
      this.poseOut = pose;
      snapSpring(this.spin, pose.spin);
      snapSpring(this.tx, pose.tx);
      snapSpring(this.ty, pose.ty);
      snapSpring(this.squash, pose.squash);
      snapSpring(this.eyeScale, pose.eyeBoost);
      snapSpring(this.blink, pose.lid);
      this._stepOverlay(now);
      if (this.ovKind) {
        snapSpring(this.overlay, this.overlay.t);
        snapSpring(this.overlayMix, 1);
        snapSpring(this.overlayTurn, this.overlayTurn.t);
        this.fx.overlayAt = this.t0;
      }
      snapSpring(this.notify, this.state === "notifying" ? 1 : 0);
      snapSpring(this.humDots, this.state === "humming" ? 1 : 0);
      if (this.state === "humming" || this.state === "loading") this.ovSpin = 2.1;
      const gz = HOLD_GAZE[this.state] || { x: 0, y: 0 };
      snapSpring(this.gazeX, gz.x);
      snapSpring(this.gazeY, gz.y);
      const holdEye = this.eyePinned ? null : HOLD_EYE[this.state];
      if (holdEye != null && this.geo.eyes[holdEye]) {
        this.eyeFrom = holdEye;
        this.eyeTo = holdEye;
      }
      this.eyeMorph.x = 1;
      this.eyeMorph.v = 0;
      this.eyeMorph.t = 1;
      this._fromPolys = null;
      this._paint(now);
      return this.snapshot();
    }

    setSize(px) {
      this.sizePx = px > 0 ? px : null;
      this._applyPoseScale();
    }

    _applyPoseScale() {
      const sc = this.loginWrap ? poseScale(this.shapeName) : (this.pose.scale || 1);
      this.pose.scale = sc;
      if (this.sizePx) {
        this.svg.style.width = `${this.sizePx}px`;
        this.svg.style.height = `${this.sizePx}px`;
      }
      const boxed = this.fitBox || (this.sizePx && this.sizePx < 120);
      if (!boxed && Math.abs(sc - 1) > 0.001) {
        this.svg.style.transform = `scale(${sc})`;
        this.svg.style.transformOrigin = "50% 50%";
      } else {
        this.svg.style.transform = "";
      }
    }

    _bindPointer() {
      this._onMove = (e) => {
        if (!this.followPointer) return;
        this.pointerRaw = { x: e.clientX, y: e.clientY };
      };
      this._onLeave = () => {
        if (this.followPointer) this.pointerRaw = null;
      };
      window.addEventListener("pointermove", this._onMove, { passive: true });
      document.documentElement.addEventListener("pointerleave", this._onLeave);
    }

    _unbindPointer() {
      window.removeEventListener("pointermove", this._onMove);
      document.documentElement.removeEventListener("pointerleave", this._onLeave);
    }

    _build() {
      const geo = this.geo;
      const vb = geo.viewBox;
      this.svg.setAttribute("viewBox", `${vb.minX} ${vb.minY} ${vb.width} ${vb.height}`);
      this.svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      this.svg.style.overflow = "visible";
      this.svg.innerHTML = "";
      const ns = "http://www.w3.org/2000/svg";
      const defs = document.createElementNS(ns, "defs");
      const clip = document.createElementNS(ns, "clipPath");
      const clipId = `grok-clip-${Math.random().toString(36).slice(2, 8)}`;
      clip.setAttribute("id", clipId);
      this.clipPath = document.createElementNS(ns, "path");
      clip.appendChild(this.clipPath);
      defs.appendChild(clip);
      this.inkGradId = `grok-ink-${Math.random().toString(36).slice(2, 8)}`;
      this.inkGradEl = document.createElementNS(ns, "linearGradient");
      this.inkGradEl.setAttribute("id", this.inkGradId);
      this.inkGradEl.setAttribute("gradientUnits", "userSpaceOnUse");
      this.inkStops = [0, 1].map((offset) => {
        const s = document.createElementNS(ns, "stop");
        s.setAttribute("offset", String(offset));
        this.inkGradEl.appendChild(s);
        return s;
      });
      defs.appendChild(this.inkGradEl);
      this.inkRadialId = `grok-ink-r-${Math.random().toString(36).slice(2, 8)}`;
      this.inkRadialEl = document.createElementNS(ns, "radialGradient");
      this.inkRadialEl.setAttribute("id", this.inkRadialId);
      this.inkRadialEl.setAttribute("gradientUnits", "userSpaceOnUse");
      this.inkRadialStops = [0, 1].map((offset) => {
        const s = document.createElementNS(ns, "stop");
        s.setAttribute("offset", String(offset));
        this.inkRadialEl.appendChild(s);
        return s;
      });
      defs.appendChild(this.inkRadialEl);
      this.svg.appendChild(defs);

      this.group = document.createElementNS(ns, "g");
      this.body = document.createElementNS(ns, "path");
      this.body.setAttribute("fill", "var(--fg, #000)");
      this.body.setAttribute("fill-rule", "evenodd");
      this.clipPath.setAttribute("clip-rule", "evenodd");
      this.decalG = document.createElementNS(ns, "g");
      this.decalEls = [];
      const eyesG = document.createElementNS(ns, "g");
      eyesG.setAttribute("clip-path", `url(#${clipId})`);
      this.eyeEls = [0, 1].map(() => {
        const p = document.createElementNS(ns, "path");
        p.setAttribute("fill", "var(--bg, #f3efe6)");
        eyesG.appendChild(p);
        return p;
      });
      this.mouth = document.createElementNS(ns, "path");
      this.mouth.setAttribute("fill", "var(--bg, #fff)");
      this.mouth.style.display = "none";
      eyesG.appendChild(this.mouth);
      this.badge = document.createElementNS(ns, "circle");
      this.badge.setAttribute("style", "display:none");
      this.group.appendChild(this.body);
      this.group.appendChild(this.decalG);
      this.group.appendChild(eyesG);
      this.group.appendChild(this.badge);

      this.fx = new FX.OverlayLayer();
      const R = geo.Re;
      this.fx.circlePath = FX.circlePathOf(R);
      this.fx.pencilPath = FX.capsule(30, 88, R);
      this.fx.bangPath = FX.taper(30, 17, 96, R);
      this.fx.attach(this.svg, this.group);
      this.particles = FX.createParticles({
        back: this.fx.back,
        front: this.fx.front,
        idPrefix: this.fx.uid,
        getRadius: () => {
          const sh = geo.shapes[this.shapeName];
          const k = K2(clamp(this.shapeSpring.x, 0, 1));
          const to = sh?.beltRadius || FX.beltRadius(sh.path, R);
          let je = k < 0.999 && this.prevBelt != null
            ? this.prevBelt + (to - this.prevBelt) * k
            : to;
          if (this.state === "loading") je += (52 - je) * clamp(this.overlay.x, 0, 1);
          return je;
        },
      });
      this.body.setAttribute("d", geo.shapes[this.shapeName].path);
      this.clipPath.setAttribute("d", geo.shapes[this.shapeName].path);
    }

    _poseRing(restRing, R, spinAmt, morphing) {
      // Sphere limb is rotation-invariant. Only solids-of-revolution change
      // silhouette with yaw (same path as the spin trick). Tilt-squash was
      // flattening the ball into a coin.
      const yaw = ((this.pose.turn - this.poseRest.turn) * Math.PI) / 180 * this._mix();
      const spinning = spinAmt != null;
      const yawAmt = (spinAmt ?? 0) + yaw;
      if (morphing || Math.abs(yawAmt) < 1e-5) return { ring: restRing, turned: false };
      const turnAt = FX.turnAtOf(this.shapeName, this.geo.shapes[this.shapeName].path, R, this.geo.solids);
      if (!turnAt) return { ring: restRing, turned: false };
      return { ring: turnAt(yawAmt), turned: true };
    }

    _morphEyes(index, stiffness = 7) {
      if (index === this.eyeTo && this.eyeMorph.t === 1) return;
      const t = clamp(this.eyeMorph.x, 0, 1);
      this.eyeFrom = this.eyeTo;
      this._fromPolys = this._currentPolys(t);
      this.eyeTo = index;
      this.eyeMorph.x = 0;
      this.eyeMorph.v = 0;
      this.eyeMorph.t = 1;
      this.eyeStiffness = stiffness;
    }

    _currentPolys(t) {
      const eyes = this.geo.eyes;
      const from = this._fromPolys || eyes[this.eyeFrom];
      const to = eyes[this.eyeTo];
      return [lerpPoly(from[0], to[0], t), lerpPoly(from[1], to[1], t)];
    }

    _pn(turns = 1, dir = sign()) {
      if (this.reduceMotion || this.paused || this.spinTurn) return;
      this.spinTurn = TR.makeSpinTurn(turns, dir);
    }

    _hop(now) {
      if (this.reduceMotion || this.paused || this.hopAt >= 0) return;
      this.hopAt = now;
    }

    _cycleShapeTrick() {
      if (this.reduceMotion || this.paused || this.driven || this.manualHold || !this.autoTricks) return;
      this.trickCycle = (this.trickCycle + 1) % 5;
      this.wildWide = false;
      if (this.trickCycle === 0) this._pn(1);
      else if (this.trickCycle === 1) {
        this.wildWide = true;
        this._pn(2);
      } else if (this.trickCycle === 2) {
        if (!this.trick) this.trick = TR.startTrick("spinBounce", this.reduceMotion);
      } else if (this.trickCycle === 3) {
        if (!this.trick) this.trick = TR.startTrick("spinDizzy", this.reduceMotion);
      } else {
        this._pn(1);
        this.particles.burst(16, 0.95, 0.3);
      }
    }

    _stepOverlay(now) {
      const want = FX.MAP[this.state] || null;
      if (want !== this.ovTarget) {
        this.ovTarget = want;
        this.fx.overlayAt = now;
        this.ovRest = false;
        this.ovRestAt = 0;
      }
      let on = want != null;
      if (want && FX.CYCLE.has(this.state)) {
        if (!this.ovRest && now - this.fx.overlayAt > (FX.CYCLE_ON[this.state] || 2500)) {
          this.ovRest = true;
          this.ovRestAt = now;
        } else if (this.ovRest && now - this.ovRestAt > FX.CYCLE_OFF) {
          this.ovRest = false;
          this.fx.overlayAt = now;
        }
        on = !this.ovRest;
      }
      this.overlay.t = on ? 1 : 0;
      if (on !== this.ovOn) {
        if (!this.reduceMotion) {
          if (on) this.ovTurnDir = sign();
          this.ovTurnAcc += Math.PI * this.ovTurnDir;
          this.overlayTurn.t = this.ovTurnAcc;
        }
        this.ovOn = on;
      }
      if (want && want !== this.ovKind) {
        if (this.ovKind && this.overlay.x > 0.02) {
          this.ovPrev = this.ovKind;
          this.overlayMix.x = 0;
          this.overlayMix.v = 0;
          this.overlayMix.t = 1;
        } else {
          this.ovPrev = null;
          this.overlayMix.x = 1;
          this.overlayMix.v = 0;
          this.overlayMix.t = 1;
        }
        this.ovKind = want;
        this.fx.overlayAt = now;
        if (want !== "pencil") this.fx.resetInk();
      }
      if (!want && this.overlay.x < 0.004) {
        this.ovKind = null;
        this.ovPrev = null;
      }
      if (this.overlayMix.x > 0.996) this.ovPrev = null;
    }

    _updatePointer(now) {
      const src = this.gazeTarget || (this.followPointer ? this.pointerRaw : null);
      if (src && this.svg.getBoundingClientRect) {
        if (now - this.rectAt > 200) {
          this.rectCache = this.svg.getBoundingClientRect();
          this.rectAt = now;
        }
        const rect = this.rectCache;
        if (rect && rect.width > 0) {
          const mapped = this.gazeTarget ? src : mapPointer(rect, src);
          this.pointer.tx = clamp((mapped.x - (rect.left + rect.width / 2)) / rect.width, -0.6, 0.6) * 22;
          this.pointer.ty = clamp((mapped.y - (rect.top + rect.height / 2)) / rect.height, -0.6, 0.6) * 14;
        }
      } else {
        this.pointer.tx = 0;
        this.pointer.ty = 0;
      }
    }

    _tick(now) {
      if (this.frozen) {
        this._raf = 0;
        return;
      }
      const dt = Math.min((now - this.last) / 1000, 0.1);
      this.last = now;

      if (!this.paused && this.mode === "onboarding" && now - this.stateAt >= ONBOARDING_MS) {
        this.moodN += 1;
        this.setState(onboardMood(this.moodN));
      }

      const mt = (now - this.t0) / 1000;
      const dtState = (now - this.stateAt) / 1000;
      const pose = applyPose(this.state, mt, dtState, now, this.ctx, {
        eyeTo: this.eyeTo,
        eyeMorphX: this.eyeMorph.x,
        blinkX: this.blink.x,
        playlist: this.playlists,
        prev: this.poseOut,
      });
      this.poseOut = pose;
      this.spin.t = this.manualHold ? 0 : pose.spin;
      this.tx.t = this.manualHold ? 0 : pose.tx;
      this.ty.t = this.manualHold ? 0 : pose.ty;
      this.squash.t = this.manualHold ? 1 : pose.squash;
      this.eyeScale.t = this.manualHold ? 1 : pose.eyeBoost;
      if (this.manualHold) {
        this.blink.t = 1;
        this.gazeX.t = 0;
        this.gazeY.t = 0;
      }
      if (!this.manualHold && this.ctx.tyKick) {
        this.ty.v += this.ctx.tyKick;
        this.ctx.tyKick = 0;
      }
      if (!this.manualHold && this.ctx.spinKick) {
        this.spin.v += this.ctx.spinKick;
        this.ctx.spinKick = 0;
      }
      if (this.ctx.forceSleepEye) {
        this.ctx.forceSleepEye = false;
        this._morphEyes(13, 11);
      }
      if (this.ctx.wakeEye) {
        this._morphEyes(this.ctx.wakeEye[0], this.ctx.wakeEye[1]);
        this.ctx.wakeEye = null;
      }
      if (this.ctx.wakeBlink && !this.ctx.wakingBlinked && this.blinkQueue.length === 0) {
        EY.queueBlink(this.blinkQueue, now);
        this.ctx.wakingBlinked = true;
      }
      this.ctx.wakeBlink = false;
      if (this.ctx.wantBlink) {
        EY.queueBlink(this.blinkQueue, now);
        this.ctx.wantBlink = false;
      }
      if (!this.manualHold && this.ctx.wantPn) {
        if (this.autoTricks) this._pn(...this.ctx.wantPn);
        this.ctx.wantPn = null;
      }
      if (!this.manualHold && this.ctx.wantBurst) {
        this.particles.burst(this.ctx.wantBurst[0], this.ctx.wantBurst[1]);
        this.ctx.wakingBurst = true;
        this.ctx.wantBurst = null;
      }

      if (this.manualHold) {
        this.ovKind = null;
        this.ovPrev = null;
        this.ovTarget = null;
        this.overlay.t = 0;
        this.notify.t = 0;
        this.humDots.t = 0;
      } else {
        this._stepOverlay(now);
      }

      if (this.autoTricks && !this.manualHold && this.celebrateAt > 0 && now >= this.celebrateAt && !this.trick) {
        this.trick = TR.startTrick("spinWild", this.reduceMotion || this.paused);
        this.celebrateAt = now + 6200;
      }

      if (this.autoTricks && !this.driven && !this.manualHold && now >= this.trickAt) {
        if ((V_T.has(this.state) || B_T.has(this.state)) && !this.spinTurn && this.hopAt < 0 && !this.trick) {
          const z = Math.random();
          if (V_T.has(this.state)) {
            if (z < 0.55) this._pn(1);
            else this.trick = TR.startTrick("spinBounce", this.reduceMotion || this.paused);
          } else if (z < 0.34) this.trick = TR.startTrick("spinBounce", this.reduceMotion || this.paused);
          else if (z < 0.62) this._hop(now);
          else if (z < 0.86) this.trick = TR.startTrick("spinDizzy", this.reduceMotion || this.paused);
          else this._pn(1);
        }
        this.trickAt = now + rand(9000, 18000);
      }

      const tf = TR.evalTrick(this.trick, now);
      if (tf.wantHop) this._hop(now);
      if (tf.done) this.trick = null;
      let hop = TR.hopY(this.hopAt, now);
      if (hop == null) {
        this.hopAt = -1;
        hop = 0;
      }
      this.extras = { ...tf, turn: tf.turn, hop };

      if (!this.manualHold && this.extras.eyeBoost != null) this.eyeScale.t = this.extras.eyeBoost;

      if (this.state !== "waking" && this.state !== "sleeping" && !this.playlistHold && now >= this.eyeUntil) {
        const list = this.playlists[this.state];
        this.eyeIdx = (this.eyeIdx + 1 + Math.floor(rand(0, list.length - 1))) % list.length;
        const stiff = this.state === "searching" || this.state === "excited" ? 10 : 6;
        this._morphEyes(list[this.eyeIdx], stiff);
        const hold = rand(...EYE_HOLD_MS[this.state]);
        this.eyeHoldMs = hold;
        this.eyeRemain = hold;
        this.eyeUntil = now + hold;
      }

      const blinkCadence = BLINK_MS[this.state];
      if (blinkCadence && now >= this.blinkUntil) {
        EY.queueBlink(this.blinkQueue, now);
        this.blinkUntil = now + rand(...blinkCadence);
      }
      const blinkKey = EY.consumeBlink(this.blinkQueue, now);
      this.blink.t = this.paused && this.manualHold
        ? 1
        : blinkKey ?? (this.blinkQueue.length ? this.blink.t : (this.extras.lidMul ?? pose.lid));

      if (!this.manualHold && now >= this.gazeUntil) {
        const gz = nextGaze(this.state);
        this.gazeX.t = gz.x;
        this.gazeY.t = gz.y;
        this.gazeUntil = now + rand(...gz.hold);
      }

      if (!this.manualHold && WINK_STATES.has(this.state) && now >= this.winkUntil) {
        this.winkAt = now;
        this.winkEye = Math.random() < 0.5 ? 0 : 1;
        this.winkUntil = now + rand(4500, 10000);
      }

      this.emphasisBlend += ((this.emphasis ? 1 : 0) - this.emphasisBlend) * Rn(0.12);

      if (this.emphasis && !this.manualHold) {
        this.eyeScale.t = Math.max(this.eyeScale.t, 1.32);
        this.blink.t = Math.max(this.blink.t, 1.18);
      }

      const humming = this.state === "humming";
      const loading = this.state === "loading";
      if ((humming || loading) && !this.reduceMotion && !this.manualHold) {
        const Zt = dtState;
        const dn = loading ? 3 : 1.6;
        const on = Zt < 0.5 ? 7 * K2(Zt / 0.5) : Zt < 1.3 ? 7 + (dn - 7) * K2((Zt - 0.5) / 0.8) : dn + 0.3 * Math.sin(Zt * 0.5);
        this.ovSpin += on * dt;
      }

      if (this.reduceMotion && !this.manualHold) {
        this._morphEyes(this.playlists[this.state][0]);
        this.spin.t = 0; this.tx.t = 0; this.ty.t = 0;
        this.squash.t = 1; this.blink.t = 1; this.eyeScale.t = 1;
      }

      const nSteps = springSteps(dt);
      const step = dt / nSteps;
      for (let i = 0; i < nSteps; i++) {
        stepSpring(this.eyeMorph, this.eyeStiffness, 1, step);
        if (this.spinTurn) stepSpring(this.spinTurn, ...SPRINGS.spinTurn, step);
        stepSpring(this.spin, ...SPRINGS.spin, step);
        stepSpring(this.tx, ...SPRINGS.x, step);
        stepSpring(this.ty, ...SPRINGS.y, step);
        stepSpring(this.squash, ...SPRINGS.squash, step);
        stepSpring(this.blink, ...SPRINGS.blink, step);
        stepSpring(this.eyeScale, ...SPRINGS.eyeScale, step);
        stepSpring(this.notify, ...SPRINGS.notify, step);
        stepSpring(this.humDots, ...SPRINGS.humDots, step);
        stepSpring(this.gazeX, ...SPRINGS.gazeX, step);
        stepSpring(this.gazeY, ...SPRINGS.gazeY, step);
        stepSpring(this.overlay, ...SPRINGS.overlay, step);
        stepSpring(this.overlayMix, ...SPRINGS.overlayMix, step);
        stepSpring(this.shapeSpring, ...SPRINGS.shape, step);
        stepSpring(this.overlayTurn, ...SPRINGS.overlayTurn, step);
        stepSpring(this.manualMix, ...SPRINGS.manualMix, step);
      }
      if (this.reduceMotion) {
        this.overlayMix.x = 1;
        this.overlayTurn.x = this.overlayTurn.t;
        this.overlay.x = this.overlay.t;
      }
      if (this.spinTurn) {
        if (TR.spinTurnSettled(this.spinTurn)) {
          this.spinTurn = null;
          this.wildWide = false;
        } else {
          this.extras = { ...this.extras, turn: (this.extras.turn ?? 0) + this.spinTurn.x };
        }
      }
      if (this.gazeOrbit) {
        const u = clamp((now - this.gazeOrbit.at) / this.gazeOrbit.dur, 0, 1);
        const ease = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
        this.gazeSpin = this.gazeOrbit.from * (1 - ease);
        if (u >= 1) {
          this.gazeOrbit = null;
          this.gazeSpin = 0;
        }
      } else {
        this.gazeSpin = 0;
      }
      if (!this.manualHold) {
        this.notify.t = this.state === "notifying" ? 1 : 0;
        this.humDots.t = this.state === "humming" ? 1 : 0;
      }

      let spinAngle = 0;
      if (this.spinTurn) spinAngle = this.spinTurn.x;
      else if (this.extras.turn != null) spinAngle = this.extras.turn;
      else if (humming || loading) spinAngle = this.ovSpin;
      if (now - this.pxAt > 500 && this.svg.getBoundingClientRect) {
        const w = this.svg.getBoundingClientRect().width;
        if (w > 0) {
          this.pxW = w;
          this.partScale = clamp(Math.pow(340 / w, 0.7), 1, 2.6);
        }
        this.pxAt = now;
      }
      this.particles.update(now, dt, {
        spinAngle,
        sizeScale: this.partScale,
        wideStyle: !this.manualHold && (this.trick?.kind === "spinWild" || this.wildWide || humming),
        sustainBelts: !this.manualHold && (humming || loading),
      });

      this._updatePointer(now);
      this._paint(now);

      if (this.driven) {
        this._raf = 0;
        return;
      }

      if (
        this.paused
        && !this.trick
        && !this.spinTurn
        && this.hopAt < 0
        && !this.particles.hasLife()
        && !springBusy(this.manualMix)
        && !springBusy(this.spin)
        && !springBusy(this.tx)
        && !springBusy(this.ty)
        && !springBusy(this.squash)
        && Math.abs(this.overlay.x - this.overlay.t) < 0.001
        && Math.abs(this.overlayTurn.t - this.overlayTurn.x) < 0.01
        && this.overlayMix.x > 0.996
        && Math.abs(this.shapeSpring.x - this.shapeSpring.t) < 0.001
        && Math.abs(this.eyeMorph.x - this.eyeMorph.t) < 0.001
      ) {
        for (const s of [this.spin, this.tx, this.ty, this.gazeX, this.gazeY]) {
          s.x = 0; s.v = 0; s.t = 0;
        }
        for (const s of [this.squash, this.blink, this.eyeScale]) {
          s.x = 1; s.v = 0; s.t = 1;
        }
        this.shapeSpring.x = this.shapeSpring.t;
        this.shapeSpring.v = 0;
        this.blinkQueue = [];
        this.winkAt = -1e9;
        if (!this.manualHold) {
          const home = this.playlists[this.state]?.[0] ?? 0;
          this.eyeFrom = home;
          this.eyeTo = home;
          this._fromPolys = null;
          this.eyeMorph.x = 1;
          this.eyeMorph.v = 0;
          this.eyeMorph.t = 1;
        }
        this.poseOut = { spin: 0, tx: 0, ty: 0, squash: 1, lid: 1, eyeBoost: 1 };
        this._paint(this.last);
        this._raf = 0;
        return;
      }

      this._raf = requestAnimationFrame((t) => this._tick(t - this.clockHold));
    }

    _paint(now) {
      const geo = this.geo;
      const R = geo.Re;
      const shape = geo.shapes[this.shapeName];
      const morphK = K2(clamp(this.shapeSpring.x, 0, 1));
      const morphing = morphK < 0.999 && this.prevFace;
      const face = morphing ? lerpFace(this.prevFace, shape.face, morphK) : shape.face;
      const fromTilt = this.prevTilt ?? (geo.shapes[this.prevShape]?.tiltScale || 1);
      const tilt = morphing
        ? fromTilt + ((shape.tiltScale || 1) - fromTilt) * morphK
        : (shape.tiltScale || 1);
      const yl = clamp(this.overlay.x, 0, 1);
      const mix = clamp(this.overlayMix.x, 0, 1);
      this.fx._reduce = this.reduceMotion;
      const ov = this.fx.extras(now, this.stateAt, this.ovKind, this.ovPrev, yl, mix);
      const bodyW = 1 - yl;
      const ex = this.extras;
      const holdMix = this._mix();
      const tx = this.tx.x * bodyW + ex.yi * bodyW + ov.yre * yl + this.manualTx * holdMix;
      const ty = (this.ty.x + ex.hop) * bodyW + ex.ki * bodyW - ov.rX.lift * ov.Lee + ov.aX * yl + this.manualTy * holdMix;
      const rot = (this.spin.x * bodyW + ex.Kr * bodyW) * tilt + (ex.Yr || 0) * bodyW + ov.wl * yl + this.manualSpin * holdMix;
      const sx = bodyW + ov.wre * yl;
      const sy = this.squash.x * bodyW + ov.wre * yl;
      this.group.setAttribute(
        "transform",
        `translate(${(R + tx).toFixed(2)} ${(R + ty).toFixed(2)}) rotate(${rot.toFixed(2)}) scale(${sx.toFixed(4)} ${sy.toFixed(4)}) translate(${-R} ${-R})`
      );
      this.group.style.opacity = ((1 - (1 - ov.rX.tone) * ov.Lee) * (1 - ov.fade)).toFixed(3);

      const Jc = clamp(yl / FX.P_BLEND, 0, 1);
      const pencil = this.ovKind === "pencil" || this.ovPrev === "pencil";
      const tear = geo.shapes.teardrop?.path;
      const spinAmt = ex.turn;
      const restRing = morphing
        ? FX.lerpRing(this.prevRing, FX.shapeRing(shape.path, R), morphK)
        : FX.shapeRing(shape.path, R);
      const posed = this._poseRing(restRing, R, spinAmt, morphing);
      const liveRing = posed.ring;
      const turned = posed.turned;
      let faceTop = shape.top;
      let faceBottom = shape.bottom;
      if (morphing || turned) {
        faceTop = Infinity;
        faceBottom = -Infinity;
        for (const p of liveRing) {
          if (p[1] < faceTop) faceTop = p[1];
          if (p[1] > faceBottom) faceBottom = p[1];
        }
      }
      let bodyD;
      if (Jc >= 1) {
        bodyD = pencil ? FX.closedSpline(FX.overlayRing(this.ovKind, R, tear)) : this.fx.circlePath;
      } else if (Jc <= 0 && !morphing && !turned) {
        bodyD = shape.path;
      } else {
        const to = FX.overlayRing(this.ovKind || this.ovPrev, R, tear);
        bodyD = FX.closedSpline(Jc <= 0 ? liveRing : FX.lerpRing(liveRing, to, K2(Jc)));
      }
      this.body.setAttribute("d", bodyD);
      this.clipPath.setAttribute("d", bodyD);
      const decals = !morphing && yl < 0.45 && shape.decals ? shape.decals : [];
      const ns = "http://www.w3.org/2000/svg";
      while (this.decalEls.length < decals.length) {
        const p = document.createElementNS(ns, "path");
        this.decalG.appendChild(p);
        this.decalEls.push(p);
      }
      for (let i = 0; i < this.decalEls.length; i++) {
        const el = this.decalEls[i];
        const decal = decals[i];
        if (!decal) {
          el.style.display = "none";
          continue;
        }
        el.style.display = "";
        el.setAttribute("fill", decal.fill);
        el.setAttribute("fill-rule", decal.rule || "evenodd");
        if (el.getAttribute("d") !== decal.d) el.setAttribute("d", decal.d);
      }
      const mouthD = !morphing && yl < 0.45 && shape.mouth ? shape.mouth : "";
      if (this.mouth) {
        if (mouthD) {
          this.mouth.style.display = "";
          if (this.mouth.getAttribute("d") !== mouthD) this.mouth.setAttribute("d", mouthD);
        } else {
          this.mouth.style.display = "none";
        }
      }

      this.fx.paint(now, this.stateAt, this.ovKind, this.ovPrev, yl, mix, R, this.reduceMotion);

      const shrink = 1 - Dke(clamp((this.pxW - 44) / 90, 0, 1));
      const pScale = this.pose.scale || 1;
      const zCur = overlayViewZoom(this.ovKind, pScale);
      const zPrev = overlayViewZoom(this.ovPrev, pScale);
      const zoom = 1 + (zCur * mix + zPrev * (1 - mix) - 1) * yl * shrink;
      const half = this.frameHalf / zoom;
      this.svg.setAttribute("viewBox", `${(VIEW_MID - half).toFixed(2)} ${(VIEW_MID - half).toFixed(2)} ${(half * 2).toFixed(2)} ${(half * 2).toFixed(2)}`);

      const morphT = clamp(this.eyeMorph.x, 0, 1);
      const polys = this._currentPolys(morphT);
      const cr = this.eyeTopology ? relRot(this._poseNow(), this.poseHome) : null;
      const overlayLive = yl > 0.001 || Math.abs(this.overlayTurn.t - this.overlayTurn.x) > 0.01;
      let cyl = overlayLive ? this.overlayTurn.x : null;
      if (ex.turn != null) cyl = (cyl ?? 0) + ex.turn;
      if (this.gazeSpin) cyl = (cyl ?? 0) + this.gazeSpin;
      const ringHint = morphing || turned ? liveRing : null;
      const tracking = !!(this.gazeTarget || (this.followPointer && this.pointerRaw));
      const eyeShape = morphing ? Object.assign({}, shape, { iconFace: null }) : shape;
      EY.paintEyes({
        now,
        polys,
        morphT,
        shape: eyeShape,
        face,
        faceTune: this.faceTune,
        uniformEyes: this.uniformEyes,
        eyeScaleProp: this.eyeScaleProp,
        blinkX: this.blink.x,
        eyeBoostX: this.eyeScale.x,
        gazeX: this.gazeX.x,
        gazeY: this.gazeY.x,
        winkAt: this.winkAt,
        winkEye: this.winkEye,
        turn: cyl,
        cr,
        pointer: this.pointer,
        tracking,
        notifyX: this.notify.x,
        overlayX: this.overlay.x,
        eyeEls: this.eyeEls,
        badgeEl: this.badge,
        badgeColor: this.badgeColor,
        Re: R,
        G9e: geo.G9e,
        VJt: geo.VJt,
        extras: ex,
        ringHint,
        badgeRing: restRing,
        top: faceTop,
        bottom: faceBottom,
        emphasisBlend: this.emphasisBlend,
        tune: null,
        manualHold: false,
        manualMix: 0,
      });
      if (holdMix > 0.002) {
        // Eye-sphere rim = visible head half-width in overlay units, so the
        // fold/slice lands on the silhouette like the original lab.
        let rim = 95;
        if (restRing) {
          let hw = 0;
          for (const p of restRing) hw = Math.max(hw, Math.abs(p[0] - R));
          rim = (hw * 300) / (R * 3.16);
        }
        EY.blendCustomEyes({
          eyeEls: this.eyeEls,
          pose: this._poseNow(),
          eyes: this.eyeTune,
          svg: this.svg,
          mix: holdMix,
          rim,
        });
      }

      const hum = clamp(this.humDots.x, 0, 1);
      if (hum > 0.01) {
        for (let i = 0; i < 2; i++) {
          const el = this.fx.parts[3 + i];
          if (!el) continue;
          const Gn = this.ovSpin * 0.85 + i * Math.PI;
          const Ti = shape.radius * 1.3;
          const Ui = Math.cos(Gn);
          const Si = 0.55 + 0.45 * clamp((Ui + 1) / 2, 0, 1);
          el.style.display = "";
          el.setAttribute("cx", (R + Ti * Math.sin(Gn)).toFixed(1));
          el.setAttribute("cy", (R - Ti * 0.38 * Math.cos(Gn) - 8).toFixed(1));
          el.setAttribute("r", (7.5 * Si * hum).toFixed(2));
          el.setAttribute("opacity", ((0.3 + 0.7 * Si) * hum).toFixed(3));
        }
      }
    }
  }

  g.GrokCharacter = GrokCharacter;
  g.GROK_META = {
    groups: GROUPS,
    onboarding: ONBOARDING,
    onboardingMs: ONBOARDING_MS,
    eyePlaylist: EYE_PLAYLIST,
    springs: SPRINGS,
    faceTune: FACE_TUNE,
    pose: POSE,
    poseHome: POSE_HOME,
    overlays: FX.MAP,
  };
})(window);
