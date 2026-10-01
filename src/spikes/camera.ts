import type { GrayImage } from "./aruco/detect";

/**
 * Reads the WebXR raw camera image (camera-access) into a downscaled grayscale
 * buffer: draws the camera texture to a small framebuffer with a shader and
 * calls readPixels. The caller must renderer.resetState() afterwards so three.js
 * re-syncs the GL state we touched.
 */
export class CameraReader {
  private binding: XRWebGLBinding;
  private prog: WebGLProgram;
  private fbo: WebGLFramebuffer;
  private tex: WebGLTexture;
  private vao: WebGLVertexArrayObject;
  /** Flip the vertical orientation of the readback (some UAs deliver the camera texture top-down). */
  flipY = false;
  private w = 0;
  private h = 0;
  private rgba = new Uint8Array(0);
  private gray = new Uint8Array(0);

  constructor(
    private gl: WebGL2RenderingContext,
    session: XRSession,
    private maxWidth = 640,
  ) {
    this.binding = new XRWebGLBinding(session, gl);
    const vs = `#version 300 es
      out vec2 uv;
      void main(){ vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2); uv = p; gl_Position = vec4(p*2.0-1.0, 0.0, 1.0); }`;
    // Output is flipped vertically so row 0 of the readback is the TOP of the camera image.
    const fs = `#version 300 es
      precision mediump float;
      uniform sampler2D img; in vec2 uv; out vec4 o;
      void main(){ vec3 c = texture(img, vec2(uv.x, uv.y)).rgb; float g = dot(c, vec3(0.299, 0.587, 0.114)); o = vec4(g, g, g, 1.0); }`;
    this.prog = this.link(vs, fs);
    this.fbo = gl.createFramebuffer()!;
    this.tex = gl.createTexture()!;
    this.vao = gl.createVertexArray()!;
  }

  private link(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const mk = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader error");
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link error");
    return p;
  }

  /** Returns null when the view has no camera image this frame. */
  read(view: XRView): { image: GrayImage; camW: number; camH: number } | null {
    const cam = view.camera;
    if (!cam) return null;
    const gl = this.gl;
    const camW = cam.width;
    const camH = cam.height;
    const scale = Math.min(1, this.maxWidth / camW);
    const w = Math.round(camW * scale);
    const h = Math.round(camH * scale);
    const src = this.binding.getCameraImage(cam);

    if (w !== this.w || h !== this.h) {
      this.w = w;
      this.h = h;
      this.rgba = new Uint8Array(w * h * 4);
      this.gray = new Uint8Array(w * h);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.SCISSOR_TEST);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.uniform1i(gl.getUniformLocation(this.prog, "img"), 0);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, this.rgba);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);

    // GL rows start at the bottom. Assuming the camera texture is bottom-up (v=0 = image bottom), flip to top-down.
    for (let y = 0; y < h; y++) {
      const srcRow = (this.flipY ? y : h - 1 - y) * w * 4;
      const dst = y * w;
      for (let x = 0; x < w; x++) this.gray[dst + x] = this.rgba[srcRow + x * 4]!;
    }
    return { image: { data: this.gray, width: w, height: h }, camW, camH };
  }
}
