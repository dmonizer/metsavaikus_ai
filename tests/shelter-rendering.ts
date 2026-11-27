import * as THREE from 'three';
import { ShelterGeometry, excludeShelterVegetation } from '../src/world/shelterGeometry';
import { ComputeEngine } from '../src/world/wasmCompute';
import { TerrainChunkManager } from '../src/world/terrainChunkManager';
import { WeatherAndSkySystem } from '../src/world/weatherAndSky';
import { buildArchitectureAndProps } from '../src/world/architectureAndProps';
import { getActiveBlueprint, setActiveWorldSeed } from '../src/world/terrainMath';
import type { WorldTextures } from '../src/world/proceduralTextures';
import type { SoundEngine } from '../src/world/soundEngine';

// Read pixels from the real shaders and generated house geometry, without loading game UI.
async function verify() {
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.debug.onShaderError = () => {
    throw new Error('Shader compilation failed');
  };
  renderer.setSize(128, 128);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const target = new THREE.WebGLRenderTarget(128, 128);
  renderer.setRenderTarget(target);
  const pixels = new Uint8Array(128 * 128 * 4);
  function luminance(scene: THREE.Scene, camera: THREE.Camera) {
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, 128, 128, pixels);
    let sum = 0;
    for (let i = 0; i < pixels.length; i += 4) sum += pixels[i] + pixels[i + 1] + pixels[i + 2];
    return sum;
  }
  // GPU exclusion: packed plants disappear immediately after pitching and return after packing.
  const shelters = new ShelterGeometry(),
    scene = new THREE.Scene();
  scene.background = new THREE.Color(0);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 30);
  camera.position.set(0, 1.5, 4);
  camera.lookAt(0, 0.5, 0);
  const mat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
  excludeShelterVegetation(mat, shelters);
  const plants = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 1, 0.5), mat, 1);
  plants.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 0.5, 0));
  scene.add(plants);
  const grassBefore = luminance(scene, camera);
  shelters.add({
    id: 'tent',
    x: 0,
    z: 0,
    yaw: Math.PI / 3,
    halfW: 1,
    halfD: 1.3,
    floorY: 0,
    temporary: true,
    roof: { eaveY: 0, rise: 1.4, axis: 'x' },
  });
  const grassPitched = luminance(scene, camera);
  shelters.remove('tent');
  const grassPacked = luminance(scene, camera);
  // Real rain shader: retain outdoor rain while removing fragments beneath an intact cover.
  const weatherScene = new THREE.Scene();
  weatherScene.background = new THREE.Color(0);
  const weather = new WeatherAndSkySystem(weatherScene, true, 1, true);
  weather.setShelterGeometry(shelters);
  weather.setWeather('rain', true);
  const rain = weather.group.children.find(
    (node) =>
      node instanceof THREE.Mesh &&
      node.material instanceof THREE.ShaderMaterial &&
      node.material.uniforms.uRainCenter
  ) as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  const rainScene = new THREE.Scene();
  rainScene.background = new THREE.Color(0);
  rainScene.add(rain);
  rain.material.uniforms.uRainCenter.value.set(0, 1.5, -3);
  rain.material.uniforms.uOpacity.value = 1;
  rain.material.uniforms.uCamFwd.value.set(0, 0, -1);
  rain.material.uniforms.uTime.value = 3;
  camera.position.set(0, 1.5, 0);
  camera.lookAt(0, 1.5, -5);
  const rainBefore = luminance(rainScene, camera);
  shelters.add({
    id: 'house',
    x: 0,
    z: -3,
    yaw: 0,
    halfW: 20,
    halfD: 20,
    floorY: 0,
    roof: { eaveY: 100, rise: 0, axis: 'z' },
  });
  const rainCovered = luminance(rainScene, camera);
  shelters.remove('house');
  const rainRestored = luminance(rainScene, camera);
  // Use generated house meshes and the actual pooled-light shadow configuration.
  setActiveWorldSeed(2026);
  const world = new THREE.Scene();
  world.background = new THREE.Color(0);
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  texture.needsUpdate = true;
  // WorldTextures is borrowed by props and intentionally outlives their scope.
  renderer.initTexture(texture);
  const geometryBaseline = renderer.info.memory.geometries;
  const textures = new Proxy({}, { get: () => texture }) as WorldTextures;
  const props = buildArchitectureAndProps(
    world,
    textures,
    { playImpact() {} } as unknown as SoundEngine,
    () => {},
    true
  );
  const village = getActiveBlueprint().villages[0],
    house = village.buildings[0];
  const x = village.x + house.offsetX,
    z = village.z + house.offsetZ;
  const building = world.children.find((n) => n.position.x === x && n.position.z === z)!;
  const lights = world.children.filter((n): n is THREE.PointLight => n instanceof THREE.PointLight);
  for (const n of world.children) n.visible = n === building || n instanceof THREE.PointLight;
  building.traverse((n) => {
    if (n instanceof THREE.Mesh) n.material = new THREE.MeshLambertMaterial({ color: 0xeeeeee });
  });
  lights[0].position.set(x + house.w / 2 + 1, building.position.y + 2, z);
  lights[0].intensity = 50;
  lights[0].distance = 20;
  lights[1].intensity = 0;
  camera.position.set(x, building.position.y + 1.7, z);
  camera.lookAt(x - house.w / 2, building.position.y + 1.7, z);
  lights[0].castShadow = false;
  const leakingLight = luminance(world, camera);
  // The first lit render also uploads renderer-owned fallback textures.
  // Compare against this warm baseline before allocating actual shadow maps.
  const propsMemoryBaseline = { geometries: geometryBaseline, textures: renderer.info.memory.textures };
  lights[0].castShadow = true;
  lights[0].shadow.needsUpdate = true;
  const blockedLight = luminance(world, camera);
  // Use the production disc, depth map and mirror pass with fixed time and camera poses.
  const water = world.children.find(node => node.userData.debugLayer === 'water')!;
  const waterScene = new THREE.Scene();
  waterScene.background = new THREE.Color(0x98c0ea);
  waterScene.add(water);
  water.visible = true;
  const { centerX, centerZ, radius } = props.getBogShoreDepthInfo();
  const waterCamera = new THREE.PerspectiveCamera(60, 1, 0.1, 350);
  waterCamera.position.set(centerX, 8, centerZ);
  waterCamera.lookAt(centerX + 1, -3, centerZ);
  const downReflection = props.renderWaterReflection(renderer, waterScene, waterCamera, true);
  const waterDown = luminance(waterScene, waterCamera);
  const waterPixels = pixels.slice();
  water.visible = false;
  luminance(waterScene, waterCamera);
  const waterDrawn = waterPixels.some((value, i) => value !== pixels[i]);
  water.visible = true;
  waterCamera.lookAt(centerX + 1, 30, centerZ);
  props.renderWaterReflection(renderer, waterScene, waterCamera, false);
  const skyReflection = props.renderWaterReflection(renderer, waterScene, waterCamera, true);
  const waterSky = luminance(waterScene, waterCamera);
  waterCamera.position.set(centerX + radius - 2, 2, centerZ);
  waterCamera.lookAt(waterCamera.position.x, 1, centerZ - 10);
  props.renderWaterReflection(renderer, waterScene, waterCamera, false);
  const edgeReflection = props.renderWaterReflection(renderer, waterScene, waterCamera, true);
  world.add(water);
  props.dispose();
  const propsMemoryAfter = { ...renderer.info.memory };
  const restartMemoryCounts: Array<typeof propsMemoryBaseline> = [];
  for (let cycle = 0; cycle < 2; cycle++) {
    const restarted = buildArchitectureAndProps(world, textures,
      { playImpact() {} } as unknown as SoundEngine, () => {}, true);
    const houseRoot = world.children.find(node => node.position.x === x && node.position.z === z)!;
    for (const node of world.children) node.visible = node === houseRoot || node instanceof THREE.PointLight;
    houseRoot.traverse(node => {
      if (node instanceof THREE.Mesh) node.material = new THREE.MeshLambertMaterial({ color: 0xeeeeee });
    });
    const light = world.children.find(node => node instanceof THREE.PointLight) as THREE.PointLight;
    light.intensity = 50;
    light.shadow.needsUpdate = true;
    luminance(world, camera);
    restarted.dispose();
    restartMemoryCounts.push({ ...renderer.info.memory });
  }
  // Exercise the production terrain shader across a depth gradient at two swash phases.
  const terrain = new TerrainChunkManager(await ComputeEngine.create(), texture);
  const depth = new THREE.DataTexture(new Uint8Array([42, 0, 0, 255, 80, 0, 0, 255]), 2, 1);
  depth.minFilter = depth.magFilter = THREE.LinearFilter;
  depth.needsUpdate = true;
  terrain.setBogShoreDepthMap(depth, centerX, centerZ, 18);
  const groundScene = new THREE.Scene();
  const sun = new THREE.DirectionalLight(0xffe6bb, 3);
  sun.position.set(5, 3, 1);
  groundScene.add(terrain.group, sun, new THREE.HemisphereLight(0xbcd8ee, 0x38472b, 1));
  waterCamera.position.set(centerX, 9, centerZ + 8);
  waterCamera.lookAt(centerX, -1, centerZ);
  terrain.update(waterCamera);
  function shorelineHash(time: number, wind: number) {
    terrain.setLightingState(0.8, time, wind);
    luminance(groundScene, waterCamera);
    let hash = 2166136261;
    for (const channel of pixels) hash = Math.imul(hash ^ channel, 16777619);
    return hash >>> 0;
  }
  const shoreCalm = shorelineHash(2, 0.25);
  const shoreWind = shorelineHash(7, 1.8);
  terrain.dispose();
  depth.dispose();
  texture.dispose();
  weather.dispose();
  shelters.dispose();
  renderer.dispose();
  const result = {
    shoreCalm, shoreWind, waterDown, waterSky, waterDrawn, downReflection, skyReflection, edgeReflection,
    grassBefore,
    grassPitched,
    grassPacked,
    rainBefore,
    rainCovered,
    rainRestored,
    leakingLight,
    blockedLight,
    propsMemoryBaseline,
    propsMemoryAfter,
    restartMemoryCounts,
  };
  function check(condition: boolean, message: string) {
    if (!condition) throw new Error(message + ': ' + JSON.stringify(result));
  }
  check(propsMemoryAfter.geometries === propsMemoryBaseline.geometries, 'Prop geometry memory must return to baseline');
  check(propsMemoryAfter.textures === propsMemoryBaseline.textures, 'Prop texture/shadow memory must return to baseline');
  check(restartMemoryCounts.every(count => count.geometries === propsMemoryBaseline.geometries &&
    count.textures === propsMemoryBaseline.textures), 'Restarts must release rendered geometries and shadow textures');
  check(shoreCalm !== shoreWind, 'The two shoreline states must produce different pixels');
  check(!skyReflection, 'Looking above the lake must skip the mirror pass');
  check(waterDrawn && downReflection && edgeReflection, 'Water and partial-disc reflections must render');
  check(result.grassBefore > 0, 'Vegetation fixture must render');
  check(result.grassPitched === 0, 'Tent must exclude vegetation');
  check(result.grassPacked === result.grassBefore, 'Packing must restore vegetation');
  check(result.rainBefore > 0, 'Rain fixture must render');
  check(result.rainCovered === 0, 'Intact roof must exclude rain');
  check(result.rainRestored === result.rainBefore, 'Uncovered rain must remain visible');
  check(result.leakingLight > 0, 'Unshadowed fixture must show leaking light');
  check(result.blockedLight < result.leakingLight * 0.05, 'House must occlude the pooled light');
  return result;
}

const output = document.querySelector<HTMLPreElement>('#results')!;
try {
  output.textContent = JSON.stringify(await verify(), null, 2);
  output.dataset.status = 'passed';
} catch (error) {
  output.textContent = error instanceof Error ? error.stack! : String(error);
  output.dataset.status = 'failed';
}
