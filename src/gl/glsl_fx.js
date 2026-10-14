import { GLSL_SIM, GLSL_TERRAIN_HEIGHT } from './glsl.js';

// In-world cursor: a disc grid draped over the heightfield, drawn as a ring + aura + rotating ticks.
export const GLSL_CURSOR_VERT = /* glsl */`
varying vec2 vLocal;
uniform vec4 uCursor;
${GLSL_SIM}
${GLSL_TERRAIN_HEIGHT}
void main() {
  vLocal = position.xz;
  vec2 p = uCursor.xz + position.xz * uCursor.w;
  float h = terrainH(p) + 0.06;
  gl_Position = projectionMatrix * viewMatrix * vec4(p.x, h, p.y, 1.0);
}
`;

export const GLSL_CURSOR_FRAG = /* glsl */`
precision highp float;
varying vec2 vLocal;
uniform vec3 uCursorCol;
uniform float uCursorA;
uniform float uTime;
void main() {
  float r = length(vLocal);
  if (r > 1.0) discard;
  float ring = smoothstep(0.82, 0.9, r) * (1.0 - smoothstep(0.94, 1.0, r));
  float pulse = 0.5 + 0.5 * sin(uTime * 4.0 - r * 8.0);
  float aura = exp(-r * r * 2.5) * 0.22;
  float ticks = step(0.5, fract(atan(vLocal.y, vLocal.x) * 3.8197 + uTime * 0.1)) * smoothstep(0.55, 0.6, r) * (1.0 - smoothstep(0.64, 0.7, r)) * 0.35;
  vec3 c = uCursorCol;
  float a = (ring + aura + ticks * (0.6 + 0.4 * pulse)) * uCursorA;
  gl_FragColor = vec4(c * (ring * 1.6 + aura + ticks), a);
}
`;
