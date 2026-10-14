// Shared GLSL snippets. Colours are authored in sRGB and linearised with lin().
export const GLSL_SIM = /* glsl */`
uniform sampler2D uSimTexA;
uniform sampler2D uSimTexB;
uniform float uTime;
uniform float uCell;
vec2 worldToUv(vec2 xz) { return (xz + 10.0) / 20.0; }
vec4 fetchBil(sampler2D t, vec2 uv) {
#ifdef MANUAL_BILINEAR
  vec2 p = uv * 128.0 - 0.5;
  vec2 f = fract(p);
  vec2 i = (floor(p) + 0.5) / 128.0;
  float s = 1.0 / 128.0;
  vec4 a = texture(t, i), b = texture(t, i + vec2(s, 0.0));
  vec4 c = texture(t, i + vec2(0.0, s)), d = texture(t, i + vec2(s, s));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
#else
  return texture(t, uv);
#endif
}
vec4 simA(vec2 uv) { return fetchBil(uSimTexA, uv); }
vec4 simB(vec2 uv) { return fetchBil(uSimTexB, uv); }
vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
`;

// Elevation with the perimeter collapsed onto the cliff ring (r = 9.2) so the basalt skirt meets it exactly.
export const GLSL_TERRAIN_HEIGHT = /* glsl */`
float terrainHeight(vec2 xz, out vec2 pxz) {
  float r = length(xz) / 10.0;
  float rc = min(r, 0.92);
  pxz = r > 0.0001 ? xz * (rc / r) : xz;
  float e = simA(worldToUv(pxz)).r;
  return mix(e, -0.6, smoothstep(0.895, 0.92, r));
}
float terrainH(vec2 xz) { vec2 d; return terrainHeight(xz, d); }
`;

export const GLSL_ISLAND_VERT_NORMAL = /* glsl */`
  vec2 sPxz;
  float sElev = terrainHeight(position.xz, sPxz);
  float eL = terrainH(sPxz - vec2(uCell, 0.0));
  float eR = terrainH(sPxz + vec2(uCell, 0.0));
  float eU = terrainH(sPxz - vec2(0.0, uCell));
  float eD = terrainH(sPxz + vec2(0.0, uCell));
  vec3 objectNormal = normalize(vec3(eL - eR, 2.0 * uCell, eU - eD));
`;

export const GLSL_ISLAND_VERT_POS = /* glsl */`
  vec3 transformed = vec3(sPxz.x, sElev, sPxz.y);
  vWP = transformed;
  vWN = objectNormal;
  vSimUv = worldToUv(sPxz);
`;

export const GLSL_ISLAND_FRAG_COLOR = /* glsl */`
  vec4 tA = simA(vSimUv);
  vec4 tB = simB(vSimUv);
  float elevF = vWP.y;
  float upN = normalize(vWN).y;
  float steep = 1.0 - smoothstep(0.55, 0.88, upN);
  float rr = length(vWP.xz) / 10.0;

  vec3 clayLo = lin(vec3(0.58, 0.40, 0.28));
  vec3 clayHi = lin(vec3(0.82, 0.68, 0.48));
  vec3 basalt = lin(vec3(0.20, 0.20, 0.24));
  vec3 dryOchre = lin(vec3(0.62, 0.54, 0.34));
  vec3 lush = lin(vec3(0.20, 0.50, 0.22));
  float hq = floor(elevF * 8.0) / 8.0;
  vec3 col = mix(clayLo, clayHi, clamp(hq / 1.2, 0.0, 1.0));
  float fert = clamp(tB.g, 0.0, 1.0) * (1.0 - tB.b * 0.8);
  vec3 grain = lin(vec3(0.74, 0.66, 0.30));
  vec3 greens = mix(mix(dryOchre, grain, smoothstep(0.12, 0.34, fert)), lush, smoothstep(0.34, 0.68, fert));
  col = mix(col, greens, smoothstep(0.04, 0.3, fert) * (1.0 - steep));
  col = mix(col, basalt, clamp(steep * 1.4 + smoothstep(0.83, 0.9, rr) * 0.9, 0.0, 1.0));
  col = mix(col, lin(vec3(0.34, 0.25, 0.18)), smoothstep(0.15, 0.6, tB.b) * 0.85);

  // stepped clay contour terraces (screen-space antialiased)
  float th = elevF * 9.0;
  float tf = fract(th);
  float fw = fwidth(th) + 1e-4;
  float lodFade = 1.0 - smoothstep(0.25, 0.6, fw);
  float lineMask = smoothstep(0.0, fw * 1.5, tf) * (1.0 - smoothstep(1.0 - fw * 1.5, 1.0, tf));
  col *= mix(1.0, mix(0.80, 1.0, lineMask), lodFade);
  float bev = smoothstep(fw, fw * 2.5, tf) * (1.0 - smoothstep(fw * 2.5, fw * 5.0, tf));
  col += 0.05 * bev * (1.0 - steep) * lodFade;

  // cavity AO / ridge highlight from the heightfield laplacian
  float tx = 2.0 / 128.0;
  float lap = (simA(vSimUv + vec2(tx, 0.0)).r + simA(vSimUv - vec2(tx, 0.0)).r
             + simA(vSimUv + vec2(0.0, tx)).r + simA(vSimUv - vec2(0.0, tx)).r) * 0.25 - tA.r;
  float cav = clamp(lap * 14.0, -0.5, 0.5);
  col *= 1.0 - 0.4 * max(cav, 0.0);
  col += 0.05 * max(-cav, 0.0);

  // wet shoreline / soaked soil
  float wetTerr = clamp(tA.g * 14.0 + tB.r * 0.6, 0.0, 1.0);
  col *= (1.0 - 0.45 * wetTerr) * (1.0 - 0.16 * uWet);
  diffuseColor.rgb = col;

  // expanding tectonic / harmonic ring waves from sculpting, monoliths and builders
  vec3 ringGlow = vec3(0.0);
  for (int k = 0; k < 8; k++) {
    vec4 rA = uRingA[k];
    vec4 rB = uRingB[k];
    float age = uTime - rA.z;
    if (rB.x > 0.0 && age > 0.0 && age < rB.y) {
      float R = age * rB.z;
      float d = length(vWP.xz - rA.xy);
      float band = exp(-pow((d - R) / 0.2, 2.0));
      float band2 = exp(-pow((d - R * 0.62) / 0.14, 2.0)) * step(0.5, rA.w) * 0.6;
      float fade = 1.0 - age / rB.y;
      vec3 gold = vec3(1.0, 0.72, 0.3), cyan = vec3(0.3, 0.95, 1.0), dust = vec3(0.75, 0.72, 0.65);
      vec3 rc = rA.w < 0.5 ? gold : (rA.w < 1.5 ? mix(gold, cyan, band2 / (band + band2 + 1e-3)) : dust);
      ringGlow += rc * (band + band2) * fade * rB.x;
    }
  }
  // warm light pools around hearths, lamps and monoliths after dark
  float pool = 0.0;
  for (int k = 0; k < 24; k++) {
    vec4 gP = uGlow[k];
    if (gP.w > 0.0) {
      vec2 gd = (vWP.xz - gP.xy) / gP.z;
      float gf = 1.0 / (1.0 + dot(gd, gd));
      pool += gP.w * gf * gf;
    }
  }
  ringGlow += col * vec3(1.0, 0.62, 0.28) * pool * uNight * 1.8;
`;

export const GLSL_ISLAND_FRAG_EMISSIVE = /* glsl */`
  #include <emissivemap_fragment>
  totalEmissiveRadiance += ringGlow;
`;

// Sun-only shadowing from the CPU heightfield march: ambient light is untouched.
export const GLSL_ISLAND_SHADE = /* glsl */`
  #include <lights_fragment_end>
  float shadeF = fetchBil(uSimTexC, vSimUv).r;
  reflectedLight.directDiffuse *= shadeF;
  reflectedLight.directSpecular *= shadeF;
`;

export const GLSL_ISLAND_FRAG_ROUGH = /* glsl */`
  float roughnessFactor = mix(roughness, 0.26, clamp(wetTerr + uWet * 0.7, 0.0, 1.0));
`;

export const GLSL_WATER_VERT = /* glsl */`
varying vec3 vWP;
varying vec2 vUv;
${GLSL_SIM}
void main() {
  vec2 xz = position.xz;
  float r = length(xz) / 10.0;
  float rc = min(r, 0.92);
  vec2 pxz = r > 0.0001 ? xz * (rc / r) : xz;
  vec4 a = simA(worldToUv(pxz));
  float y = mix(a.r + a.g + 0.004, -0.6, smoothstep(0.895, 0.92, r));
  vWP = vec3(pxz.x, y, pxz.y);
  vUv = worldToUv(pxz);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWP, 1.0);
}
`;

export const GLSL_WATER_FRAG = /* glsl */`
precision highp float;
varying vec3 vWP;
varying vec2 vUv;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyTop;
uniform vec3 uSkyHor;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uRain;
${GLSL_SIM}
void main() {
  vec4 a = simA(vUv);
  float d = a.g;
  if (d < 0.008) discard;
  float t = uTime;
  vec2 flow = a.ba;
  float spd = length(flow);

  // surface normal from the water+bed height field, plus flow-advected ripples
  float s = 1.0 / 128.0;
  float hL = simA(vUv - vec2(s, 0.0)).r + simA(vUv - vec2(s, 0.0)).g;
  float hR = simA(vUv + vec2(s, 0.0)).r + simA(vUv + vec2(s, 0.0)).g;
  float hU = simA(vUv - vec2(0.0, s)).r + simA(vUv - vec2(0.0, s)).g;
  float hD = simA(vUv + vec2(0.0, s)).r + simA(vUv + vec2(0.0, s)).g;
  vec2 grad = vec2(hR - hL, hD - hU) / (2.0 * uCell);
  vec2 wp = vWP.xz * 5.0 - flow * t * 0.6;
  vec2 rip = vec2(vnoise(wp + t * 0.3) - 0.5, vnoise(wp.yx * 1.3 - t * 0.25) - 0.5);
  vec3 n = normalize(vec3(-grad.x * 0.6 - rip.x * (0.07 + 0.3 * uRain), 1.0, -grad.y * 0.6 - rip.y * (0.07 + 0.3 * uRain)));

  vec3 V = normalize(cameraPosition - vWP);
  vec3 L = normalize(uSunDir);
  vec3 R = reflect(-V, n);
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);

  // Beer-Lambert absorption over depth
  float trans = exp(-26.0 * d);
  vec3 shallowC = lin(vec3(0.16, 0.58, 0.62));
  vec3 deepC = lin(vec3(0.02, 0.14, 0.30));
  vec3 body = mix(deepC, shallowC, trans) * (0.45 + 0.55 * max(dot(n, L), 0.0)) * (0.5 + 0.5 * uSunColor);

  vec3 sky = mix(uSkyHor, uSkyTop, clamp(R.y, 0.0, 1.0));
  vec3 col = mix(body, sky, clamp(fres * 0.55, 0.0, 1.0));
  col += uSunColor * pow(max(dot(R, L), 0.0), 220.0) * 2.5;

  // whitewater streaks along fast flow, and shoreline foam / ripples
  vec2 fdir = spd > 0.01 ? flow / spd : vec2(1.0, 0.0);
  vec2 fp = vec2(dot(vWP.xz, fdir), dot(vWP.xz, vec2(-fdir.y, fdir.x)));
  float spc = min(spd, 2.5);
  float streak = vnoise(vec2(fp.x * 2.2 - t * spc * 0.35, fp.y * 6.0));
  float foam = smoothstep(2.4, 5.0, spd) * smoothstep(0.5, 0.85, streak) * 0.7 * (1.0 - smoothstep(0.05, 0.13, d));   // whitewater only where it is shallow and fast
  float shore = 1.0 - smoothstep(0.008, 0.028, d);
  float ring = 0.5 + 0.5 * sin(d * 110.0 - t * 1.6);
  foam = clamp(foam + shore * (0.25 + 0.25 * ring), 0.0, 0.75);
  col = mix(col, vec3(0.92, 0.96, 0.98), foam * 0.6);

  float fd = length(vWP - cameraPosition);
  col = mix(col, uFogColor, 1.0 - exp(-uFogDensity * uFogDensity * fd * fd));
  float alpha = mix(0.35, 0.95, 1.0 - trans) * smoothstep(0.008, 0.022, d);
  gl_FragColor = vec4(col, max(alpha, foam * 0.6));
}
`;

export const GLSL_COMPOSITE_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// ACES filmic (Narkowicz fit) + exact sRGB encode: the only tone-map / gamma step in the pipeline.
export const GLSL_COMPOSITE_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform float uExposure;
uniform float uNear;
uniform float uFar;
uniform float uFocusDist;
uniform float uFocusY;
uniform float uBand;
uniform float uMaxBlur;
uniform vec2 uTexel;
uniform float uCA;
vec3 acesFilm(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 srgbEncode(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}
float viewDist(float d) {
  float z = d * 2.0 - 1.0;
  return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
}
// Circle of confusion: screen-space tilt-shift band combined with real view depth, so geometry sitting at the
// focal depth (peaks, spires, lanterns) stays razor sharp even inside the blurred bands.
float cocAt(vec2 uv) {
  float tilt = smoothstep(uBand, uBand + 0.30, abs(uv.y - uFocusY));
#ifdef NO_DEPTH
  return clamp(tilt, 0.0, 1.0);
#else
  float dist = viewDist(texture2D(tDepth, uv).x);
  float rel = abs(dist - uFocusDist) / uFocusDist;
  float inSlab = 1.0 - smoothstep(0.05, 0.24, rel);
  float depthBlur = smoothstep(0.30, 1.25, rel) * 0.26;
  return clamp(tilt * (1.0 - 0.93 * inSlab) + depthBlur, 0.0, 1.0);
#endif
}
void main() {
  float coc0 = cocAt(vUv);
  vec3 acc = texture2D(tColor, vUv).rgb;
  float wsum = 1.0;
  if (coc0 > 0.01) {
    vec2 px = uTexel * uMaxBlur * coc0;
    for (int i = 0; i < TAPS; i++) {
      float fi = float(i);
      float r = sqrt((fi + 0.5) / float(TAPS));
      float a = fi * 2.39996323;
      vec2 suv = vUv + vec2(cos(a), sin(a)) * r * px;
      float cs = cocAt(suv);
      float w = cs < coc0 * r ? cs / (coc0 * r + 1e-4) : 1.0;
      acc += texture2D(tColor, suv).rgb * w;
      wsum += w;
    }
  }
  vec3 c = acc / wsum;

  vec2 rc = vUv - 0.5;
  float r2 = dot(rc, rc);
  vec2 off = rc * r2 * uCA;
  c.r = mix(c.r, texture2D(tColor, vUv + off).r, 0.7);
  c.b = mix(c.b, texture2D(tColor, vUv - off).b, 0.7);

  float vig = smoothstep(0.92, 0.28, length(rc * vec2(1.0, 0.92) * 1.45));
  c *= mix(0.62, 1.0, vig) * uExposure;
  gl_FragColor = vec4(srgbEncode(acesFilm(c)), 1.0);
}
`;
