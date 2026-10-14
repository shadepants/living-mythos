// Capability detection. Never throws; returns flags the renderer uses to pick fallbacks (spec 2.2).
export function detectCaps(renderer) {
  const gl = renderer.getContext();
  const isGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
  const floatLinear = !!gl.getExtension('OES_texture_float_linear');
  const colorBufferFloat = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
  return {
    webgl2: isGL2,
    floatLinear,
    halfFloatTarget: colorBufferFloat,
    depthTexture: isGL2,
    maxTexSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
  };
}
