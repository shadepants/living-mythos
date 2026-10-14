// Shaders for the structure, villager and particle pools. Colours are sRGB-authored and linearised with lin().

export const GLSL_STRUCT_PARS = /* glsl */`
attribute vec4 aInstanceState;
attribute vec4 aKind;
attribute vec2 aPart;
varying vec3 vSCol;
varying vec3 vSGlow;
varying float vDecay;
varying float vPid;
varying vec3 vLocalP;
varying vec3 vLocalN;
varying vec3 vWN;
varying float vSeed;
uniform float uNight;
bool isPid(float pid, float id) { return abs(pid - id) < 0.5; }
float partVis(float pid, float kind, float wP, float wI, float wM) {
  if (isPid(pid, 0.0)) return kind < 0.5 ? 1.0 : 0.0;
  if (kind < 0.5) {
    if (isPid(pid, 1.0) || isPid(pid, 2.0) || isPid(pid, 5.0) || isPid(pid, 13.0)) return wP;
    if (isPid(pid, 11.0) || isPid(pid, 4.0) || isPid(pid, 14.0)) return wI;
    if (isPid(pid, 3.0) || isPid(pid, 10.0) || isPid(pid, 15.0)) return wM;
    return 0.0;
  }
  if (kind < 1.5) return (isPid(pid, 8.0) || isPid(pid, 17.0) || isPid(pid, 18.0) || isPid(pid, 19.0)) ? 1.0 : 0.0;
  if (kind < 2.5) return (isPid(pid, 6.0) || isPid(pid, 9.0) || isPid(pid, 20.0) || isPid(pid, 22.0)) ? 1.0 : 0.0;
  if (kind < 3.5) return isPid(pid, 7.0) ? 1.0 : 0.0;
  if (kind < 4.5) return (isPid(pid, 16.0) || isPid(pid, 21.0)) ? 1.0 : 0.0;
  return (isPid(pid, 23.0) || isPid(pid, 24.0)) ? 1.0 : 0.0;
}
vec3 partColor(float pid, float hv) {
  if (isPid(pid, 0.0)) return lin(vec3(0.46, 0.44, 0.42));
  if (isPid(pid, 1.0)) return lin(vec3(0.84, 0.73, 0.55));
  if (isPid(pid, 2.0)) return lin(vec3(0.74, 0.56, 0.24) * (0.85 + 0.3 * hv));
  if (isPid(pid, 5.0)) return lin(vec3(0.82, 0.74, 0.58));
  if (isPid(pid, 13.0)) return lin(vec3(0.38, 0.27, 0.17));
  if (isPid(pid, 11.0)) return lin(vec3(0.20, 0.20, 0.25) * (0.8 + 0.4 * hv));
  if (isPid(pid, 4.0)) return lin(vec3(0.36, 0.20, 0.16));
  if (isPid(pid, 14.0)) return lin(vec3(0.50, 0.48, 0.46));
  if (isPid(pid, 3.0)) return lin(vec3(0.56, 0.72, 0.96));
  if (isPid(pid, 10.0)) return lin(vec3(0.24, 0.24, 0.30));
  if (isPid(pid, 15.0)) return lin(vec3(0.82, 0.70, 0.38));
  if (isPid(pid, 8.0)) return lin(vec3(0.11, 0.11, 0.14));
  if (isPid(pid, 19.0)) return lin(vec3(0.18, 0.17, 0.19));
  if (isPid(pid, 17.0)) return lin(vec3(1.0, 0.78, 0.28));
  if (isPid(pid, 18.0)) return lin(vec3(0.95, 0.72, 0.25));
  if (isPid(pid, 6.0)) return lin(vec3(0.56, 0.53, 0.49));
  if (isPid(pid, 9.0)) return lin(vec3(0.52, 0.37, 0.22));
  if (isPid(pid, 20.0)) return lin(vec3(0.50, 0.48, 0.45));
  if (isPid(pid, 7.0)) return lin(vec3(0.52, 0.49, 0.45) * (0.85 + 0.3 * hv));
  if (isPid(pid, 16.0)) return lin(vec3(0.50, 0.47, 0.42) * (0.8 + 0.4 * hv));
  if (isPid(pid, 23.0)) return lin(vec3(0.30, 0.29, 0.32) * (0.85 + 0.3 * hv));
  if (isPid(pid, 24.0)) return lin(vec3(0.40, 0.38, 0.38));
  return lin(vec3(0.18, 0.16, 0.15));
}
`;

export const GLSL_STRUCT_NORMAL = /* glsl */`
  vec3 objectNormal = vec3(normal);
`;

export const GLSL_STRUCT_POS = /* glsl */`
  vec3 sBase = instanceMatrix[3].xyz;
  float kind = aKind.x;
  float slen = aKind.y;
  vec4 sB = simB(worldToUv(sBase.xz));
  float bias = mix(aInstanceState.x, sB.a, 0.75);
  float build = clamp(aInstanceState.y, 0.0, 1.0);
  float decay = aInstanceState.z;
  float lum = aInstanceState.w;
  float pid = aPart.x;
  float yn = aPart.y;
  float wI = 1.0 - smoothstep(-0.45, -0.25, bias);
  float wM = smoothstep(0.25, 0.45, bias);
  float wP = clamp(1.0 - wI - wM, 0.0, 1.0);
  float vis = partVis(pid, kind, wP, wI, wM);
  float hv = hash12(sBase.xz * 13.1 + pid);

  vec3 lp = position;
  if (kind > 1.5 && kind < 3.5) lp.x *= slen;
  else if (kind > 3.5) lp.xz *= slen / 0.7;
  if (isPid(pid, 5.0)) {
    vec2 rel = lp.xy - vec2(0.38, 0.40);
    float ang = uTime * 1.6 + hash12(sBase.xz) * 6.283;
    float cs = cos(ang), sn = sin(ang);
    lp.xy = vec2(0.38, 0.40) + vec2(rel.x * cs - rel.y * sn, rel.x * sn + rel.y * cs);
  }
  float bE = smoothstep(0.0, 1.0, build);
  lp.xz *= mix(0.75, 1.0, bE);
  lp.y *= bE;
  lp *= vis;
  if (kind < 0.5 && decay > 0.001) {
    lp.y *= 1.0 - 0.45 * decay;
    float ta = hash12(sBase.xz * 7.1) * 6.283;
    vec2 ax = vec2(cos(ta), sin(ta));
    lp.xz += ax * lp.y * decay * 0.35;
    if (isPid(pid, 2.0) || isPid(pid, 3.0)) { lp.y -= decay * 0.12; lp.xz += ax * decay * 0.1; }
    lp += (vec3(hash12(lp.xz * 31.0), hash12(lp.yz * 29.0 + 1.0), hash12(lp.xy * 27.0 + 2.0)) - 0.5) * 0.045 * decay;
  }

  vec3 dW = instanceMatrix[0].xyz;
  float sElev;
  if (kind > 1.5 && kind < 2.5) {
    float e1 = terrainH(sBase.xz - dW.xz * 0.5 * slen);
    float e2 = terrainH(sBase.xz + dW.xz * 0.5 * slen);
    sElev = mix(e1, e2, clamp(position.x + 0.5, 0.0, 1.0));
  } else if (kind > 2.5 && kind < 3.5) {
    sElev = terrainH(sBase.xz + dW.xz * (aPart.y - 0.5) * slen);
  } else if (kind > 3.5) {
    vec3 wv = (instanceMatrix * vec4(lp, 1.0)).xyz;
    sElev = terrainH(wv.xz);
  } else {
    sElev = terrainH(sBase.xz);
  }
  vec3 transformed = lp + vec3(0.0, sElev, 0.0);
  vLocalP = position;
  vLocalN = normal;
  vWN = mat3(instanceMatrix) * normal;
  vSeed = aKind.z;
  vPid = pid;
  vDecay = (kind < 0.5 || kind > 4.5) ? decay : 0.0;

  vec3 scol = partColor(pid, hv);
  vec3 sgl = vec3(0.0);
  float nightK = 0.35 + 0.65 * uNight;
  float aliveK = kind < 0.5 ? 1.0 - decay * 0.9 : 1.0;
  if (isPid(pid, 3.0)) sgl = vec3(0.30, 0.70, 1.0) * (nightK + lum) * (0.3 + 0.9 * yn);
  else if (isPid(pid, 10.0) && position.y > 0.33) sgl = vec3(0.45, 0.85, 1.0) * (0.5 + uNight * 1.5 + lum);
  else if (isPid(pid, 4.0)) sgl = vec3(1.0, 0.42, 0.10) * (0.5 + uNight * 1.2) * smoothstep(0.7, 1.0, yn * 1.1);
  else if (isPid(pid, 17.0) || isPid(pid, 18.0)) sgl = vec3(1.0, 0.72, 0.22) * (0.6 + uNight * 1.4 + lum);
  else if ((isPid(pid, 21.0) && position.y > 0.33) || isPid(pid, 22.0)) sgl = vec3(1.0, 0.62, 0.22) * (0.4 + uNight * 2.0);
  sgl *= aliveK;
  if (kind < 0.5) sgl += lum * 0.25 * scol * vis;
  vSCol = scol;
  vSGlow = sgl * vis;
`;

export const GLSL_STRUCT_FRAG_PARS = /* glsl */`
varying vec3 vSCol;
varying vec3 vSGlow;
varying float vDecay;
varying float vPid;
varying vec3 vLocalP;
varying vec3 vLocalN;
varying vec3 vWN;
varying float vSeed;
uniform float uNight;
`;

export const GLSL_STRUCT_FRAG_COLOR = /* glsl */`
  diffuseColor.rgb = vSCol;
  vec3 nrmS = normalize(vWN);
  vec3 nrmL = normalize(vLocalN);
  float mossN = vnoise(vLocalP.xz * 18.0 + vLocalP.y * 9.0);
  float moss = vDecay * smoothstep(0.15, 0.8, mossN * 0.75 + (1.0 - clamp(vLocalP.y / 0.6, 0.0, 1.0)) * 0.35 + nrmS.y * 0.2);
  diffuseColor.rgb = mix(diffuseColor.rgb, lin(vec3(0.20, 0.36, 0.13)), moss * 0.85);
  float winS = 0.0;
  if (abs(vPid - 1.0) < 0.5) winS = step(abs(fract(vLocalP.x * 7.0 + 0.5) - 0.5), 0.16) * step(abs(vLocalP.y - 0.2), 0.05) * step(0.4, abs(nrmL.z) + abs(nrmL.x));
  else if (abs(vPid - 11.0) < 0.5) winS = step(abs(fract(vLocalP.x * 5.0 + 0.5) - 0.5), 0.08) * step(abs(fract(vLocalP.y * 10.0) - 0.5), 0.12) * 0.5;
  float winGlow = winS * (1.0 - vDecay);

  // carved myth glyph: ring, optional inner ring, spokes and a core, seeded per myth
  vec3 glyphGlow = vec3(0.0);
  if (abs(vPid - 23.0) < 0.5) {
    vec2 gq = (vLocalP.xy - vec2(0.0, 0.30)) / 0.10;
    float gr = length(gq);
    float ga = atan(gq.y, gq.x);
    float nSp = floor(3.0 + vSeed * 5.0);
    float ring1 = smoothstep(0.09, 0.0, abs(gr - 0.9));
    float ring2 = smoothstep(0.09, 0.0, abs(gr - 0.45)) * step(0.5, fract(vSeed * 7.0));
    float spokes = smoothstep(0.14, 0.0, abs(sin(ga * nSp))) * step(0.45, gr) * step(gr, 0.95);
    float core = smoothstep(0.22, 0.12, gr);
    float glyph = clamp(ring1 + ring2 + spokes * 0.8 + core, 0.0, 1.0) * step(abs(gq.x), 1.15) * step(abs(gq.y), 1.5) * step(0.5, vLocalN.z);
    diffuseColor.rgb *= 1.0 - 0.45 * glyph;
    vec3 gcol = mix(vec3(1.0, 0.75, 0.30), vec3(0.40, 0.95, 1.0), fract(vSeed * 3.7));
    glyphGlow = gcol * glyph * (0.7 + uNight * 1.6) * (1.0 - 0.8 * vDecay);
  }
`;

export const GLSL_STRUCT_FRAG_EMISSIVE = /* glsl */`
  #include <emissivemap_fragment>
  totalEmissiveRadiance += vSGlow + glyphGlow + vec3(1.0, 0.62, 0.26) * winGlow * (0.12 + uNight * 1.6);
`;

// ---------------- villagers ----------------
export const GLSL_VILL_PARS = /* glsl */`
attribute vec4 aInstanceState;
attribute vec2 aPart;
varying vec3 vVCol;
varying vec3 vVGlow;
uniform float uNight;
vec3 lin2(vec3 c) { return pow(c, vec3(2.2)); }
`;

export const GLSL_VILL_POS = /* glsl */`
  float role = aInstanceState.x;
  float cargo = aInstanceState.y;
  float phase = aInstanceState.z;
  float lant = aInstanceState.w;
  float vpid = aPart.x;
  float vyn = aPart.y;
  vec3 lp = position;
  lp.x += sin(phase) * 0.05 * vyn;
  if (abs(vpid - 3.0) < 0.5) {
    vec3 pivot = vec3(0.0, 0.17, -0.09);
    lp = pivot + (lp - pivot) * clamp(cargo * 1.5, 0.0, 1.0);
  }
  vec3 transformed = lp;
  vec3 cloakC = role < 0.5 ? vec3(0.36, 0.50, 0.24) : role < 1.5 ? vec3(0.62, 0.46, 0.26) : role < 2.5 ? vec3(0.34, 0.42, 0.58) : vec3(0.50, 0.30, 0.66);
  vec3 vc = cloakC * (0.8 + 0.3 * vyn);
  vec3 vg = vec3(0.0);
  if (abs(vpid - 1.0) < 0.5) vc = vec3(0.86, 0.70, 0.56);
  else if (abs(vpid - 2.0) < 0.5) vc = cloakC * 0.7;
  else if (abs(vpid - 3.0) < 0.5) vc = vec3(0.55, 0.40, 0.22);
  else if (abs(vpid - 5.0) < 0.5) vc = vec3(0.20, 0.15, 0.10);
  else if (abs(vpid - 4.0) < 0.5) { vc = vec3(1.0, 0.8, 0.4); vg = vec3(1.0, 0.66, 0.24) * (0.25 + clamp(uNight * 1.4 + lant, 0.0, 2.0) * 1.8); }
  vVCol = lin2(vc);
  vVGlow = vg;
`;

export const GLSL_VILL_FRAG_COLOR = /* glsl */`
  diffuseColor.rgb = vVCol;
`;
export const GLSL_VILL_FRAG_EMISSIVE = /* glsl */`
  #include <emissivemap_fragment>
  totalEmissiveRadiance += vVGlow;
`;

// ---------------- particles ----------------
export const GLSL_PART_VERT = /* glsl */`
attribute vec4 aInstanceState;
attribute vec4 aVel;
varying float vType;
varying float vLife;
varying float vAux;
varying vec3 vN;
void main() {
  float type = aInstanceState.x;
  float lf = aInstanceState.y;
  float size = aInstanceState.z;
  float aux = aInstanceState.w;
  vec3 c = instanceMatrix[3].xyz;
  vec3 vel = aVel.xyz;
  float spin = aVel.w;
  float sp = length(vel);
  vec3 dir = sp > 0.02 ? vel / sp : vec3(0.0, 1.0, 0.0);
  float stretch = 1.0;
  float s = size;
  if (type < 0.5) { if (aux > 0.5) s *= 1.0 + lf * 2.0; else stretch = 2.5; }
  else if (type < 1.5) stretch = 16.0;
  else if (type < 2.5) { if (aux > 0.5) s *= 1.0 + lf * 1.6; else stretch = 1.7; }
  else if (type > 3.5) stretch = 1.35;
  vec3 helper = abs(dir.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 r = normalize(cross(helper, dir));
  vec3 f = cross(dir, r);
  vec3 p = position * s;
  if (type > 2.5 && type < 3.5) {
    float cs = cos(spin), sn = sin(spin);
    p = vec3(p.x * cs - p.z * sn, p.y, p.x * sn + p.z * cs);
    p = vec3(p.x, p.y * cs - p.z * sn * 0.5, p.z * cs + p.y * sn * 0.5);
  }
  vec3 wp = c + r * p.x + dir * p.y * stretch + f * p.z;
  vN = normalize(position);
  vType = type; vLife = lf; vAux = aux;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

export const GLSL_PART_FRAG = /* glsl */`
precision highp float;
varying float vType;
varying float vLife;
varying float vAux;
varying vec3 vN;
uniform float uTime;
void main() {
  float lf = vLife;
  float fade = smoothstep(0.0, 0.08, lf) * (1.0 - smoothstep(0.6, 1.0, lf));
  vec3 col;
  float a;
  float glowK = 1.0;
  if (vType < 0.5) {
    if (vAux > 0.5) { col = vec3(0.85, 0.90, 0.96); a = 0.16 * fade; }
    else { col = vec3(0.88, 0.95, 1.0); a = 0.55 * fade; }
  } else if (vType < 1.5) {
    col = vec3(0.72, 0.82, 0.96); a = 0.40 * fade;
  } else if (vType < 2.5) {
    if (vAux > 0.5) { col = vec3(0.78, 0.72, 0.62); a = 0.30 * fade; }
    else { col = vec3(1.0, 0.50, 0.14) * 3.0; a = 0.9 * fade; glowK = 0.25; }
  } else if (vType < 3.5) {
    float sh = 0.35 + 0.65 * max(dot(vN, normalize(vec3(0.4, 0.8, 0.3))), 0.0);
    col = vec3(0.36, 0.33, 0.31) * sh; a = 1.0 - smoothstep(0.8, 1.0, lf);
  } else {
    float fl = 0.8 + 0.2 * sin(uTime * 9.0 + vAux * 30.0);
    col = vec3(1.0, 0.68, 0.28) * 2.6 * fl; a = 0.9 * fade; glowK = 0.25;
  }
  gl_FragColor = vec4(col * a, a * glowK);
}
`;
