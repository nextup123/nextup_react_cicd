// The 3D robot view of the Teach Points page (replaces the NexSim bundle).
//
// Built for low CPU use:
//  - it draws only when something changed (joints, camera, settings, resize),
//    never in a continuous loop, and at most `hz` times per second;
//  - nothing is drawn while the view is off screen, folded, or the tab is hidden;
//  - joint updates closer than 0.0001 rad are ignored; smooth motion
//    (interpolation between updates) is optional;
//  - meshes come pre-simplified from the robot (low / medium / full detail);
//  - shading, shadows, anti-aliasing and resolution follow the settings.
//
// The robot is built from the URDF model the backend serves
// (/robot-models/model/:id): links, joint origins and axes, visual meshes.
import {
  AmbientLight,
  AxesHelper,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  ACESFilmicToneMapping,
  BackSide,
  DirectionalLight,
  DoubleSide,
  NoToneMapping,
  ShadowMaterial,
  SRGBColorSpace,
  Euler,
  GridHelper,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Quaternion,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  Box3,
  WebGLRenderer,
  CanvasTexture,
  Sprite,
  SpriteMaterial,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { Chain, axisAngle, mul } from "./kinematics";
import { loadMesh } from "./meshes";

const EPS = 1e-4; // rad: smaller joint changes are not drawn
const AXIS_COLOR = { x: 0xe5484d, y: 0x30a46c, z: 0x3e7bfa };
const CART_STEP_M = 0.06; // ghost offset for a Cartesian jog preview
const CART_STEP_RAD = (15 * Math.PI) / 180;
const LIGHTS = {
  soft: { hemi: 1.45, key: 1.0, fill: 0 },
  studio: { hemi: 0.95, key: 1.7, fill: 0.5 },
  bright: { hemi: 1.3, key: 2.2, fill: 0.8 },
};

const toQuat = (rpy) => new Quaternion().setFromEuler(new Euler(rpy[0], rpy[1], rpy[2], "ZYX"));
const now = () => performance.now();

export class RobotViewer {
  constructor(container, { settings, colors, onStats, onError } = {}) {
    this.container = container;
    this.settings = { ...settings };
    this.colors = colors || {};
    this.onStats = onStats;
    this.onError = onError;
    this.disposed = false;
    this.dirty = true;
    this.raf = 0;
    this.timer = 0;
    this.lastFrame = 0;
    this.visible = true;
    this.onScreen = true;
    this.frames = 0;
    this.renderMs = 0;
    this.jog = { mode: "arrows", active: null, frame: "base_link" };
    this.q = [];
    this.qTarget = [];
    this.interp = null;
    this.lastJointAt = 0;
    this.materials = new Map();
    this.visualMeshes = []; // { mesh, ghost, meshId }

    this.scene = new Scene();
    this.scene.background = new Color(0x202226);
    this.camera = new PerspectiveCamera(40, 1, 0.02, 60);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(2.6, 2.0, 1.7);
    this.target = new Vector3(0, 0, 0.7);

    this._buildStage();
    this._createRenderer();
    this._observe();
    this._statsTimer = setInterval(() => this._emitStats(), 1000);
  }

  // ───────────────────────── renderer and loop ─────────────────────────

  _createRenderer() {
    const old = this.renderer;
    if (this.controls) this.target.copy(this.controls.target); // keep the camera where the user left it
    if (old) {
      this.controls?.dispose();
      old.dispose();
      old.forceContextLoss?.();
      old.domElement.remove();
    }
    const r = new WebGLRenderer({ antialias: Boolean(this.settings.antialias), powerPreference: this.settings.shading === "realistic" ? "high-performance" : "low-power", alpha: false });
    r.shadowMap.type = PCFSoftShadowMap;
    // Filmic tone mapping keeps the light robot colours from burning out under the realistic materials.
    r.toneMapping = this.settings.shading === "realistic" ? ACESFilmicToneMapping : NoToneMapping;
    r.toneMappingExposure = 0.7; // ACES in three scales by exposure / 0.6
    r.shadowMap.enabled = Boolean(this.settings.shadows);
    r.domElement.style.display = "block";
    r.domElement.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      if (r !== this.renderer || this.disposed) return; // an old renderer being replaced
      this.onError?.("The 3D view lost its graphics context; it comes back when the browser restores it.");
    });
    r.domElement.addEventListener("webglcontextrestored", () => {
      if (r !== this.renderer) return;
      this.onError?.(null);
      this.invalidate();
    });
    this.container.appendChild(r.domElement);
    this.renderer = r;
    this.envReady = false;
    for (const m of this.materials.values()) m.needsUpdate = true;

    const c = new OrbitControls(this.camera, r.domElement);
    c.target.copy(this.target);
    c.enableDamping = Boolean(this.settings.smooth) && this.settings.shading === "realistic";
    c.dampingFactor = 0.18;
    c.addEventListener("change", () => this.invalidate());
    this.controls = c;
    this._resize();
    this._applyEnvironment();
  }

  /** Ask for one frame. Frames are spaced to at most `hz` per second. */
  invalidate = () => {
    this.dirty = true;
    this._schedule();
  };

  _schedule() {
    if (this.raf || this.timer || this.disposed || !this.visible) return;
    const wait = this.lastFrame + 1000 / Math.max(1, this.settings.hz || 30) - now();
    if (wait > 1) {
      this.timer = setTimeout(() => {
        this.timer = 0;
        this._schedule();
      }, wait);
    } else this.raf = requestAnimationFrame(this._frame);
  }

  _frame = () => {
    this.raf = 0;
    if (!this.dirty || !this.visible || this.disposed) return;
    this.dirty = false;
    const t = now();
    this.lastFrame = t;
    let more = this._stepInterp(t);
    if (this.controls.enableDamping && this.controls.update()) more = true;
    this.renderer.render(this.scene, this.camera);
    this.frames += 1;
    this.renderMs += now() - t;
    if (more) this.invalidate();
  };

  _emitStats() {
    if (!this.onStats || !this.settings.showStats) {
      this.frames = 0;
      this.renderMs = 0;
      return;
    }
    const info = this.renderer.info.render;
    this.onStats({
      fps: this.frames,
      ms: this.frames ? this.renderMs / this.frames : 0,
      triangles: info.triangles,
      calls: info.calls,
      paused: !this.visible,
    });
    this.frames = 0;
    this.renderMs = 0;
  }

  _observe() {
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(this.container);
    this._io = new IntersectionObserver((entries) => {
      this.onScreen = entries.some((e) => e.isIntersecting);
      this._updateVisible();
    });
    this._io.observe(this.container);
    this._onVis = () => this._updateVisible();
    document.addEventListener("visibilitychange", this._onVis);
  }

  _updateVisible() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const vis = !document.hidden && this.onScreen && w > 0 && h > 0;
    if (vis === this.visible) return;
    this.visible = vis;
    if (vis) this.invalidate();
    else {
      cancelAnimationFrame(this.raf);
      clearTimeout(this.timer);
      this.raf = 0;
      this.timer = 0;
    }
  }

  _resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this._updateVisible();
    if (!w || !h || !this.renderer) return;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(Math.min(dpr, this.settings.resolution || 1));
    this.renderer.setSize(w, h, true);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  // ───────────────────────── stage ─────────────────────────

  _buildStage() {
    const s = this.scene;
    this.hemi = new HemisphereLight(0xffffff, 0x6b6f78, 1);
    this.hemi.up.set(0, 0, 1);
    this.hemi.position.set(0, 0, 1);
    s.add(this.hemi);
    this.ambient = new AmbientLight(0xffffff, 0);
    s.add(this.ambient);
    this.sun = new DirectionalLight(0xffffff, 1.5);
    this.sun.position.set(2.5, 1.6, 4);
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.left = -1.6;
    this.sun.shadow.camera.right = 1.6;
    this.sun.shadow.camera.top = 1.6;
    this.sun.shadow.camera.bottom = -1.6;
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = 10;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    s.add(this.sun, this.sun.target);
    this.fill = new DirectionalLight(0xffffff, 0.6);
    this.fill.position.set(-2.5, -2, 1.5);
    s.add(this.fill);

    // Unlit floor in the theme colour (cheapest); shadows go on a separate transparent plane.
    this.floor = new Mesh(new PlaneGeometry(8, 8), new MeshBasicMaterial({ color: 0x2a2c31, toneMapped: false }));
    this.floor.position.z = -0.002;
    this.shadowFloor = new Mesh(new PlaneGeometry(8, 8), new ShadowMaterial({ opacity: 0.22 }));
    this.shadowFloor.position.z = -0.001;
    this.shadowFloor.receiveShadow = true;
    s.add(this.floor, this.shadowFloor);
    this.grid = new GridHelper(4, 20, 0x5b5ef4, 0x3a3d45);
    this.grid.rotation.x = Math.PI / 2;
    this.grid.material.toneMapped = false;
    s.add(this.grid);
    this.baseAxes = new AxesHelper(0.25);
    this.baseAxes.position.z = 0.002;
    s.add(this.baseAxes);

    this.robotRoot = new Group();
    this.ghostRoot = new Group();
    this.ghostRoot.visible = false;
    s.add(this.robotRoot, this.ghostRoot);
    this.ghostMaterial = new MeshBasicMaterial({ color: 0x6366f1, transparent: true, opacity: 0.32, depthWrite: false });

    // Jog preview: one straight arrow, one curved arrow, reused.
    this.previewGroup = new Group();
    this.previewGroup.visible = false;
    const arrowMat = new MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true });
    this.arrowMat = arrowMat;
    this.lineArrow = new Group();
    const shaft = new Mesh(new CylinderGeometry(0.008, 0.008, 0.16, 10), arrowMat);
    shaft.position.y = 0.08;
    const head = new Mesh(new ConeGeometry(0.022, 0.05, 14), arrowMat);
    head.position.y = 0.185;
    this.lineArrow.add(shaft, head);
    this.arcArrow = new Group();
    const arc = new Mesh(new TorusGeometry(0.11, 0.007, 6, 40, Math.PI * 1.4), arrowMat);
    const tip = new Mesh(new ConeGeometry(0.02, 0.045, 12), arrowMat);
    const a = Math.PI * 1.4;
    tip.position.set(0.11 * Math.cos(a), 0.11 * Math.sin(a), 0);
    tip.rotation.z = a;
    this.arcArrow.add(arc, tip);
    this.previewGroup.add(this.lineArrow, this.arcArrow);
    this.previewGroup.renderOrder = 10;
    s.add(this.previewGroup);

    // Teach points: one small ball and one name label per point.
    this.pointsGroup = new Group();
    this.pointsGroup.visible = this.settings.points !== false;
    s.add(this.pointsGroup);
    this.pointBall = new SphereGeometry(0.014, 14, 10);
    this.pointMat = new MeshBasicMaterial({ color: 0xf5a524 });
    this.pointMatCurrent = new MeshBasicMaterial({ color: 0x30a46c });
    this.points = [];
  }

  _applyEnvironment() {
    const st = this.settings;
    const L = LIGHTS[st.lighting] || LIGHTS.studio;
    const b = Number(st.brightness) || 1;
    // Realistic materials also get light from the environment map.
    const env = st.shading === "realistic";
    this.hemi.intensity = L.hemi * b * (env ? 0.4 : 1);
    this.sun.intensity = L.key * b * (env ? 0.9 : 1);
    this.fill.intensity = L.fill * b;
    this.fill.visible = L.fill > 0;
    this.sun.castShadow = Boolean(st.shadows);
    this.renderer.shadowMap.enabled = Boolean(st.shadows);
    this.shadowFloor.visible = Boolean(st.shadows);
    this.floor.visible = st.floor !== false;
    this.grid.visible = st.grid !== false;
    this.baseAxes.visible = st.axes !== false;
    if (this.tcpAxes) this.tcpAxes.visible = st.tcpFrame !== false;
    this.robotRoot.traverse((o) => {
      if (o.isMesh) o.castShadow = Boolean(st.shadows);
    });
    // Image-based light only for the realistic materials (built once).
    if (st.shading === "realistic" && !this.envReady) {
      const pm = new PMREMGenerator(this.renderer);
      this.envMap = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      pm.dispose();
      this.envReady = true;
    }
    this.scene.environment = st.shading === "realistic" ? this.envMap : null;
    this._paint();
  }

  /** Scene colours: { bg, floor, grid, center } (theme), unless a custom background is set. */
  setColors(colors) {
    this.colors = { ...this.colors, ...colors };
    this._paint();
    this.invalidate();
  }

  _paint() {
    const c = this.colors;
    const bg = this.settings.background || c.bg;
    if (bg) this.scene.background.set(bg);
    if (c.floor) this.floor.material.color.set(this.settings.background ? new Color(bg).offsetHSL(0, 0, 0.03) : c.floor);
    if (c.grid || c.center) {
      const cols = this.grid.geometry.attributes.color;
      if (!this.grid.userData.centre) {
        // The centre lines were created brighter (see _buildStage).
        const sums = Array.from({ length: cols.count }, (_, i) => cols.getX(i) + cols.getY(i) + cols.getZ(i));
        const mid = (Math.max(...sums) + Math.min(...sums)) / 2;
        this.grid.userData.centre = sums.map((v) => v > mid);
      }
      const g = new Color(c.grid || "#3a3d45");
      const m = new Color(c.center || "#5b5ef4");
      for (let i = 0; i < cols.count; i++) {
        const v = this.grid.userData.centre[i] ? m : g;
        cols.setXYZ(i, v.r, v.g, v.b);
      }
      cols.needsUpdate = true;
    }
  }

  // ───────────────────────── settings ─────────────────────────

  setSettings(next) {
    const prev = this.settings;
    this.settings = { ...next };
    if (prev.antialias !== next.antialias || (prev.shading === "realistic") !== (next.shading === "realistic")) this._createRenderer();
    else if (prev.resolution !== next.resolution) this._resize();
    if (prev.shading !== next.shading || prev.colorMode !== next.colorMode || prev.color !== next.color) this._rebuildMaterials();
    if (prev.shadows !== next.shadows) for (const m of this.materials.values()) m.needsUpdate = true;
    this.controls.enableDamping = Boolean(next.smooth) && next.shading === "realistic";
    if (prev.detail !== next.detail && this.model) this._loadMeshes();
    this.pointsGroup.visible = next.points !== false;
    this._applyEnvironment();
    this.invalidate();
  }

  _material(rgba) {
    const st = this.settings;
    const hex = st.colorMode === "custom" ? st.color : rgba ? `#${new Color().setRGB(rgba[0], rgba[1], rgba[2], SRGBColorSpace).getHexString()}` : "#c9d1ee"; // URDF colours are sRGB, as RViz shows them
    const key = `${st.shading}|${hex}`;
    let m = this.materials.get(key);
    if (!m) {
      // Double-sided: CAD exports often have triangles wound the wrong way.
      if (st.shading === "flat") m = new MeshLambertMaterial({ color: hex, side: DoubleSide });
      else if (st.shading === "realistic") m = new MeshStandardMaterial({ color: hex, metalness: 0.3, roughness: 0.45, envMapIntensity: 0.3, side: DoubleSide });
      else m = new MeshPhongMaterial({ color: hex, shininess: 45, specular: 0x2a2a2a, side: DoubleSide });
      m.shadowSide = BackSide; // back faces into the shadow map: no self-shadow stripes
      this.materials.set(key, m);
    }
    return m;
  }

  _rebuildMaterials() {
    const old = [...this.materials.values()];
    this.materials.clear();
    for (const v of this.visualMeshes) v.mesh.material = this._material(v.rgba);
    old.forEach((m) => m.dispose());
  }

  // ───────────────────────── robot model ─────────────────────────

  /** Builds the robot from a model (see backend/robotModel/urdf.js). */
  setModel(model) {
    const first = !this.model;
    this.model = model;
    this.robotRoot.clear();
    this.ghostRoot.clear();
    this.visualMeshes = [];
    try {
      this.chain = new Chain(model);
    } catch {
      this.chain = null;
    }
    this.robot = this._buildRig(model, this.robotRoot, false);
    this.ghost = this._buildRig(model, this.ghostRoot, true);
    const dof = this.chain?.dof || 0;
    this.q = Array.from({ length: dof }, (_, i) => this.qTarget[i] ?? 0);
    this.qTarget = [...this.q];
    this._applyFk(this.robot, this.q);
    this._layoutPoints(); // point positions follow the model's kinematics
    // TCP frame on the tool link
    this.tcpAxes = new AxesHelper(0.12);
    this.tcpAxes.visible = this.settings.tcpFrame !== false;
    this.robot.links.get(this.chain?.tip)?.add(this.tcpAxes);
    this._applyEnvironment();
    this._loadMeshes().then(() => {
      if (first || this._reframeOnLoad) this.frame();
      this._reframeOnLoad = false;
    });
    if (!first) this._reframeOnLoad = true;
    this.invalidate();
  }

  _buildRig(model, root, isGhost) {
    const links = new Map();
    const joints = new Map();
    for (const l of model.links) {
      const g = new Group();
      g.name = l.name;
      links.set(l.name, g);
      for (const v of l.visuals) {
        const holder = new Group();
        holder.position.fromArray(v.origin.xyz);
        holder.quaternion.copy(toQuat(v.origin.rpy));
        const geo = v.geometry;
        let mesh;
        const mat = isGhost ? this.ghostMaterial : this._material(v.color);
        if (geo.type === "mesh") {
          mesh = new Mesh(undefined, mat);
          mesh.scale.fromArray(geo.scale || [1, 1, 1]);
          mesh.visible = false; // until its geometry has loaded
          this.visualMeshes.push({ mesh, meshId: geo.mesh, rgba: v.color, ghost: isGhost });
        } else if (geo.type === "box") mesh = new Mesh(new BoxGeometry(...geo.size), mat);
        else if (geo.type === "cylinder") {
          mesh = new Mesh(new CylinderGeometry(geo.radius, geo.radius, geo.length, 24), mat);
          mesh.rotation.x = Math.PI / 2;
        } else if (geo.type === "sphere") mesh = new Mesh(new SphereGeometry(geo.radius, 20, 14), mat);
        if (!mesh) continue;
        if (!isGhost && geo.type !== "mesh") this.visualMeshes.push({ mesh, rgba: v.color, ghost: false });
        if (isGhost) mesh.renderOrder = 5;
        holder.add(mesh);
        g.add(holder);
      }
    }
    for (const j of model.joints) {
      const parent = links.get(j.parent);
      const child = links.get(j.child);
      if (!parent || !child) continue;
      const origin = new Group();
      origin.position.fromArray(j.origin.xyz);
      origin.quaternion.copy(toQuat(j.origin.rpy));
      const pivot = new Group();
      origin.add(pivot);
      pivot.add(child);
      parent.add(origin);
      joints.set(j.name, { pivot, origin, axis: new Vector3().fromArray(j.axis).normalize(), type: j.type });
    }
    const rootLink = links.get(model.root);
    if (rootLink) root.add(rootLink);
    return { links, joints };
  }

  async _loadMeshes() {
    const detail = this.settings.detail || "medium";
    const model = this.model;
    await Promise.all(
      this.visualMeshes
        .filter((v) => v.meshId)
        .map((v) =>
          loadMesh(v.meshId, detail, model.stamp)
            .then((g) => {
              if (this.model !== model || this.disposed) return;
              v.mesh.geometry = g;
              v.mesh.visible = true;
              v.mesh.castShadow = !v.ghost && Boolean(this.settings.shadows);
              this.invalidate();
            })
            .catch((err) => console.warn("[3d] mesh failed", err))
        )
    );
  }

  /** Points the camera at the whole robot. */
  frame() {
    const box = new Box3().setFromObject(this.robotRoot);
    if (box.isEmpty()) return;
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.6 + 0.1;
    // Fit both ways: a narrow column is limited by the horizontal field of view.
    const vfov = (this.camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const dist = (radius / Math.sin(Math.min(vfov, hfov) / 2)) * 1.02;
    const dir = new Vector3(1, 0.75, 0.55).normalize();
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.camera.near = Math.max(0.01, dist / 100);
    this.camera.far = dist * 20;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.invalidate();
  }

  // ───────────────────────── joints ─────────────────────────

  _applyFk(rig, q) {
    if (!this.chain || !rig) return;
    this.chain.names.forEach((name, i) => {
      const j = rig.joints.get(name);
      if (!j) return;
      const v = q[i] || 0;
      if (j.type === "prismatic") j.pivot.position.copy(j.axis).multiplyScalar(v);
      else j.pivot.quaternion.setFromAxisAngle(j.axis, v);
    });
  }

  /** Joint positions in radians, in chain order (joint1..joint6). */
  setJoints(positions) {
    if (!Array.isArray(positions)) return;
    const next = positions.map(Number);
    const changed = next.some((v, i) => Math.abs(v - (this.qTarget[i] ?? 0)) > EPS);
    if (!changed) return;
    const t = now();
    const gap = t - this.lastJointAt;
    this.lastJointAt = t;
    this.qTarget = next;
    if (this.settings.smooth && gap < 1000 && this.q.length) {
      this.interp = { from: [...this.q], t0: t, dur: Math.min(400, Math.max(60, gap)) };
    } else {
      this.interp = null;
      this.q = [...next];
      this._applyFk(this.robot, this.q);
    }
    if (this.jog.active) this._showPreview();
    this.invalidate();
  }

  _stepInterp(t) {
    const it = this.interp;
    if (!it) return false;
    const k = Math.min(1, (t - it.t0) / it.dur);
    this.q = this.qTarget.map((v, i) => (it.from[i] ?? v) + (v - (it.from[i] ?? v)) * k);
    this._applyFk(this.robot, this.q);
    if (k >= 1) this.interp = null;
    return k < 1;
  }

  // ───────────────────────── jog preview ─────────────────────────

  setJogMode(mode) {
    this.jog.mode = mode === "ghost" ? "ghost" : "arrows";
    if (this.jog.active) this._showPreview();
    this.invalidate();
  }

  setJogFrame(frame) {
    this.jog.frame = frame || "base_link";
    if (this.jog.active) this._showPreview();
  }

  /** Preview of a Cartesian jog: cmd "+cx", "-cy", "+cr" (roll), "+cp", "+cw" (yaw). */
  previewJog(cmd) {
    const m = /^([+-])c([xyzrpw])$/.exec(cmd || "");
    if (!m) return;
    this.jog.active = { kind: "cart", sign: m[1] === "-" ? -1 : 1, axis: m[2] };
    this._showPreview();
  }

  /** Preview of a joint jog: index 0..5, sign ±1, degrees for the ghost. */
  previewJointJog(idx, sign, deg = 15) {
    this.jog.active = { kind: "joint", idx, sign: sign < 0 ? -1 : 1, deg };
    this._showPreview();
  }

  clearJog() {
    this.jog.active = null;
    this.previewGroup.visible = false;
    this.ghostRoot.visible = false;
    this.invalidate();
  }

  _toolFrame() {
    const f = this.jog.frame;
    return f === "end" || f === "tool0" || f === "tcp" || f === this.chain?.tip;
  }

  _showPreview() {
    const a = this.jog.active;
    if (!a || !this.robot || !this.chain) return;
    this.robotRoot.updateMatrixWorld(true);
    const tipObj = this.robot.links.get(this.chain.tip);
    const tcpPos = tipObj ? tipObj.getWorldPosition(new Vector3()) : new Vector3();
    const tcpQuat = tipObj ? tipObj.getWorldQuaternion(new Quaternion()) : new Quaternion();
    let ghostQ = null;
    this.lineArrow.visible = false;
    this.arcArrow.visible = false;

    if (a.kind === "joint") {
      const name = this.chain.names[a.idx];
      const j = this.robot.joints.get(name);
      if (!j) return;
      const pos = j.origin.getWorldPosition(new Vector3());
      const axis = j.axis.clone().applyQuaternion(j.origin.getWorldQuaternion(new Quaternion())).normalize();
      this.arrowMat.color.setHex(0xf5a524);
      if (j.type === "prismatic") this._placeLine(pos, axis.multiplyScalar(a.sign));
      else this._placeArc(pos, axis, a.sign);
      ghostQ = this.q.map((v, i) => (i === a.idx ? v + (a.sign * a.deg * Math.PI) / 180 : v));
    } else {
      const lin = "xyz".includes(a.axis);
      const k = { x: 0, y: 1, z: 2, r: 0, p: 1, w: 2 }[a.axis];
      const dir = new Vector3(k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0);
      if (this._toolFrame()) dir.applyQuaternion(tcpQuat);
      this.arrowMat.color.setHex(AXIS_COLOR["xyz"[k]]);
      if (lin) this._placeLine(tcpPos, dir.clone().multiplyScalar(a.sign));
      else this._placeArc(tcpPos, dir, a.sign);
      if (this.jog.mode === "ghost") ghostQ = this._cartGhost(dir, lin, a.sign);
    }
    if (this.jog.mode === "ghost" && ghostQ) {
      this._applyFk(this.ghost, this.chain.clamp(ghostQ));
      this.ghostRoot.visible = true;
      this.previewGroup.visible = true;
      this.previewGroup.scale.setScalar(0.8);
    } else {
      this.ghostRoot.visible = false;
      this.previewGroup.visible = true;
      this.previewGroup.scale.setScalar(1);
    }
    this.invalidate();
  }

  /** Joint values after a small Cartesian step (inverse kinematics), or null. */
  _cartGhost(dir, linear, sign) {
    const T = this.chain.fk(this.q);
    let G;
    if (linear) {
      G = [...T];
      G[3] += dir.x * CART_STEP_M * sign;
      G[7] += dir.y * CART_STEP_M * sign;
      G[11] += dir.z * CART_STEP_M * sign;
    } else {
      const R = axisAngle([dir.x, dir.y, dir.z], CART_STEP_RAD * sign);
      const rot = mul(R, [T[0], T[1], T[2], 0, T[4], T[5], T[6], 0, T[8], T[9], T[10], 0, 0, 0, 0, 1]);
      G = [rot[0], rot[1], rot[2], T[3], rot[4], rot[5], rot[6], T[7], rot[8], rot[9], rot[10], T[11], 0, 0, 0, 1];
    }
    return this.chain.ik(G, this.q, { iters: 80, tolPos: 2e-3, tolRot: 1e-2 });
  }

  _placeLine(pos, dir) {
    this.lineArrow.visible = true;
    this.lineArrow.position.copy(pos);
    this.lineArrow.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir.clone().normalize());
  }

  _placeArc(pos, axis, sign) {
    this.arcArrow.visible = true;
    this.arcArrow.position.copy(pos);
    this.arcArrow.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), axis.clone().normalize());
    this.arcArrow.scale.set(1, sign, 1); // mirror for the other direction
  }

  // ───────────────────────── teach points ─────────────────────────

  /**
   * Teach points to show: [{ name, joints?: [6 rad], xyz?: [m] }]. A point with
   * joints is placed where the tool of the shown model would be (forward
   * kinematics), so it matches the robot on screen; otherwise at its stored
   * coordinates in the base frame.
   */
  setPoints(points, current) {
    const key = JSON.stringify([points, current]);
    if (key === this._pointsKey) return;
    this._pointsKey = key;
    for (const o of this.pointsGroup.children) {
      if (o.isSprite) {
        o.material.map.dispose();
        o.material.dispose();
      }
    }
    this.pointsGroup.clear();
    this.points = (points || []).map((p) => {
      const ball = new Mesh(this.pointBall, p.name === current ? this.pointMatCurrent : this.pointMat);
      const label = this._label(p.name, p.name === current);
      this.pointsGroup.add(ball, label);
      return { ...p, ball, label };
    });
    this._layoutPoints();
    this.invalidate();
  }

  setPointsVisible(on) {
    this.pointsGroup.visible = Boolean(on);
    this.invalidate();
  }

  _layoutPoints() {
    for (const p of this.points || []) {
      let pos = null;
      if (this.chain && Array.isArray(p.joints) && p.joints.length >= this.chain.dof) {
        const T = this.chain.fk(p.joints);
        pos = [T[3], T[7], T[11]];
      } else if (Array.isArray(p.xyz)) pos = p.xyz;
      p.ball.visible = p.label.visible = Boolean(pos);
      if (!pos) continue;
      p.ball.position.fromArray(pos);
      p.label.position.set(pos[0], pos[1], pos[2] + 0.035);
    }
  }

  /** Name tag drawn once into a small texture; constant size on screen. */
  _label(text, current) {
    const px = 28;
    const c = document.createElement("canvas");
    const g = c.getContext("2d");
    const font = `600 ${px}px Inter, system-ui, sans-serif`;
    g.font = font;
    const w = Math.ceil(g.measureText(text).width) + 20;
    c.width = w;
    c.height = px + 14;
    g.font = font;
    g.fillStyle = current ? "rgba(22, 101, 52, .9)" : "rgba(17, 19, 24, .78)";
    g.beginPath();
    g.roundRect?.(0, 0, c.width, c.height, 8);
    if (!g.roundRect) g.rect(0, 0, c.width, c.height);
    g.fill();
    g.fillStyle = "#fff";
    g.textBaseline = "middle";
    g.fillText(text, 10, c.height / 2 + 1);
    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    const sprite = new Sprite(new SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false, toneMapped: false }));
    const h = 0.026; // share of the view height
    sprite.scale.set((h * c.width) / c.height, h, 1);
    sprite.center.set(0.5, 0);
    sprite.renderOrder = 20;
    return sprite;
  }

  // ───────────────────────── cleanup ─────────────────────────

  pause() {
    this.onScreen = false;
    this._updateVisible();
  }

  resume() {
    this.onScreen = true;
    this._updateVisible();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timer);
    clearInterval(this._statsTimer);
    this._ro?.disconnect();
    this._io?.disconnect();
    document.removeEventListener("visibilitychange", this._onVis);
    this.controls?.dispose();
    this.materials.forEach((m) => m.dispose());
    this.envMap?.dispose();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss?.();
    this.renderer?.domElement.remove();
  }
}

