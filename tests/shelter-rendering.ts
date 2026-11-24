import * as THREE from 'three';
import { ShelterGeometry, excludeShelterVegetation } from '../src/world/shelterGeometry';
import { WeatherAndSkySystem } from '../src/world/weatherAndSky';
import { buildArchitectureAndProps } from '../src/world/architectureAndProps';
import { getActiveBlueprint, setActiveWorldSeed } from '../src/world/terrainMath';
import type { WorldTextures } from '../src/world/proceduralTextures';
import type { SoundEngine } from '../src/world/soundEngine';

// Read pixels from the real shaders and generated house geometry, without loading game UI.
function verify() {
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
  lights[0].castShadow = true;
  lights[0].shadow.needsUpdate = true;
  const blockedLight = luminance(world, camera);
  props.dispose();
  weather.dispose();
  shelters.dispose();
  renderer.dispose();
  const result = {
    grassBefore,
    grassPitched,
    grassPacked,
    rainBefore,
    rainCovered,
    rainRestored,
    leakingLight,
    blockedLight,
  };
  function check(condition: boolean, message: string) {
    if (!condition) throw new Error(message + ': ' + JSON.stringify(result));
  }
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
  output.textContent = JSON.stringify(verify(), null, 2);
  output.dataset.status = 'passed';
} catch (error) {
  output.textContent = error instanceof Error ? error.stack! : String(error);
  output.dataset.status = 'failed';
}
