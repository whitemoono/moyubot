import React, {useEffect, useRef} from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';

const VERT = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`;

/* 深夜极光：fbm 噪声 + 流动光带 + 晕影 + 细颗粒。u_time 由帧号驱动，逐帧确定。 */
const FRAG = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_hue;
uniform float u_boost;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0; float a = 0.55;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(19.7, 7.3); a *= 0.5; }
  return v;
}
vec3 shade(float h){
  vec3 c1 = vec3(0.16, 0.36, 0.98);   /* blue */
  vec3 c2 = vec3(0.28, 0.80, 0.86);   /* teal */
  vec3 c3 = vec3(0.62, 0.36, 0.98);   /* violet */
  float k = clamp(h + u_hue, 0.0, 1.0);
  vec3 c = mix(c1, c2, smoothstep(0.0, 0.55, k));
  c = mix(c, c3, smoothstep(0.55, 1.0, k));
  return c;
}
void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 st = uv; st.x *= u_res.x / u_res.y;
  float t = u_time;

  float band1 = fbm(vec2(st.x * 1.4 + t * 0.06, st.y * 2.2 - t * 0.045));
  float band2 = fbm(vec2(st.x * 2.6 - t * 0.05 + 7.0, st.y * 1.2 + t * 0.03 + 3.0));
  float aurora = smoothstep(0.35, 0.95, band1 * 0.75 + band2 * 0.45);
  aurora *= smoothstep(1.15, 0.15, uv.y) * 0.9 + 0.1;

  vec3 base = mix(vec3(0.027, 0.043, 0.106), vec3(0.05, 0.09, 0.19), uv.y);
  vec3 col = base + shade(band2) * aurora * (0.34 + 0.2 * u_boost);
  col += shade(band1 + 0.35) * pow(band2, 3.0) * 0.22 * (1.0 + u_boost);

  float vig = smoothstep(1.25, 0.35, length(uv - vec2(0.5, 0.55)));
  col *= 0.55 + 0.45 * vig;
  col += (hash(uv * u_res + t) - 0.5) * 0.016;
  gl_FragColor = vec4(col, 1.0);
}
`;

const compile = (gl: WebGLRenderingContext, type: number, src: string) => {
  const sh = gl.createShader(type);
  if (!sh) {
    throw new Error('no shader');
  }
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(sh) ?? 'shader compile failed');
  }
  return sh;
};

const programs = new WeakMap<HTMLCanvasElement, {gl: WebGLRenderingContext; prog: WebGLProgram; u: Record<string, WebGLUniformLocation | null>}>();

const ensure = (canvas: HTMLCanvasElement) => {
  let entry = programs.get(canvas);
  if (entry) {
    return entry;
  }
  const gl = canvas.getContext('webgl', {antialias: true, preserveDrawingBuffer: true});
  if (!gl) {
    return null;
  }
  const prog = gl.createProgram();
  if (!prog) {
    return null;
  }
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(prog) ?? 'link failed');
  }
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  entry = {
    gl,
    prog,
    u: {
      res: gl.getUniformLocation(prog, 'u_res'),
      time: gl.getUniformLocation(prog, 'u_time'),
      hue: gl.getUniformLocation(prog, 'u_hue'),
      boost: gl.getUniformLocation(prog, 'u_boost'),
    },
  };
  programs.set(canvas, entry);
  return entry;
};

export const Aurora: React.FC<{
  hue?: number;
  boost?: number;
  opacity?: number;
  style?: React.CSSProperties;
}> = ({hue = 0, boost = 0, opacity = 1, style}) => {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) {
      return;
    }
    const entry = ensure(canvas);
    if (!entry) {
      canvas.style.background = 'linear-gradient(180deg, #070b1c 0%, #0d1730 60%, #101c3e 100%)';
      return;
    }
    const {gl, u} = entry;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(entry.prog);
    gl.uniform2f(u.res, canvas.width, canvas.height);
    gl.uniform1f(u.time, frame / fps);
    gl.uniform1f(u.hue, hue);
    gl.uniform1f(u.boost, boost);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }, [frame, fps, hue, boost, width, height]);

  return (
    <canvas
      ref={ref}
      width={width / 2}
      height={height / 2}
      style={{width: '100%', height: '100%', display: 'block', opacity, ...style}}
    />
  );
};
