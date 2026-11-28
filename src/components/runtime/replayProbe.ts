import type { Object3D, PerspectiveCamera, WebGLRenderer } from 'three';
import type { FpsDropLogger, PerfReportEntry } from '../../game/perfLogger';
import type { TerrainChunkManager } from '../../world/terrainChunkManager';

interface RenderQueries {
  reflection: WebGLQuery;
  main: WebGLQuery;
  elapsedMs: number;
  reflected: boolean;
}

// Installed only for a measured replay leg. Query results are read asynchronously.
export class ReplayProbe {
  readonly reports: PerfReportEntry[] = [];
  readonly events: Array<{ elapsedMs: number; label: string }> = [];
  readonly startMs = performance.now();
  readonly builds: Array<{ elapsedMs: number; key: string; source: string; buildMs: number; vertices: number }> = [];
  readonly gpu: Array<{ elapsedMs: number; reflected: boolean; reflectionGpuMs: number; mainGpuMs: number; renderGpuMs: number }> = [];
  readonly shaderEvents: Array<{ elapsedMs: number; operation: string; wallMs: number }> = [];
  private restoreShaderCalls: () => void;
  private readonly gl: WebGL2RenderingContext;
  private readonly timer: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private queries: RenderQueries[] = [];
  private active: RenderQueries | null = null;
  private restoreDraw: () => void;
  private calls = 0;
  private triangles = 0;
  private submitMs = 0;

  constructor(renderer: WebGLRenderer, camera: PerspectiveCamera, foliage: Object3D,
    private terrain: TerrainChunkManager, private logger: FpsDropLogger) {
    logger.onRecordedEvent = (label, now) => this.events.push({ elapsedMs: now - this.startMs, label });
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    const gl = this.gl;
    const compile = gl.compileShader, link = gl.linkProgram;
    const measure = (operation: string, start: number) => {
      this.shaderEvents.push({ elapsedMs: start - this.startMs, operation, wallMs: performance.now() - start });
    };
    gl.compileShader = shader => {
      const start = performance.now();
      compile.call(gl, shader);
      measure('compileShader', start);
    };
    gl.linkProgram = program => {
      const start = performance.now();
      link.call(gl, program);
      measure('linkProgram', start);
    };
    this.restoreShaderCalls = () => { gl.compileShader = compile; gl.linkProgram = link; };
    this.timer = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.terrain.onMeasuredBuild = (key, source, buildMs, vertices) => {
      this.builds.push({ elapsedMs: performance.now() - this.startMs, key, source, buildMs, vertices });
    };
    const draw = renderer.renderBufferDirect;
    const foliageObjects = new WeakSet<Object3D>();
    foliage.traverse(object => foliageObjects.add(object));
    renderer.renderBufferDirect = (view, scene, geometry, material, object, group) => {
      if (view !== camera || !foliageObjects.has(object)) {
        return draw.call(renderer, view, scene, geometry, material, object, group);
      }
      const info = renderer.info.render;
      const callsBefore = info.calls;
      const trianglesBefore = info.triangles;
      const start = performance.now();
      draw.call(renderer, view, scene, geometry, material, object, group);
      this.submitMs += performance.now() - start;
      this.calls += info.calls - callsBefore;
      this.triangles += info.triangles - trianglesBefore;
    };
    this.restoreDraw = () => { renderer.renderBufferDirect = draw; };
  }

  beginRender(frameStart: number) {
    this.calls = this.triangles = this.submitMs = 0;
    if (!this.timer) return;
    const gl = this.gl;
    if (gl.getParameter(this.timer.GPU_DISJOINT_EXT)) {
      this.releaseQueries();
      return;
    }
    while (this.queries.length) {
      const { main, reflection, elapsedMs, reflected } = this.queries[0];
      if (!gl.getQueryParameter(main, gl.QUERY_RESULT_AVAILABLE) ||
          !gl.getQueryParameter(reflection, gl.QUERY_RESULT_AVAILABLE)) break;
      const mainGpuMs = gl.getQueryParameter(main, gl.QUERY_RESULT) / 1e6;
      const reflectionGpuMs = reflected ? gl.getQueryParameter(reflection, gl.QUERY_RESULT) / 1e6 : 0;
      this.gpu.push({ elapsedMs, reflected, mainGpuMs, reflectionGpuMs, renderGpuMs: mainGpuMs + reflectionGpuMs });
      this.queries.shift();
      gl.deleteQuery(main);
      gl.deleteQuery(reflection);
    }
    if (this.queries.length >= 16) return;
    const main = gl.createQuery(), reflection = gl.createQuery();
    if (!main || !reflection) {
      gl.deleteQuery(main);
      gl.deleteQuery(reflection);
      return;
    }
    this.active = { main, reflection, elapsedMs: frameStart - this.startMs, reflected: false };
    this.queries.push(this.active);
    gl.beginQuery(this.timer.TIME_ELAPSED_EXT, reflection);
  }

  beginMainRender(reflected: boolean) {
    if (!this.active) return;
    this.active.reflected = reflected;
    this.gl.endQuery(this.timer!.TIME_ELAPSED_EXT);
    this.gl.beginQuery(this.timer!.TIME_ELAPSED_EXT, this.active.main);
  }

  endRender() {
    if (this.active) this.gl.endQuery(this.timer!.TIME_ELAPSED_EXT);
    this.active = null;
  }

  private releaseQueries() {
    for (const { main, reflection } of this.queries) {
      this.gl.deleteQuery(main);
      this.gl.deleteQuery(reflection);
    }
    this.queries.length = 0;
  }

  drawStats() {
    return { foliageDrawCalls: this.calls, foliageDrawTriangles: this.triangles, foliageSubmitMs: this.submitMs };
  }

  finish() {
    this.logger.onRecordedEvent = undefined;
    this.terrain.onMeasuredBuild = undefined;
    this.restoreDraw();
    this.restoreShaderCalls();
    this.endRender();
    this.releaseQueries();
    return {
      builds: this.builds, shaderEvents: this.shaderEvents, events: this.events, reports: this.reports,
      gpu: this.gpu, gpuTimerSupported: Boolean(this.timer), startMs: this.startMs,
    };
  }
}
