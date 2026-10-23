import { GLSL_SIM } from './glsl.js';
import { SIZE, glslF } from './scale.js';

export const GLSL_FLORA_VERT_PARS = /* glsl */`
attribute vec4 aInstanceState;
attribute vec2 aPart;
varying vec3 vFloraCol;
varying vec3 vGlow;
varying float vShade;
uniform sampler2D uSimTexC;
uniform vec4 uCloud;
uniform vec4 uBreeze;
uniform float uWind;
uniform float uNight;
${GLSL_SIM}
`;

export const GLSL_FLORA_VERT_NORMAL = /* glsl */`
  vec3 objectNormal = normalize(mix(normal, vec3(0.0, 1.0, 0.0), 0.55));
`;

// Height/flatten/drown from sim state, wind + raincloud + breeze bending, colour banding by fertility, bioluminescence.
export const GLSL_FLORA_VERT_POS = /* glsl */`
  vec3 fBase = instanceMatrix[3].xyz;
  vec2 fUv = worldToUv(fBase.xz);
  vec4 fA = simA(fUv);
  vec4 fC = fetchBil(uSimTexC, fUv);
  vShade = fC.r;
  vec4 fB = simB(fUv);
  float fert = fB.g, comp = fB.b, bias = fB.a, wat = fA.g;
  float arche = aInstanceState.x, grow = aInstanceState.y;
  float part = aPart.x, yn = aPart.y;
  // trees: the share of tufts showing a trunk + canopy follows the live biomass (scattered ~5% on open ground,
  // ~70% in old forest); the per-tuft hash decides which ones, and each tree grows in over a short biomass range
  float treeFrac = mix(0.04, 0.7, smoothstep(0.6, 0.95, fC.b));   // crops (biomass < 0.6) stay open fields
  float treeAmt = smoothstep(1.0 - treeFrac, 1.0 - treeFrac + 0.06, arche);
  float fieldF = fC.a;   // 5d-2: farmed land grows no trees, only an even golden crop
  float vis = part > 0.25 ? treeAmt * (1.0 - smoothstep(0.2, 0.4, fieldF)) : 1.0;
  // 5d-2 species by ground (spec 6.1): conifer on high or steep ground, flat-top scrub on dry ground, else broadleaf.
  // A per-tree jitter mixes them at the borders. The crown's vertices are reshaped, so the mesh does not grow.
  float sp = 0.0;   // 0 broadleaf, 1 conifer, 2 scrub
  vec3 fp = position;
  if (part > 0.25) {
    float cs = 1.0 / 128.0;
    vec2 eg = vec2(texture(uSimTexA, fUv + vec2(cs, 0.0)).r - texture(uSimTexA, fUv - vec2(cs, 0.0)).r,
                   texture(uSimTexA, fUv + vec2(0.0, cs)).r - texture(uSimTexA, fUv - vec2(0.0, cs)).r);
    float slope = length(eg) * ${glslF(128 / 40)};
    float jit = hash12(fBase.xz * 7.13) - 0.5;
    float conS = max(smoothstep(0.62, 0.78, fA.r), smoothstep(0.22, 0.45, slope)) + jit * 0.5;
    float dryS = max(smoothstep(0.48, 0.36, fB.r), smoothstep(0.55, 0.35, fert)) + jit * 0.5;
    sp = conS > 0.5 ? 1.0 : dryS > 0.5 ? 2.0 : 0.0;
    if (sp > 0.5 && sp < 1.5) {          // conifer: narrow cone, widest low down
      if (part >= 0.75) fp = yn > 0.9 ? vec3(0.0, 1.18, 0.0) : yn > 0.75 ? vec3(fp.x * 0.62, 0.34, fp.z * 0.62) : vec3(0.0, 0.24, 0.0);
    } else if (sp > 1.5) {               // flat-top scrub: wide thin crown on a taller, thinner trunk
      if (part >= 0.75) fp = yn > 0.9 ? vec3(0.0, 0.74, 0.0) : yn > 0.75 ? vec3(fp.x * 1.4, 0.66, fp.z * 1.4) : vec3(0.0, 0.6, 0.0);
      else fp = vec3(fp.x * 0.75, fp.y * 1.45, fp.z * 0.75);
    }
  }
  float hgt = mix(0.22, 1.0, smoothstep(0.08, 0.85, fert)) * grow * (1.0 - 0.8 * comp) * (0.8 + 0.5 * arche);
  if (sp > 1.5) hgt *= 0.8;
  if (part < 0.25) hgt = mix(hgt, 0.55, fieldF);
  hgt *= 1.0 - smoothstep(0.015, 0.04, wat);
  float wid = mix(0.6, 1.0, hgt);
  // blades and tree parts are sized separately (SIZE in scale.js): short grass, trees well above the cottages
  vec2 pS = part > 0.25 ? vec2(${glslF(SIZE.treeXZ)}, ${glslF(SIZE.treeY)}) : vec2(${glslF(SIZE.grassXZ)}, ${glslF(SIZE.grassY)});
  vec3 transformed = fp * vec3(wid * pS.x, hgt * pS.y, wid * pS.x) * vis;

  float t = uTime;
  float gust = 0.5 + 0.5 * sin(t * 0.7 + fBase.x * 0.35 + fBase.z * 0.21);
  float sway = sin(t * 1.9 + fBase.x * 1.3 + fBase.z * 0.9) * 0.6 + sin(t * 3.1 + fBase.z * 2.1) * 0.3;
  vec2 wv = vec2(1.0, 0.35) * uWind * (0.07 + 0.12 * gust) * sway;
  vec2 dc = fBase.xz - uCloud.xy;
  float dcl = length(dc);
  float cf = uCloud.w * (1.0 - smoothstep(0.0, uCloud.z, dcl));
  wv += (dcl > 0.001 ? dc / dcl : vec2(0.0)) * cf * 0.45 + vec2(sin(t * 17.0 + fBase.x * 5.0), cos(t * 15.0 + fBase.z * 5.0)) * cf * 0.04;
  vec2 db = fBase.xz - uBreeze.xy;
  float dbl = length(db);
  float bf = uBreeze.w * (1.0 - smoothstep(0.0, uBreeze.z, dbl));
  wv += (dbl > 0.001 ? db / dbl : vec2(0.0)) * bf * 0.5;
  vec3 wW = vec3(wv.x, 0.0, wv.y);
  vec3 wObj = vec3(dot(wW, instanceMatrix[0].xyz), 0.0, dot(wW, instanceMatrix[2].xyz));
  transformed += wObj * (yn * yn) * (hgt + 0.3);
  transformed.y += fA.r;

  vec3 ochre = lin(vec3(0.62, 0.46, 0.24));
  vec3 grain = lin(vec3(0.86, 0.72, 0.28));
  vec3 emer = lin(vec3(0.14, 0.58, 0.26));
  vec3 fc = mix(ochre, grain, smoothstep(0.22, 0.38, fert));
  fc = mix(fc, emer, smoothstep(0.48, 0.68, fert));
  if (part > 0.25 && part < 0.75) fc = lin(vec3(0.35, 0.24, 0.15));
  else if (part >= 0.75) fc = sp > 1.5 ? lin(vec3(0.46, 0.48, 0.20)) : sp > 0.5 ? lin(vec3(0.10, 0.34, 0.27)) : mix(emer, fc, 0.35);
  if (part < 0.25) fc = mix(fc, grain, fieldF);
  float hv = hash12(fBase.xz * 13.7);
  fc *= (0.82 + 0.36 * hv) * mix(0.55, 1.18, yn);
  float lum = smoothstep(0.32, 0.52, bias);
  vec3 bio = mix(vec3(0.05, 0.85, 0.95), vec3(0.62, 0.22, 1.0), hv);
  float glowAmt = lum * (0.30 + 0.70 * uNight) * (0.25 + 0.75 * yn) + aInstanceState.w * (0.4 + 0.6 * yn);
  vFloraCol = mix(fc, bio * 0.5, lum * 0.6);
  vGlow = bio * glowAmt * 1.8 + fc * 0.40 * uNight;   // moonlit scatter keeps the crops readable after dark
`;

export const GLSL_FLORA_FRAG_COLOR = /* glsl */`
  diffuseColor.rgb = vFloraCol;
`;
export const GLSL_FLORA_FRAG_EMISSIVE = /* glsl */`
  #include <emissivemap_fragment>
  totalEmissiveRadiance += vGlow;
`;

export const GLSL_FLORA_SHADE = /* glsl */`
  #include <lights_fragment_end>
  reflectedLight.directDiffuse *= vShade;
  reflectedLight.directSpecular *= vShade;
`;
