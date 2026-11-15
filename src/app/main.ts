/**
 * Walking-skeleton entry (foundation). Renders a lit three.js scene driven by
 * the fixed-step clock. app-shell takes ownership of this file and replaces
 * its body with createApp(...).start(root) (Bootstrap Handoff, BR-F-49).
 * Until then it imports only `three` and src/core (BR-F-47).
 */
import {
  BoxGeometry,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from 'three';
import { createFixedStepClock, TICK_DT } from '../core';

const SPIN_RAD_PER_SEC = 0.8;

function showNotice(root: HTMLElement, text: string): void {
  const p = document.createElement('p');
  p.className = 'boot-notice';
  p.dataset['testid'] = 'boot-notice';
  p.textContent = text;
  root.replaceChildren(p);
}

function createRenderer(root: HTMLElement): WebGLRenderer | null {
  try {
    const renderer = new WebGLRenderer({ antialias: true });
    renderer.shadowMap.enabled = true;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.domElement.dataset['testid'] = 'game-canvas';
    root.appendChild(renderer.domElement);
    return renderer;
  } catch (error) {
    console.warn('app/webgl-unavailable', error);
    showNotice(root, 'StrikeZone needs WebGL, which this browser could not start.');
    return null;
  }
}

function buildScene(): { scene: Scene; box: Mesh } {
  const scene = new Scene();
  scene.add(new HemisphereLight(0xdfe8f5, 0x3a3226, 0.6));
  const sun = new DirectionalLight(0xffffff, 1.6);
  sun.position.set(4, 8, 3);
  sun.castShadow = true;
  scene.add(sun);

  const ground = new Mesh(
    new PlaneGeometry(40, 40),
    new MeshStandardMaterial({ color: 0xc8a978, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const box = new Mesh(
    new BoxGeometry(1, 1, 1),
    new MeshStandardMaterial({ color: 0xf2a33a, roughness: 0.6 }),
  );
  box.position.set(0, 0.5, 0);
  box.castShadow = true;
  scene.add(box);
  return { scene, box };
}

function start(root: HTMLElement): void {
  const renderer = createRenderer(root);
  if (renderer === null) return;
  const { scene, box } = buildScene();
  const camera = new PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 500);
  camera.position.set(0, 1.7, 4);
  camera.lookAt(box.position);

  const clock = createFixedStepClock(60, 5);
  let last: number | null = null;
  const frame = (t: number): void => {
    const dt = last === null ? 0 : (t - last) / 1000;
    last = t;
    const steps = clock.advance(dt);
    box.rotation.y += steps * TICK_DT * SPIN_RAD_PER_SEC;
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });
}

const root = document.getElementById('app');
if (root !== null) start(root);
