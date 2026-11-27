import * as THREE from 'three';

export interface FadeUniformPair {
  start: { value: number };
  end: { value: number };
}

export interface WindUniformSet {
  time: { value: number };
  strength: { value: number };
  dir: { value: THREE.Vector2 };
  sunDir: { value: THREE.Vector3 };
  sunColor: { value: THREE.Color };
}

export interface WindShaderOpts {
  bendStart: number;
  bendSpan: number;
  bendAmp: number;
  leafAmp: number;
  leafFreq: number;
  sssStrength?: number;
  fade?: FadeUniformPair;
  lodIn?: FadeUniformPair;
  heightFadeScale?: number;
}

function buildDistFadeFragSnippet(hasFade: boolean, hasLodIn: boolean): string {
  const condParts: string[] = [];
  if (hasFade) condParts.push('vDistFade < 0.999');
  if (hasLodIn) condParts.push('vLodIn < 0.999');
  const checks: string[] = [];
  if (hasLodIn) {
    checks.push('if (vLodIn < 0.999 && (vLodIn <= 0.002 || fadeNoise > vLodIn)) discard;');
  }
  if (hasFade) {
    checks.push('if (vDistFade < 0.999 && (vDistFade <= 0.002 || fadeNoise > vDistFade)) discard;');
  }
  return `if (${condParts.join(' || ')}) {
  float fadeNoise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  ${checks.join('\n  ')}
}
`;
}

export function addDistanceFade(
  mat: THREE.MeshLambertMaterial | THREE.MeshStandardMaterial,
  fade?: FadeUniformPair,
  lodIn?: FadeUniformPair
): void {
  if (!fade && !lodIn) return;
  const hasFade = Boolean(fade);
  const hasLodIn = Boolean(lodIn);
  const fragSnippet = buildDistFadeFragSnippet(hasFade, hasLodIn);
  mat.customProgramCacheKey = () => `dist_fade_v2_${hasFade ? 1 : 0}_${hasLodIn ? 1 : 0}`;
  mat.onBeforeCompile = (shader) => {
    if (fade) {
      shader.uniforms.uFadeStart = fade.start;
      shader.uniforms.uFadeEnd = fade.end;
    }
    if (lodIn) {
      shader.uniforms.uInStart = lodIn.start;
      shader.uniforms.uInEnd = lodIn.end;
    }

    const vertHeader =
      (fade ? `uniform float uFadeStart;\nuniform float uFadeEnd;\nvarying float vDistFade;\n` : '') +
      (lodIn ? `uniform float uInStart;\nuniform float uInEnd;\nvarying float vLodIn;\n` : '');
    const fragHeader =
      (fade ? `varying float vDistFade;\n` : '') +
      (lodIn ? `varying float vLodIn;\n` : '');

    shader.vertexShader =
      vertHeader +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec4 fadeOriginWorld = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          vec2 fadePosXZ = fadeOriginWorld.xz;
        #else
          vec2 fadePosXZ = (modelMatrix * vec4(transformed, 1.0)).xz;
        #endif
        float fadeCamDist = length(fadePosXZ - cameraPosition.xz);
        ${fade ? 'vDistFade = 1.0 - smoothstep(uFadeStart, max(uFadeStart + 1.0, uFadeEnd), fadeCamDist);' : ''}
        ${lodIn ? 'vLodIn = smoothstep(uInStart, max(uInStart + 1.0, uInEnd), fadeCamDist);' : ''}
        `
      );

    shader.fragmentShader =
      fragHeader +
      shader.fragmentShader.replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>\n${fragSnippet}`
      );
  };
}

export function addWindSway(
  mat: THREE.MeshLambertMaterial | THREE.MeshStandardMaterial,
  uniforms: WindUniformSet,
  opts: WindShaderOpts
): void {
  const sss = opts.sssStrength ?? 0;
  const hasFade = opts.fade ? 1 : 0;
  const hasLodIn = opts.lodIn ? 1 : 0;
  const hasDistTest = hasFade || hasLodIn ? 1 : 0;
  const heightFadeScale = opts.heightFadeScale ?? 0;
  const cacheKey = `wind_sss_${opts.bendStart}_${opts.bendSpan}_${opts.bendAmp}_${opts.leafAmp}_${opts.leafFreq}_${sss}_fade_${hasFade}_in_${hasLodIn}_hf_${heightFadeScale}`;
  mat.customProgramCacheKey = () => cacheKey;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = uniforms.time;
    shader.uniforms.uWindStrength = uniforms.strength;
    shader.uniforms.uWindDir = uniforms.dir;
    shader.uniforms.uSssSunDir = uniforms.sunDir;
    shader.uniforms.uSssSunColor = uniforms.sunColor;
    if (opts.fade) {
      shader.uniforms.uFadeStart = opts.fade.start;
      shader.uniforms.uFadeEnd = opts.fade.end;
    }
    if (opts.lodIn) {
      shader.uniforms.uInStart = opts.lodIn.start;
      shader.uniforms.uInEnd = opts.lodIn.end;
    }

    shader.vertexShader =
      `uniform float uWindTime;\nuniform float uWindStrength;\nuniform vec2 uWindDir;\n` +
      (opts.fade
        ? `uniform float uFadeStart;\nuniform float uFadeEnd;\nvarying float vDistFade;\n`
        : '') +
      (opts.lodIn
        ? `uniform float uInStart;\nuniform float uInEnd;\nvarying float vLodIn;\n`
        : '') +
      (sss > 0
        ? `uniform vec3 uSssSunDir;\nuniform vec3 uSssSunColor;\nvarying vec3 vSssAdd;\n`
        : '') +
      shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec4 instOriginWorld = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec2 wPosXZ = instOriginWorld.xz;
      #else
        vec2 wPosXZ = (modelMatrix * vec4(transformed, 1.0)).xz;
      #endif
      #if ${hasDistTest}
        float fadeCamDist = length(wPosXZ - cameraPosition.xz);
        #if ${hasFade}
          vDistFade = 1.0 - smoothstep(uFadeStart, max(uFadeStart + 1.0, uFadeEnd), fadeCamDist);
          #if ${heightFadeScale > 0 ? 1 : 0}
            transformed.y *= mix(${heightFadeScale.toFixed(3)}, 1.0, vDistFade);
          #endif
        #endif
        #if ${hasLodIn}
          vLodIn = smoothstep(uInStart, max(uInStart + 1.0, uInEnd), fadeCamDist);
        #endif
      #endif
      float instSeed = wPosXZ.x * 0.31 + wPosXZ.y * 0.47;

      float gustCoord = dot(wPosXZ, uWindDir) * 0.14 - uWindTime * 1.95;
      float gustWave = 0.58 + 0.42 * sin(gustCoord) + 0.22 * sin(gustCoord * 2.1 + 1.3);
      float hNorm = clamp((position.y - ${opts.bendStart.toFixed(3)}) / ${Math.max(0.1, opts.bendSpan).toFixed(3)}, 0.0, 1.5);
      float bendCurve = pow(hNorm, 1.55);
      float trunkOsc = 0.42 + 0.58 * sin(uWindTime * 1.45 + instSeed * 0.8 + gustCoord * 0.4);
      vec2 primarySway = uWindDir * (${opts.bendAmp.toFixed(3)} * bendCurve * gustWave * trunkOsc * uWindStrength);
      vec2 perpDir = vec2(-uWindDir.y, uWindDir.x);
      primarySway += perpDir * (${(opts.bendAmp * 0.32).toFixed(3)} * bendCurve * cos(uWindTime * 1.15 + instSeed) * uWindStrength);

      transformed.x += primarySway.x;
      transformed.z += primarySway.y;

      #if ${opts.leafAmp > 0 ? 1 : 0}
        float leafMask = smoothstep(${Math.max(0.0, opts.bendStart * 0.5).toFixed(3)}, ${(opts.bendStart + opts.bendSpan * 0.35).toFixed(3)}, position.y);
        float phase = uWindTime * ${opts.leafFreq.toFixed(2)} + position.x * 1.9 + position.y * 1.4 + position.z * 2.1 + instSeed;
        float flutter = sin(phase) * ${opts.leafAmp.toFixed(3)} * leafMask * uWindStrength;
        transformed.x += flutter;
        transformed.y += cos(phase * 1.18) * ${(opts.leafAmp * 0.48).toFixed(3)} * leafMask * uWindStrength;
        transformed.z += sin(phase * 0.85 + 1.1) * ${(opts.leafAmp * 0.85).toFixed(3)} * leafMask * uWindStrength;
      #endif
      `
    );

    if (opts.fade || opts.lodIn) {
      const fragHeader =
        (opts.fade ? `varying float vDistFade;\n` : '') +
        (opts.lodIn ? `varying float vLodIn;\n` : '');
      const fragSnippet = buildDistFadeFragSnippet(Boolean(opts.fade), Boolean(opts.lodIn));
      shader.fragmentShader =
        fragHeader +
        shader.fragmentShader.replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>\n${fragSnippet}`
        );
    }

    if (sss > 0) {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vec4 sssWp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          sssWp = instanceMatrix * sssWp;
        #endif
        vec3 sssWorldPos = (modelMatrix * sssWp).xyz;
        vec3 sssViewDir = normalize(cameraPosition - sssWorldPos);
        float sssAlign = max(dot(sssViewDir, -uSssSunDir), 0.0);
        float sssDay = smoothstep(0.02, 0.26, uSssSunDir.y);
        float sssBack = (sssAlign * sssAlign) * ${sss.toFixed(3)} * sssDay;
        float sssWrap = ${(sss * 0.26).toFixed(3)} * sssDay;
        vSssAdd = uSssSunColor * (sssBack + sssWrap) * vec3(1.14, 1.2, 0.72) + vec3(0.09, 0.13, 0.14) * sssDay;`
      );

      shader.fragmentShader =
        `varying vec3 vSssAdd;\n` +
        shader.fragmentShader.replace(
          '#include <opaque_fragment>',
          `outgoingLight += diffuseColor.rgb * vSssAdd;
          #include <opaque_fragment>`
        );
    }
  };
}

export function composeMaterialShader(
  mat: THREE.MeshLambertMaterial | THREE.MeshStandardMaterial,
  keySuffix: string,
  hook: (shader: THREE.WebGLProgramParametersWithUniforms) => void
): void {
  const prevCompile = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.customProgramCacheKey = () => `${prevKey ? prevKey.call(mat) : 'base'}_${keySuffix}`;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prevCompile) prevCompile.call(mat, shader, renderer);
    hook(shader);
  };
}

export function addDualBarkBlend(
  mat: THREE.MeshLambertMaterial | THREE.MeshStandardMaterial,
  altTex: THREE.Texture,
  opts: {
    id: string;
    yLow: number;
    yHigh: number;
    noiseAmp: number;
    invert?: boolean;
    uvScaleX?: number;
    uvScaleY?: number;
  }
): void {
  const invert = opts.invert ? 1.0 : 0.0;
  const uvSX = opts.uvScaleX ?? 1.0;
  const uvSY = opts.uvScaleY ?? 1.0;
  composeMaterialShader(mat, `dualbark_${opts.id}`, (shader) => {
    shader.uniforms.uAltBarkTex = { value: altTex };
    shader.vertexShader =
      `varying vec3 vBarkLocalPos;\nvarying vec2 vBarkRawUv;\n` +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vBarkLocalPos = position;
        vBarkRawUv = uv;`
      );
    shader.fragmentShader =
      `uniform sampler2D uAltBarkTex;\nvarying vec3 vBarkLocalPos;\nvarying vec2 vBarkRawUv;\n` +
      shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        #ifdef USE_MAP
          float barkNoise = sin(vBarkLocalPos.x * 13.0 + vBarkLocalPos.z * 11.0 + vBarkLocalPos.y * 1.6) * 0.55
                          + cos(vBarkLocalPos.x * 27.0 - vBarkLocalPos.z * 21.0 + vBarkLocalPos.y * 3.1) * 0.25;
          float barkT = smoothstep(${opts.yLow.toFixed(3)}, ${opts.yHigh.toFixed(3)}, vBarkLocalPos.y + barkNoise * ${opts.noiseAmp.toFixed(3)});
          float altW = ${invert > 0.5 ? '(1.0 - barkT)' : 'barkT'};
          if (altW > 0.01) {
            vec3 altCol = texture2D(uAltBarkTex, vBarkRawUv * vec2(${uvSX.toFixed(2)}, ${uvSY.toFixed(2)})).rgb;
            diffuseColor.rgb = mix(diffuseColor.rgb, altCol, altW);
          }
        #endif`
      );
  });
}

export function addBoulderMossLichenShader(
  mat: THREE.MeshStandardMaterial,
  mossTex: THREE.Texture,
  lichenTex: THREE.Texture
): void {
  composeMaterialShader(mat, 'glacial_moss_lichen_v1', (shader) => {
    shader.uniforms.uRockMossTex = { value: mossTex };
    shader.uniforms.uRockLichenTex = { value: lichenTex };

    shader.vertexShader =
      `varying vec3 vRockWorldPos;\nvarying vec3 vRockWorldNorm;\nvarying float vRockLocalY;\nvarying float vRockSeed;\n` +
      shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vRockLocalY = position.y;
        #ifdef USE_INSTANCING
          vec4 rockWp = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
          vec3 rockInstOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          vRockSeed = fract(sin(dot(rockInstOrigin.xz, vec2(12.9898, 78.233))) * 43758.5453);
          vRockWorldNorm = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
        #else
          vec4 rockWp = modelMatrix * vec4(transformed, 1.0);
          vRockSeed = 0.35;
          vRockWorldNorm = normalize(mat3(modelMatrix) * objectNormal);
        #endif
        vRockWorldPos = rockWp.xyz;`
      );

    shader.fragmentShader =
      `uniform sampler2D uRockMossTex;\nuniform sampler2D uRockLichenTex;\nvarying vec3 vRockWorldPos;\nvarying vec3 vRockWorldNorm;\nvarying float vRockLocalY;\nvarying float vRockSeed;\n` +
      shader.fragmentShader
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          #ifdef USE_MAP
            vec3 rN = normalize(vRockWorldNorm);
            vec2 rockTopUv = vRockWorldPos.xz * 0.62;
            float nMacro = sin(vRockWorldPos.x * 2.1 + cos(vRockWorldPos.z * 1.9)) * 0.5 + 0.5;
            float nDrip = cos(vRockWorldPos.x * 6.4 - vRockWorldPos.z * 5.8 + vRockWorldPos.y * 2.2) * 0.5 + 0.5;
            float mossBias = 0.24 + vRockSeed * 0.22;
            float mossCov = smoothstep(0.34, 0.72, rN.y + (nMacro - 0.45) * 0.34 + (nDrip - 0.5) * 0.2 + mossBias * 0.32);
            mossCov *= smoothstep(-0.18, 0.06, vRockLocalY);
            if (mossCov > 0.01) {
              vec3 mossCol = texture2D(uRockMossTex, rockTopUv).rgb;
              vec3 lichenCol = texture2D(uRockLichenTex, rockTopUv * 1.15).rgb;
              float lichenMix = smoothstep(0.46, 0.84, vRockSeed + (nMacro - 0.5) * 0.28);
              vec3 coatCol = mix(mossCol, lichenCol, lichenMix);
              diffuseColor.rgb = mix(diffuseColor.rgb, coatCol, mossCov * 0.94);
            }
            float soilCollar = 1.0 - smoothstep(-0.08, 0.16, vRockLocalY);
            diffuseColor.rgb *= mix(1.0, 0.74, soilCollar * 0.65);
          #endif`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          float mossRoughT = smoothstep(0.42, 0.74, normalize(vRockWorldNorm).y);
          roughnessFactor = mix(0.84, 0.97, mossRoughT);`
        );
  });
}
