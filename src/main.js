import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

const canvas = document.querySelector('#three-canvas');
const video = document.querySelector('#webcam');
const statusEl = document.querySelector('#status');

let shapeMode = 'box';
let selected = null;
let isPinching = false;
let lastSpawn = 0;
let previousTwoHandDistance = null;
let previousTwoHandAngle = null;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x050816, 8, 30);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 2.3, 8);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.maxDistance = 18;
controls.minDistance = 4;

const ambient = new THREE.HemisphereLight(0xffffff, 0x1b1740, 2.2);
scene.add(ambient);

const key = new THREE.DirectionalLight(0xffffff, 3.5);
key.position.set(4, 7, 5);
key.castShadow = true;
scene.add(key);

const rim = new THREE.PointLight(0x7c3aed, 22, 18);
rim.position.set(-4, 2, -3);
scene.add(rim);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(28, 28),
  new THREE.MeshStandardMaterial({ color: 0x080b22, roughness: 0.65, metalness: 0.15 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -2;
floor.receiveShadow = true;
scene.add(floor);

const grid = new THREE.GridHelper(28, 28, 0x3b82f6, 0x1e293b);
grid.position.y = -1.98;
scene.add(grid);

const particles = new THREE.Points(
  new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(Array.from({ length: 900 }, () => (Math.random() - 0.5) * 26), 3)),
  new THREE.PointsMaterial({ size: 0.025, color: 0x9fd3ff, transparent: true, opacity: 0.65 })
);
scene.add(particles);

const objects = [];
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function createMaterial() {
  const hue = Math.random();
  const color = new THREE.Color().setHSL(hue, 0.85, 0.56);
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.18,
    metalness: 0.45,
    clearcoat: 0.9,
    clearcoatRoughness: 0.18,
    emissive: color.clone().multiplyScalar(0.12)
  });
}

function createGeometry() {
  if (shapeMode === 'sphere') return new THREE.IcosahedronGeometry(0.55, 2);
  if (shapeMode === 'torus') return new THREE.TorusKnotGeometry(0.43, 0.15, 100, 16);
  return new THREE.BoxGeometry(0.85, 0.85, 0.85, 6, 6, 6);
}

function spawnObject(position) {
  const mesh = new THREE.Mesh(createGeometry(), createMaterial());
  mesh.position.copy(position);
  mesh.rotation.set(Math.random(), Math.random(), Math.random());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.floatSeed = Math.random() * 1000;
  scene.add(mesh);
  objects.push(mesh);
  selected = mesh;
  pulse(mesh);
}

function pulse(mesh) {
  mesh.scale.setScalar(0.05);
  mesh.userData.targetScale = 1;
}

function handToWorld(landmark) {
  const x = (1 - landmark.x) * 2 - 1; // mirror webcam
  const y = -(landmark.y * 2 - 1);
  const vec = new THREE.Vector3(x, y, 0.45).unproject(camera);
  const dir = vec.sub(camera.position).normalize();
  const distance = (0 - camera.position.z) / dir.z;
  return camera.position.clone().add(dir.multiplyScalar(distance));
}

function pinchDistance(hand) {
  const thumb = hand[4];
  const index = hand[8];
  return Math.hypot(thumb.x - index.x, thumb.y - index.y, thumb.z - index.z);
}

function selectNearest(pos) {
  let best = null;
  let bestDist = Infinity;
  for (const obj of objects) {
    const d = obj.position.distanceTo(pos);
    if (d < bestDist && d < 1.15) {
      best = obj;
      bestDist = d;
    }
  }
  return best;
}

function setMode(mode) {
  shapeMode = mode;
  document.querySelectorAll('button').forEach(b => b.classList.remove('active'));
  document.querySelector(`#shape${mode[0].toUpperCase()}${mode.slice(1)}`)?.classList.add('active');
}

document.querySelector('#shapeBox').onclick = () => setMode('box');
document.querySelector('#shapeSphere').onclick = () => setMode('sphere');
document.querySelector('#shapeTorus').onclick = () => setMode('torus');
document.querySelector('#clearScene').onclick = () => {
  for (const obj of objects) scene.remove(obj);
  objects.length = 0;
  selected = null;
};
setMode('box');

async function setupCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
  video.srcObject = stream;
  await video.play();
}

async function setupHands() {
  const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm');
  return HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
      delegate: 'GPU'
    },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.55,
    minHandPresenceConfidence: 0.55,
    minTrackingConfidence: 0.55
  });
}

let handLandmarker;
let lastVideoTime = -1;

async function init() {
  try {
    await setupCamera();
    handLandmarker = await setupHands();
    statusEl.textContent = 'آماده است. دستت را جلوی دوربین بگیر.';
    detectLoop();
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'دسترسی دوربین یا مدل تشخیص دست مشکل دارد. پروژه را با https یا localhost اجرا کن.';
  }
}

function detectLoop() {
  if (video.currentTime !== lastVideoTime && handLandmarker) {
    lastVideoTime = video.currentTime;
    const result = handLandmarker.detectForVideo(video, performance.now());
    handleHands(result.landmarks || []);
  }
  requestAnimationFrame(detectLoop);
}

function handleHands(hands) {
  if (!hands.length) {
    isPinching = false;
    previousTwoHandDistance = null;
    previousTwoHandAngle = null;
    return;
  }

  const first = hands[0];
  const indexTip = first[8];
  const worldPos = handToWorld(indexTip);
  const pinchingNow = pinchDistance(first) < 0.055;

  if (pinchingNow) {
    const now = performance.now();
    if (!isPinching) {
      selected = selectNearest(worldPos);
      if (!selected && now - lastSpawn > 420) {
        spawnObject(worldPos);
        lastSpawn = now;
      }
    }
    if (selected) {
      selected.position.lerp(worldPos, 0.32);
      selected.rotation.x += 0.025;
      selected.rotation.y += 0.035;
    }
  }
  isPinching = pinchingNow;

  if (hands.length >= 2 && selected) {
    const p1 = handToWorld(hands[0][8]);
    const p2 = handToWorld(hands[1][8]);
    const dist = p1.distanceTo(p2);
    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    selected.position.lerp(p1.clone().add(p2).multiplyScalar(0.5), 0.22);
    if (previousTwoHandDistance) {
      const scaleFactor = THREE.MathUtils.clamp(dist / previousTwoHandDistance, 0.94, 1.06);
      selected.scale.multiplyScalar(scaleFactor);
      selected.scale.clampScalar(0.25, 3.5);
    }
    if (previousTwoHandAngle !== null) selected.rotation.z += angle - previousTwoHandAngle;
    previousTwoHandDistance = dist;
    previousTwoHandAngle = angle;
  } else {
    previousTwoHandDistance = null;
    previousTwoHandAngle = null;
  }
}

function animate(time) {
  requestAnimationFrame(animate);
  controls.update();
  particles.rotation.y += 0.0008;
  for (const obj of objects) {
    if (obj.userData.targetScale && obj.scale.x < obj.userData.targetScale) {
      obj.scale.lerp(new THREE.Vector3(1, 1, 1), 0.18);
    }
    obj.position.y += Math.sin(time * 0.0018 + obj.userData.floatSeed) * 0.0015;
  }
  renderer.render(scene, camera);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

init();
animate();
