import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/**
 * The three.js side of the 3D preview. Only Model3DViewer imports this, and only
 * dynamically, so three.js stays out of the bundle the canvas loads with.
 */

export interface ModelSceneEvents {
  /** 0–1 while the file downloads, when its size is known. */
  onProgress?: (fraction: number) => void;
  onLoad?: () => void;
  onError?: (message: string) => void;
}

/**
 * Renders the glTF/GLB at `url` into `container`: drag to rotate, scroll to zoom,
 * right-drag (or shift-drag) to pan. Returns the teardown, which frees the GPU
 * resources and the WebGL context.
 */
export function mountModelScene(container: HTMLElement, url: string, events: ModelSceneEvents = {}): () => void {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.touchAction = 'none';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = environment;
  // The room environment lights PBR materials on its own (dimmed, or light albedos wash
  // out); a key light adds shape.
  scene.environmentIntensity = 0.6;
  const sun = new THREE.DirectionalLight(0xffffff, 0.8);
  sun.position.set(3, 5, 4);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
  camera.position.set(0, 0, 3);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.screenSpacePanning = true;

  const resize = () => {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  let frame = 0;
  const tick = () => {
    frame = requestAnimationFrame(tick);
    controls.update();
    renderer.render(scene, camera);
  };
  tick();

  let disposed = false;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  loader.load(
    url,
    (gltf) => {
      if (disposed) return disposeObject(gltf.scene);
      frameObject(gltf.scene, camera, controls);
      scene.add(gltf.scene);
      events.onLoad?.();
    },
    (e) => e.total > 0 && events.onProgress?.(e.loaded / e.total),
    (err) => !disposed && events.onError?.(loadError(err))
  );

  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    controls.dispose();
    disposeObject(scene);
    environment.dispose();
    pmrem.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  };
}

/** Centres the model on the origin and backs the camera off until all of it is in view. */
function frameObject(object: THREE.Object3D, camera: THREE.PerspectiveCamera, controls: OrbitControls): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getBoundingSphere(new THREE.Sphere()).radius || 1;
  object.position.sub(center);
  const distance = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.1;
  // A three-quarter view from slightly above, which reads better than straight on.
  camera.position.copy(new THREE.Vector3(0.55, 0.35, 1).normalize().multiplyScalar(distance));
  camera.near = distance / 100;
  camera.far = distance * 100;
  camera.updateProjectionMatrix();
  controls.target.set(0, 0, 0);
  controls.minDistance = radius * 0.2;
  controls.maxDistance = distance * 10;
  controls.update();
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!material) continue;
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
}

function loadError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/draco/i.test(message)) return '模型使用了 Draco 压缩，暂不支持预览';
  return message ? `模型加载失败：${message}` : '模型加载失败';
}
