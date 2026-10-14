// Sky dome shaders (kept apart from glsl.js; only needs hash/noise helpers).
const GLSL_SKY_COMMON = /* glsl */`
float skyHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float skyNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(skyHash(i), skyHash(i + vec2(1.0, 0.0)), u.x), mix(skyHash(i + vec2(0.0, 1.0)), skyHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float skyFbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * skyNoise(p); p *= 2.03; a *= 0.5; }
  return s;
}
`;

export const GLSL_SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

export const GLSL_SKY_FRAG = /* glsl */`
precision highp float;
varying vec3 vDir;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyTop;
uniform vec3 uSkyHor;
uniform vec3 uFogColor;
uniform float uAurora;
uniform float uRain;
uniform float uNight;
${GLSL_SKY_COMMON}
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(uSkyHor, uSkyTop, pow(h, 0.55));
  col = mix(col, uFogColor, smoothstep(0.02, -0.18, d.y));

  // sun / moon disc and halo
  float sd = max(dot(d, normalize(uSunDir)), 0.0);
  col += uSunColor * (pow(sd, 900.0) * 6.0 + pow(sd, 10.0) * 0.30 * (1.0 - uAurora * 0.6));

  // stars (night only)
  float starAmt = clamp(uAurora + uNight * 0.3, 0.0, 1.0) * (1.0 - uRain);
  if (starAmt > 0.01 && d.y > 0.0) {
    vec3 sp = d * 160.0;
    vec3 cell = floor(sp);
    float r = skyHash(cell.xy + cell.z * 17.0);
    float tw = 0.6 + 0.4 * sin(uTime * 2.0 + r * 40.0);
    float star = step(0.9965, r) * smoothstep(0.5, 0.0, length(fract(sp) - 0.5));
    col += vec3(0.8, 0.85, 1.0) * star * tw * starAmt * smoothstep(0.0, 0.25, d.y);
  }

  // aurora curtains
  if (uAurora > 0.01 && d.y > 0.02) {
    vec2 q = d.xz / (d.y + 0.25);
    float w1 = skyNoise(vec2(q.x * 1.7 + uTime * 0.05, q.y * 0.8));
    float w2 = skyNoise(vec2(q.x * 4.2 - uTime * 0.08, q.y * 1.6 + 3.0));
    float centre = 0.30 + 0.16 * (w1 - 0.5) * 2.0;
    float band = exp(-pow((d.y - centre) * 5.5, 2.0));
    float streak = 0.35 + 0.65 * skyNoise(vec2(q.x * 11.0 + uTime * 0.25, uTime * 0.1 + w2 * 2.0));
    float vert = smoothstep(0.04, 0.18, d.y) * (1.0 - smoothstep(0.55, 0.95, d.y));
    vec3 g = vec3(0.10, 1.0, 0.50), t = vec3(0.10, 0.85, 0.90), v = vec3(0.60, 0.22, 0.98);
    vec3 ac = mix(mix(g, t, smoothstep(0.1, 0.5, w2)), v, smoothstep(0.32, 0.62, d.y + 0.18 * (w1 - 0.5)));
    col += ac * band * streak * vert * 1.7 * uAurora;
  }

  // monsoon cloud deck
  if (uRain > 0.01 && d.y > -0.05) {
    vec2 q = d.xz / (max(d.y, 0.0) + 0.18);
    float c = skyFbm(q * 0.9 + vec2(uTime * 0.02, -uTime * 0.012));
    float cover = smoothstep(0.30, 0.75, c);
    vec3 cloudCol = mix(vec3(0.10, 0.12, 0.15), vec3(0.34, 0.37, 0.42), skyFbm(q * 2.3 + 5.0));
    col = mix(col, cloudCol, cover * uRain * smoothstep(-0.05, 0.25, d.y) * 0.92);
  }
  gl_FragColor = vec4(col, 1.0);
}
`;
