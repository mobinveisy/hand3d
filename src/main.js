import * as THREE from 'three';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const video = document.querySelector('#webcam');
const canvas = document.querySelector('#three');
const statusEl = document.querySelector('#status');
const meterFill = document.querySelector('#meterFill');
const shapeBtn = document.querySelector('#shapeBtn');
const clearBtn = document.querySelector('#clearBtn');
const cameraBtn = document.querySelector('#cameraBtn');

const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';

let handLandmarker;
let running = false;
let lastVideoTime = -1;
let selected = null;
let lastPinch = false;
let shapeIndex = 0;
let twoHandStartDistance = null;
let selectedStartScale = 1;
let selectedStartRotation = 0;

const shapes = ['Box', 'Sphere', 'Torus', 'Cone', 'Octa'];
const objects = [];
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x07111f, 0.035);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 1.2, 6);

const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

scene.add(new THREE.HemisphereLight(0xddeeff, 0x221144, 2.1));
const key = new THREE.DirectionalLight(0xffffff, 3.2);
key.position.set(4, 8, 6);
key.castShadow = true;
scene.add(key);
const rim = new THREE.PointLight(0x9b5cff, 18, 16);
rim.position.set(-4, 2, 3);
scene.add(rim);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(18, 18),
  new THREE.MeshStandardMaterial({ color: 0x111827, roughness: .8, metalness: .15, transparent: true, opacity: .45 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -2.15;
floor.receiveShadow = true;
scene.add(floor);

const grid = new THREE.GridHelper(18, 36, 0x7c3aed, 0x334155);
grid.position.y = -2.13;
scene.add(grid);

const handCursor = new THREE.Mesh(
  new THREE.SphereGeometry(.07, 24, 24),
  new THREE.MeshStandardMaterial({ color: 0x7df9ff, emissive: 0x3ad9ff, emissiveIntensity: 1.3 })
);
scene.add(handCursor);

function setStatus(msg, error = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('error', error);
}

function makeMaterial() {
  const hue = Math.random();
  const color = new THREE.Color().setHSL(hue, .82, .58);
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: .35,
    roughness: .22,
    clearcoat: .8,
    clearcoatRoughness: .18,
    transmission: .08,
    emissive: color.clone().multiplyScalar(.15)
  });
}

function makeGeometry() {
  switch (shapes[shapeIndex]) {
    case 'Sphere': return new THREE.SphereGeometry(.48, 48, 32);
    case 'Torus': return new THREE.TorusGeometry(.42, .15, 24, 72);
    case 'Cone': return new THREE.ConeGeometry(.48, .9, 48);
    case 'Octa': return new THREE.OctahedronGeometry(.55, 1);
    default: return new THREE.BoxGeometry(.8, .8, .8, 3, 3, 3);
  }
}

function createObject(pos) {
  const mesh = new THREE.Mesh(makeGeometry(), makeMaterial());
  mesh.position.copy(pos);
  mesh.rotation.set(Math.random() * .6, Math.random() * .6, Math.random() * .6);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.velocity = new THREE.Vector3((Math.random() - .5) * .015, .015, 0);
  scene.add(mesh);
  objects.push(mesh);
  selected = mesh;
  pulse(mesh);
  return mesh;
}

function pulse(mesh) {
  mesh.userData.pulse = 1;
}

function screenToWorld(x, y, z = 0.42) {
  pointer.x = (1 - x) * 2 - 1; // mirror camera
  pointer.y = -(y * 2 - 1);
  const vector = new THREE.Vector3(pointer.x, pointer.y, z).unproject(camera);
  const dir = vector.sub(camera.position).normalize();
  const distance = (0 - camera.position.z) / dir.z;
  return camera.position.clone().add(dir.multiplyScalar(distance));
}

function pinchAmount(hand) {
  const thumb = hand[4];
  const index = hand[8];
  return Math.hypot(thumb.x - index.x, thumb.y - index.y, thumb.z - index.z);
}

function palmOpenAmount(hand) {
  const wrist = hand[0];
  const tips = [8, 12, 16, 20].map(i => hand[i]);
  return tips.reduce((sum, p) => sum + Math.hypot(p.x - wrist.x, p.y - wrist.y), 0) / tips.length;
}

function pickObject(worldPos) {
  raycaster.set(camera.position, worldPos.clone().sub(camera.position).normalize());
  const hits = raycaster.intersectObjects(objects, false);
  return hits[0]?.object || null;
}

async function createHandLandmarker(delegate = 'GPU') {
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  return HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: .55,
    minHandPresenceConfidence: .55,
    minTrackingConfidence: .5
  });
}

async function initModel() {
  setStatus('در حال لود مدل تشخیص دست...');
  try {
    handLandmarker = await createHandLandmarker('GPU');
  } catch (gpuError) {
    console.warn('GPU delegate failed, falling back to CPU', gpuError);
    handLandmarker = await createHandLandmarker('CPU');
  }
}

async function startCamera() {
  try {
    if (!window.isSecureContext) {
      throw new Error('صفحه Secure نیست. باید با HTTPS یا localhost اجرا شود.');
    }
    setStatus('در حال گرفتن دسترسی دوربین...');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    video.srcObject = stream;
    await video.play();
    running = true;
    setStatus('آماده است. دستت را جلوی دوربین بگیر 👌');
    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    setStatus(`مشکل دوربین: ${err.message || err.name}. در Netlify حتماً آدرس https باشد و Permission دوربین را Allow کن.`, true);
  }
}

async function boot() {
  try {
    await initModel();
    await startCamera();
  } catch (err) {
    console.error(err);
    setStatus(`مدل تشخیص دست لود نشد: ${err.message || err.name}. اینترنت/CDN یا AdBlock را چک کن.`, true);
  }
}

function handleHands(results) {
  const hands = results.landmarks || [];
  meterFill.style.width = `${Math.min(100, hands.length * 50)}%`;
  if (!hands.length) {
    setStatus('دستی دیده نمی‌شود. دستت را داخل کادر بگیر.');
    lastPinch = false;
    twoHandStartDistance = null;
    return;
  }

  const hand = hands[0];
  const indexTip = hand[8];
  const world = screenToWorld(indexTip.x, indexTip.y);
  handCursor.position.lerp(world, .45);

  const pinch = pinchAmount(hand) < .045;
  const open = palmOpenAmount(hand) > .31;

  if (pinch && !lastPinch) {
    selected = pickObject(world) || createObject(world);
    pulse(selected);
  }

  if (pinch && selected) {
    selected.position.lerp(world, .35);
    selected.userData.velocity.set(0, 0, 0);
    selected.rotation.y += .035;
    selected.rotation.x += .018;
    setStatus(`گرفتی: ${shapes[shapeIndex]} | با حرکت دست جابه‌جا کن`);
  } else if (open) {
    setStatus('کف دست باز: آماده ساخت جسم جدید با پینچ');
  }
  lastPinch = pinch;

  if (hands.length >= 2 && selected) {
    const a = screenToWorld(hands[0][8].x, hands[0][8].y);
    const b = screenToWorld(hands[1][8].x, hands[1][8].y);
    const dist = a.distanceTo(b);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    if (!twoHandStartDistance) {
      twoHandStartDistance = dist;
      selectedStartScale = selected.scale.x;
      selectedStartRotation = selected.rotation.z - angle;
    } else {
      const scale = THREE.MathUtils.clamp(selectedStartScale * (dist / twoHandStartDistance), .35, 3.5);
      selected.scale.setScalar(scale);
      selected.rotation.z = selectedStartRotation + angle;
      setStatus('دو دست: Scale و Rotate فعال است');
    }
  } else {
    twoHandStartDistance = null;
  }
}

function loop(now) {
  if (running && handLandmarker && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const results = handLandmarker.detectForVideo(video, now);
    handleHands(results);
  }
  requestAnimationFrame(loop);
}

function animate() {
  const t = performance.now() * .001;
  rim.position.x = Math.sin(t * .7) * 4;
  rim.position.z = Math.cos(t * .6) * 4;

  for (const obj of objects) {
    if (obj !== selected) {
      obj.rotation.x += .004;
      obj.rotation.y += .007;
      obj.position.add(obj.userData.velocity);
      obj.userData.velocity.y -= .00055;
      if (obj.position.y < -1.65) {
        obj.position.y = -1.65;
        obj.userData.velocity.y *= -.48;
      }
    }
    if (obj.userData.pulse) {
      obj.userData.pulse *= .88;
      const s = 1 + obj.userData.pulse * .18;
      obj.scale.lerp(new THREE.Vector3(s, s, s), .25);
      if (obj.userData.pulse < .02) obj.userData.pulse = 0;
    }
  }
  handCursor.material.emissiveIntensity = 1.1 + Math.sin(t * 8) * .35;
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

shapeBtn.addEventListener('click', () => {
  shapeIndex = (shapeIndex + 1) % shapes.length;
  shapeBtn.textContent = `Shape: ${shapes[shapeIndex]}`;
});
clearBtn.addEventListener('click', () => {
  for (const obj of objects.splice(0)) scene.remove(obj);
  selected = null;
});
cameraBtn.addEventListener('click', startCamera);

addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    shapeIndex = (shapeIndex + 1) % shapes.length;
    shapeBtn.textContent = `Shape: ${shapes[shapeIndex]}`;
  }
  if ((e.code === 'Backspace' || e.code === 'Delete') && selected) {
    scene.remove(selected);
    const i = objects.indexOf(selected);
    if (i >= 0) objects.splice(i, 1);
    selected = null;
  }
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

animate();
boot();
