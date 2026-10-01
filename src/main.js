import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const app = document.getElementById("app");
const loadingEl = document.getElementById("loading");

// シーン
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a1a);

// カメラ
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 1.5, 4);

// レンダラー
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.appendChild(renderer.domElement);

// ライト
scene.add(new THREE.AmbientLight(0xffffff, 1.2));
const dirLight = new THREE.DirectionalLight(0xffffff, 2);
dirLight.position.set(3, 5, 2);
scene.add(dirLight);

// カメラ操作
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 1, 0);

const clock = new THREE.Clock();

// ダンス制御用の参照
let model = null;
let modelBaseY = 0;
const pivots = {}; // 付け根を軸に回すためのGroup
let hatNode = null;
let hatBaseRotZ = 0;

// ダンスのON/OFF
let dancing = true;

/**
 * 複数パーツ（腕本体＋手先など）を「付け根」を軸にまとめて回せる
 * ピボットGroupを作る。attach() を使うので座標系（親の回転/スケール）に
 * 依存せず、見た目の位置を保ったまま安全に親子を組み替えられる。
 */
function makePivot(root, key, memberNames, pickPivot) {
  const nodes = memberNames
    .map((n) => root.getObjectByName(n))
    .filter(Boolean);
  if (nodes.length === 0) return;

  root.updateMatrixWorld(true);

  // メンバー全体のワールドバウンディングボックスから付け根を決める
  const box = new THREE.Box3();
  nodes.forEach((n) => box.expandByObject(n));
  const center = box.getCenter(new THREE.Vector3());
  const pivotWorld = pickPivot(box, center);

  const parent = nodes[0].parent;
  const group = new THREE.Group();
  group.name = `${key}_pivot`;
  parent.add(group);

  // Groupのワールド位置を付け根に合わせる（親の変換を考慮）
  parent.updateMatrixWorld(true);
  group.position.copy(parent.worldToLocal(pivotWorld.clone()));
  group.updateMatrixWorld(true);

  // attach() = ワールド変換を保持したまま子に移す（位置がズレない）
  nodes.forEach((n) => group.attach(n));

  pivots[key] = group;
}

// GLBモデル読み込み
const loader = new GLTFLoader();
loader.load(
  "/nasu_character.glb",
  (gltf) => {
    model = gltf.scene;
    scene.add(model);

    // ★ ピボットはモデルを動かす前（transformが素の状態）に作る
    // 腕本体＋手先 / 脚本体＋足先 をまとめて肩・股関節を軸にする
    makePivot(model, "Arm_L", ["Arm_L", "Arm_L_Tip"], (b, c) => new THREE.Vector3(c.x, b.max.y, c.z));
    makePivot(model, "Arm_R", ["Arm_R", "Arm_R_Tip"], (b, c) => new THREE.Vector3(c.x, b.max.y, c.z));
    makePivot(model, "Leg_L", ["Leg_L", "Leg_L_Tip"], (b, c) => new THREE.Vector3(c.x, b.max.y, c.z));
    makePivot(model, "Leg_R", ["Leg_R", "Leg_R_Tip"], (b, c) => new THREE.Vector3(c.x, b.max.y, c.z));

    // 帽子は原点が設定済みなのでノードを直接回す
    hatNode = model.getObjectByName("Hat");
    if (hatNode) hatBaseRotZ = hatNode.rotation.z;

    // モデルを中央に配置し、カメラをフィットさせる
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    model.position.sub(center);
    model.position.y += size.y / 2;
    modelBaseY = model.position.y;

    const maxDim = Math.max(size.x, size.y, size.z);
    camera.position.set(0, size.y / 2, maxDim * 2.5);
    controls.target.set(0, size.y / 2, 0);
    controls.update();

    loadingEl.style.display = "none";
  },
  (xhr) => {
    const percent = xhr.total ? Math.round((xhr.loaded / xhr.total) * 100) : 0;
    loadingEl.textContent = `Loading... ${percent}%`;
  },
  (error) => {
    console.error("GLB読み込みエラー:", error);
    loadingEl.textContent = "読み込みに失敗しました";
  },
);

// コードによるダンスアニメーション（各ピボットGroupを回すだけ）
function updateDance(t) {
  if (!model || !dancing) return;

  const speed = 4; // ノリの速さ
  const beat = t * speed;
  const swing = Math.sin(beat);

  // 体：顔ごと一緒に動くようモデル全体を傾ける＆ひねる
  model.rotation.z = swing * 0.06;
  model.rotation.y = Math.sin(beat * 0.5) * 0.2;

  // 腕：肩を軸に前後交互へ振る（手先も一緒に動く）
  if (pivots["Arm_L"]) pivots["Arm_L"].rotation.x = swing * 0.6;
  if (pivots["Arm_R"]) pivots["Arm_R"].rotation.x = -swing * 0.6;

  // 脚：股関節を軸に前後交互へ（腕と逆位相で歩くように）
  if (pivots["Leg_L"]) pivots["Leg_L"].rotation.x = -swing * 0.35;
  if (pivots["Leg_R"]) pivots["Leg_R"].rotation.x = swing * 0.35;

  // 帽子：軽くぴょこぴょこ
  if (hatNode) hatNode.rotation.z = hatBaseRotZ + Math.sin(beat * 2) * 0.08;

  // 全身でぴょんぴょん跳ねる
  model.position.y = modelBaseY + Math.abs(swing) * 0.25;
}

// ダブルクリック / スペースキーでダンスON/OFF
function toggleDance() {
  dancing = !dancing;
}
renderer.domElement.addEventListener("dblclick", toggleDance);
window.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    toggleDance();
  }
});

// リサイズ対応
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// 描画ループ
function animate() {
  requestAnimationFrame(animate);
  updateDance(clock.getElapsedTime());
  controls.update();
  renderer.render(scene, camera);
}
animate();
