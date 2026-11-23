/**
 * The only module that constructs WebGLRenderer, touches the canvas or
 * registers DOM listeners (SEC-P-04). Excluded from the coverage gate and
 * covered by the documented manual browser check (README, "Renderer").
 */
import {
  ACESFilmicToneMapping,
  PCFShadowMap,
  SRGBColorSpace,
  WebGLRenderer,
  type Camera,
  type Object3D,
} from 'three';
import type { GlHost } from './types';

const CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  antialias: true,
  powerPreference: 'high-performance',
  alpha: false,
  stencil: false,
  failIfMajorPerformanceCaveat: false,
};

/** Returns null when WebGL2 is unavailable; never throws. */
export function createGlHost(canvas: HTMLCanvasElement): GlHost | null {
  let gl: WebGLRenderer;
  try {
    const context = canvas.getContext('webgl2', CONTEXT_ATTRIBUTES);
    if (context === null) return null;
    gl = new WebGLRenderer({ canvas, context, antialias: true });
  } catch {
    return null;
  }
  gl.outputColorSpace = SRGBColorSpace;
  gl.toneMapping = ACESFilmicToneMapping;
  gl.autoClear = false;
  gl.shadowMap.enabled = true;
  gl.shadowMap.type = PCFShadowMap;

  const listen = (type: string, cb: () => void, prevent: boolean): (() => void) => {
    const handler = (event: Event): void => {
      if (prevent) event.preventDefault();
      cb();
    };
    canvas.addEventListener(type, handler, false);
    return () => {
      canvas.removeEventListener(type, handler, false);
    };
  };

  return {
    capabilities: {
      maxTextureSize: gl.capabilities.maxTextureSize,
      maxAnisotropy: gl.capabilities.getMaxAnisotropy(),
    },
    devicePixelRatio() {
      const dpr = canvas.ownerDocument.defaultView?.devicePixelRatio ?? 1;
      return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    },
    setPixelRatio(ratio) {
      gl.setPixelRatio(ratio);
    },
    setSize(w, h) {
      gl.setSize(w, h, false);
    },
    clear() {
      gl.clear(true, true, false);
    },
    clearDepth() {
      gl.clearDepth();
    },
    render(scene: Object3D, camera: Camera) {
      gl.render(scene, camera);
    },
    compileAsync(scene: Object3D, camera: Camera) {
      return gl.compileAsync(scene, camera);
    },
    onContextLost(cb) {
      return listen('webglcontextlost', cb, true);
    },
    onContextRestored(cb) {
      return listen('webglcontextrestored', cb, false);
    },
    bindKit(kit) {
      kit.bind({ renderer: gl });
    },
    setExposure(x) {
      gl.toneMappingExposure = Number.isFinite(x) && x > 0 ? x : 1;
    },
    dispose() {
      gl.dispose();
    },
  };
}
