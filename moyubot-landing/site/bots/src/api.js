/* L2 — public factory + <grok-bot>. Skin: eyes / shapes / playlist / palette. */
(function (g) {
  const ATTRS = ["state", "shape", "color", "size", "paused", "follow", "mode", "emphasis"];

  function mergeSkin(opts = {}) {
    const base = opts.geo || g.GROK_GEO;
    return {
      ...base,
      eyes: opts.eyes || base.eyes,
      shapes: opts.shapes ? { ...base.shapes, ...opts.shapes } : base.shapes,
      palette: opts.palette ? { ...base.palette, ...opts.palette } : base.palette,
      solids: opts.solids || base.solids,
    };
  }

  function resolveSvg(target) {
    if (!target) throw new Error("GROK.create: missing target");
    if (typeof target === "string") {
      const el = document.querySelector(target);
      if (!el) throw new Error("GROK.create: no match for " + target);
      target = el;
    }
    if (target.tagName === "SVG" || target instanceof SVGSVGElement) return target;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    target.appendChild(svg);
    return svg;
  }

  function createCharacter(target, opts = {}) {
    const svg = resolveSvg(target);
    const geo = mergeSkin(opts);
    const playlist = opts.playlist
      ? { ...g.GROK_TABLES.EYE_PLAYLIST, ...opts.playlist }
      : g.GROK_TABLES.EYE_PLAYLIST;
    const bot = new g.GrokCharacter(svg, { mode: "hold", ...opts, geo, playlist });
    return {
      bot,
      svg,
      setState: (name, o) => bot.setState(name, o),
      setShape: (name) => bot.setShape(name),
      setColor: (id, scheme) => bot.setColor(id, scheme),
      setPaused: (v) => bot.setPaused(v),
      setMode: (m) => bot.setMode(m),
      setFollowPointer: (v) => bot.setFollowPointer(v),
      setPose: (v) => bot.setPose(v),
      setManualOffset: (v) => bot.setManualOffset(v),
      setEyeTune: (v) => bot.setEyeTune(v),
      setManualHold: (v) => bot.setManualHold(v),
      setEmphasis: (v) => bot.setEmphasis(v),
      spin: (n) => bot.spinOnce(n),
      bounce: () => bot.bounceOnce(),
      burst: () => bot.burstOnce(),
      destroy: () => bot.destroy(),
      snapshot: () => bot.snapshot(),
    };
  }

  class GrokBotElement extends HTMLElement {
    static get observedAttributes() { return ATTRS; }

    connectedCallback() {
      if (this._handle) return;
      const root = this.shadowRoot || this.attachShadow({ mode: "open" });
      root.replaceChildren();
      const box = document.createElement("div");
      box.setAttribute("part", "disk");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", this.getAttribute("label") || "character");
      box.appendChild(svg);
      const style = document.createElement("style");
      style.textContent = `:host{display:inline-block;line-height:0}div{width:100%;height:100%}svg{width:100%;height:100%;overflow:visible}`;
      root.append(style, box);
      this._applySize();
      this._handle = createCharacter(svg, this._opts());
      this.bot = this._handle.bot;
    }

    disconnectedCallback() {
      this._handle?.destroy();
      this._handle = null;
      this.bot = null;
    }

    attributeChangedCallback(name, prev, next) {
      if (!this._handle || prev === next) return;
      this._applySize();
      if (name === "state") this._handle.setState(next || "idle");
      else if (name === "shape") this._handle.setShape(next || "zeta");
      else if (name === "color") this._handle.setColor(next || "black");
      else if (name === "paused") this._handle.setPaused(this.hasAttribute("paused"));
      else if (name === "follow") this._handle.setFollowPointer(next === "true");
      else if (name === "emphasis") this._handle.setEmphasis(this.hasAttribute("emphasis"));
      else if (name === "mode") this._handle.setMode(next || "hold");
    }

    _applySize() {
      const n = Number(this.getAttribute("size"));
      if (n > 0) {
        this.style.width = `${n}px`;
        this.style.height = `${n}px`;
      }
    }

    _opts() {
      const size = Number(this.getAttribute("size"));
      return {
        state: this.getAttribute("state") || "idle",
        shape: this.getAttribute("shape") || "zeta",
        color: this.getAttribute("color") || "black",
        sizePx: size > 0 ? size : null,
        paused: this.hasAttribute("paused"),
        followPointer: this.getAttribute("follow") === "true",
        emphasis: this.hasAttribute("emphasis"),
        mode: this.getAttribute("mode") || "hold",
        loginWrap: this.getAttribute("login") !== "false",
      };
    }

    setState(name) { this._handle?.setState(name); }
    setShape(name) { this._handle?.setShape(name); }
    setColor(id) { this._handle?.setColor(id); }
    setPaused(v) { this._handle?.setPaused(v); }
    spin(n) { this._handle?.spin(n); }
    bounce() { this._handle?.bounce(); }
    destroy() { this._handle?.destroy(); }
  }

  function define(name = "grok-bot") {
    if (!customElements.get(name)) customElements.define(name, GrokBotElement);
    return name;
  }

  define();
  g.GROK = {
    create: createCharacter,
    define,
    mergeSkin,
    Character: g.GrokCharacter,
  };
})(window);
