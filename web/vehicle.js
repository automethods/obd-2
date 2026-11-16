/* Original offline 3D teaching renderer. No CDN or third-party runtime. */
(function () {
  'use strict';

  const TAU = Math.PI * 2;
  const FALLBACK_POSITIONS = {
    engine: [0, .85, -1.26], ecu: [.63, 1.08, -1.25], coolant_sensor: [-.46, 1.04, -1.25],
    battery: [0, .64, .63], bmu: [.72, .88, .65], abs: [-.70, .91, -.68],
    supervisor: [.36, 1.05, -.55], dlc: [-.67, 1.05, -.13], scan_tool: [-2.10, .85, -.30],
    wheel_fl: [-1.04, .45, -1.4], wheel_fr: [1.04, .45, -1.4],
    wheel_rl: [-1.04, .45, 1.4], wheel_rr: [1.04, .45, 1.4]
  };
  const LABELS = {engine: 'Engine', ecu: 'Engine ECU', coolant_sensor: 'Coolant sensor', battery: 'HV battery',
    bmu: 'Battery monitor', abs: 'ABS controller', supervisor: 'Vehicle controller', dlc: 'DLC socket',
    scan_tool: 'Scan tool', wheel_fl: 'Front-left wheel', wheel_fr: 'Front-right wheel',
    wheel_rl: 'Rear-left wheel', wheel_rr: 'Rear-right wheel'};
  const DEFAULT_BINDINGS = {
    schema: 'obdii-lab.vehicle-bindings.v1',
    components: Object.fromEntries(Object.keys(FALLBACK_POSITIONS).map(id => [id, {node: id, object_id: id}])),
    wheels: ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'].map((id, i) => ({node: id, object_id: id,
      signal_path: `wheel_speeds_kph.${i}`, measurement_path: `sensors.wheel_speeds_kph.${i}`, axis: 'x', direction: -1, radius_m: .31})),
    body_nodes: [], connections: {coolant_sensor: 'ect', dlc: 'dlc', scan_tool: 'dlc', bmu: 'bmu', wheel_fl: 'wheel_fl'}
  };
  const DEFAULT_WIRES = [
    ['ect_signal', 'coolant_sensor', 'ecu', 'ect', '#d99516'],
    ['ect_return', 'coolant_sensor', 'ecu', 'ect', '#64748b'],
    ['dlc_can_h', 'dlc', 'ecu', 'dlc', '#00a9b5'], ['dlc_can_l', 'dlc', 'ecu', 'dlc', '#8171d8'],
    ['dlc_power', 'dlc', 'scan_tool', null, '#e2695b'], ['dlc_ground', 'dlc', 'scan_tool', null, '#64748b'],
    ['bmu_can_h', 'bmu', 'supervisor', 'bmu', '#00a9b5'], ['bmu_can_l', 'bmu', 'supervisor', 'bmu', '#8171d8'],
    ['wheel_fl_signal', 'wheel_fl', 'abs', 'wheel_fl', '#d99516'],
    ['wheel_fr_signal', 'wheel_fr', 'abs', null, '#d99516'],
    ['wheel_rl_signal', 'wheel_rl', 'abs', null, '#d99516'],
    ['wheel_rr_signal', 'wheel_rr', 'abs', null, '#d99516']
  ];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const finite = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
  const identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = a => { const d = Math.hypot(...a) || 1; return a.map(v => v / d); };
  function multiply(a, b) {
    const out = new Float32Array(16);
    for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++)
      for (let k = 0; k < 4; k++) out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
    return out;
  }
  function transform(m, p, w = 1) {
    return [0, 1, 2, 3].map(r => m[r] * p[0] + m[r + 4] * p[1] + m[r + 8] * p[2] + m[r + 12] * w);
  }
  function trs(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
    const [x, y, z, w] = q, x2 = x + x, y2 = y + y, z2 = z + z;
    return new Float32Array([
      (1 - y * y2 - z * z2) * s[0], (x * y2 + w * z2) * s[0], (x * z2 - w * y2) * s[0], 0,
      (x * y2 - w * z2) * s[1], (1 - x * x2 - z * z2) * s[1], (y * z2 + w * x2) * s[1], 0,
      (x * z2 + w * y2) * s[2], (y * z2 - w * x2) * s[2], (1 - x * x2 - y * y2) * s[2], 0,
      ...t, 1
    ]);
  }
  function rotation(axis, angle) {
    const q = [0, 0, 0, Math.cos(angle / 2)];
    q[{x: 0, y: 1, z: 2}[axis] ?? 0] = Math.sin(angle / 2);
    return trs(undefined, q);
  }
  function lookAt(eye, target) {
    const z = norm(sub(eye, target)), x = norm(cross([0, 1, 0], z)), y = cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0,
      x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
  }
  function perspective(aspect, near = .05, far = 300) {
    const f = 1 / Math.tan(42 * Math.PI / 360), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0]);
  }
  function readPath(obj, path) {
    for (const part of String(path).split('.')) {
      if (obj == null || !Object.prototype.hasOwnProperty.call(obj, part)) return null;
      obj = obj[part];
    }
    return typeof obj === 'number' && Number.isFinite(obj) ? obj : null;
  }

  function parseGLB(buffer) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 28 || buffer.byteLength > 12 * 1024 * 1024)
      throw new Error('Choose a GLB file smaller than 12 MB.');
    const view = new DataView(buffer);
    if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== buffer.byteLength)
      throw new Error('This is not a complete glTF 2.0 GLB file.');
    let doc, binary;
    for (let at = 12; at < buffer.byteLength;) {
      if (at + 8 > buffer.byteLength) throw new Error('Incomplete GLB chunk header.');
      const size = view.getUint32(at, true), type = view.getUint32(at + 4, true);
      at += 8;
      if (size % 4 || at + size > buffer.byteLength) throw new Error('Invalid GLB chunk length.');
      if (type === 0x4e4f534a) {
        if (doc) throw new Error('Duplicate GLB JSON chunk.');
        doc = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, at, size)).trim());
      } else if (type === 0x004e4942) {
        if (binary) throw new Error('Duplicate GLB binary chunk.');
        binary = new DataView(buffer, at, size);
      }
      at += size;
    }
    if (!doc || !binary || doc.asset?.version !== '2.0') throw new Error('GLB needs embedded geometry.');
    if (doc.extensionsRequired?.length || doc.skins?.length || doc.animations?.length || doc.textures?.length)
      throw new Error('This compact viewer accepts uncompressed static geometry and base colors. Use the Three.js adapter for textures, skins, animation clips or extensions.');
    if (!Array.isArray(doc.buffers) || doc.buffers.length !== 1 || doc.buffers[0].uri || doc.buffers[0].byteLength > binary.byteLength)
      throw new Error('Only one embedded GLB buffer is supported.');
    if (!Array.isArray(doc.nodes) || doc.nodes.length > 800 || !Array.isArray(doc.meshes) || doc.meshes.length > 400)
      throw new Error('GLB must contain fewer than 800 nodes and 400 meshes.');
    let totalVertices = 0;
    function accessor(index, expected) {
      const a = doc.accessors?.[index], b = doc.bufferViews?.[a?.bufferView];
      if (!a || !b || a.sparse || a.type !== expected || b.buffer !== 0)
        throw new Error('Unsupported or missing GLB accessor.');
      const size = {5121: 1, 5123: 2, 5125: 4, 5126: 4}[a.componentType];
      const count = expected === 'VEC3' ? 3 : 1;
      if (!size || (expected === 'VEC3' && a.componentType !== 5126) || !Number.isInteger(a.count) || a.count < 1 || a.count > 1000000)
        throw new Error('Unsupported GLB component format or vertex count.');
      const start = (b.byteOffset || 0) + (a.byteOffset || 0), stride = b.byteStride || count * size;
      const end = start + (a.count - 1) * stride + count * size;
      if (start < 0 || stride < count * size || end > binary.byteLength || end > (b.byteOffset || 0) + b.byteLength)
        throw new Error('GLB data falls outside its buffer.');
      const data = expected === 'VEC3' ? new Float32Array(a.count * count) : new Uint32Array(a.count);
      const reader = {5121: 'getUint8', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32'}[a.componentType];
      for (let i = 0; i < a.count; i++) for (let c = 0; c < count; c++) {
        const value = binary[reader](start + i * stride + c * size, true);
        if (!Number.isFinite(value)) throw new Error('GLB contains non-finite geometry.');
        data[i * count + c] = value;
      }
      return data;
    }
    const meshes = doc.meshes.map(mesh => {
      if (!Array.isArray(mesh.primitives) || mesh.primitives.length > 50) throw new Error('Invalid mesh primitives.');
      return mesh.primitives.map(primitive => {
        if ((primitive.mode ?? 4) !== 4 || primitive.targets || primitive.extensions)
          throw new Error('Only uncompressed triangle meshes are supported.');
        const positions = accessor(primitive.attributes?.POSITION, 'VEC3');
        totalVertices += positions.length / 3;
        if (totalVertices > 1000000) throw new Error('Model exceeds one million vertices.');
        const indices = primitive.indices == null ? Uint32Array.from({length: positions.length / 3}, (_, i) => i)
          : accessor(primitive.indices, 'SCALAR');
        if (indices.length % 3 || indices.some(i => i >= positions.length / 3)) throw new Error('Invalid triangle indices.');
        let normals = primitive.attributes.NORMAL == null ? null : accessor(primitive.attributes.NORMAL, 'VEC3');
        if (normals && normals.length !== positions.length) throw new Error('Normal count does not match positions.');
        if (!normals) {
          normals = new Float32Array(positions.length);
          for (let i = 0; i < indices.length; i += 3) {
            const ids = [indices[i], indices[i + 1], indices[i + 2]],
              p = ids.map(j => Array.from(positions.slice(j * 3, j * 3 + 3))), n = cross(sub(p[1], p[0]), sub(p[2], p[0]));
            for (const id of ids) for (let c = 0; c < 3; c++) normals[id * 3 + c] += n[c];
          }
          for (let i = 0; i < normals.length; i += 3) normals.set(norm(Array.from(normals.slice(i, i + 3))), i);
        }
        const mat = doc.materials?.[primitive.material] || {}, color = mat.pbrMetallicRoughness?.baseColorFactor || [.45, .56, .68, 1];
        if (!Array.isArray(color) || color.length !== 4 || color.some(v => !Number.isFinite(v))) throw new Error('Invalid material color.');
        return {positions, normals, indices, color: color.map(v => clamp(v, 0, 1)), material: mat.name || '', gpu: null};
      });
    });
    const nodes = doc.nodes.map((node, index) => {
      for (const [key, size] of [['translation', 3], ['rotation', 4], ['scale', 3], ['matrix', 16]]) {
        if (node[key] && (!Array.isArray(node[key]) || node[key].length !== size || node[key].some(v => !Number.isFinite(v))))
          throw new Error('Invalid node transform.');
      }
      if (node.mesh != null && !meshes[node.mesh]) throw new Error('Node references an absent mesh.');
      return {...node, index, name: String(node.name || `node_${index}`), children: node.children || [],
        rest: node.matrix ? new Float32Array(node.matrix) : trs(node.translation, node.rotation, node.scale)};
    });
    const roots = doc.scenes?.[doc.scene || 0]?.nodes || nodes.map(n => n.index).filter(i => !nodes.some(n => n.children.includes(i)));
    const visited = new Set();
    function validate(index, path) {
      if (!Number.isInteger(index) || !nodes[index] || path.has(index)) throw new Error('Invalid or cyclic node hierarchy.');
      if (visited.has(index)) throw new Error('A GLB node cannot have multiple parents.');
      visited.add(index); const next = new Set(path).add(index);
      if (!Array.isArray(nodes[index].children)) throw new Error('Invalid GLB child list.');
      for (const child of nodes[index].children) validate(child, next);
    }
    roots.forEach(i => validate(i, new Set()));
    if (!visited.size) throw new Error('GLB scene is empty.');
    return {nodes, meshes, roots, vertices: totalVertices, name: 'Vehicle model'};
  }

  function validateBindings(raw) {
    if (!raw || raw.schema !== 'obdii-lab.vehicle-bindings.v1') throw new Error('Choose an obdii-lab.vehicle-bindings.v1 JSON file.');
    if (raw.components && (typeof raw.components !== 'object' || Array.isArray(raw.components))) throw new Error('Bindings components must be an object.');
    const components = raw.components || {};
    for (const [id, binding] of Object.entries(components)) {
      if (id.length > 100 || !binding || typeof binding.node !== 'string' || binding.node.length > 200)
        throw new Error('Each component binding needs a short node name.');
    }
    if (raw.wheels && (!Array.isArray(raw.wheels) || raw.wheels.length > 12)) throw new Error('Wheel bindings must be an array.');
    const wheels = (raw.wheels || []).map(w => {
      if (!w || typeof w.node !== 'string' || typeof w.signal_path !== 'string' || !/^[A-Za-z0-9_.]+$/.test(w.signal_path)
        || !['x', 'y', 'z'].includes(w.axis || 'x') || ![-1, 1].includes(w.direction ?? -1) || !(w.radius_m > .01 && w.radius_m < 10))
        throw new Error('Wheel bindings need a node, signal path, axis and radius_m.');
      return {...w, axis: w.axis || 'x', direction: w.direction ?? -1};
    });
    if (raw.body_nodes && (!Array.isArray(raw.body_nodes) || raw.body_nodes.some(x => typeof x !== 'string')))
      throw new Error('body_nodes must be a list of node names.');
    return {...raw, components, wheels, body_nodes: raw.body_nodes || [], connections: raw.connections || {}};
  }

  function createRenderer(canvas) {
    let gl;
    try { gl = canvas.getContext('webgl2', {alpha: true, antialias: true, preserveDrawingBuffer: false}); } catch (_) { gl = null; }
    if (!gl) return {type: '2D fallback', gl: null};
    const vertex = `#version 300 es
      in vec3 aPosition; in vec3 aNormal; uniform mat4 uModel; uniform mat4 uVP;
      out vec3 vNormal; out vec3 vWorld;
      void main(){ vec4 p=uModel*vec4(aPosition,1.0); vWorld=p.xyz;
        vNormal=normalize(transpose(inverse(mat3(uModel)))*aNormal); gl_Position=uVP*p; }`;
    const fragment = `#version 300 es
      precision highp float; in vec3 vNormal; in vec3 vWorld; uniform vec4 uColor;
      uniform float uHighlight; uniform vec3 uEye; uniform float uGloss; out vec4 outColor;
      void main(){ vec3 n=normalize(vNormal); if(!gl_FrontFacing) n=-n;
        vec3 light=normalize(vec3(-.55,1.,-.7)); vec3 view=normalize(uEye-vWorld);
        float diffuse=max(0.,dot(n,light)); float fill=max(0.,dot(n,normalize(vec3(.8,.35,.4))));
        float spec=pow(max(0.,dot(n,normalize(light+view))),mix(22.,80.,uGloss));
        float rim=pow(1.-abs(dot(n,view)),3.);
        vec3 c=uColor.rgb*(.48+.43*diffuse+.17*fill)+vec3(1.)*spec*(.08+.38*uGloss)+vec3(.12,.18,.21)*rim*uGloss;
        c=mix(c,vec3(.22,.47,.90),uHighlight*.36);
        outColor=vec4(c,uColor.a); }`;
    function compile(type, src) {
      const shader = gl.createShader(type); gl.shaderSource(shader, src); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    }
    const program = gl.createProgram(), vs = compile(gl.VERTEX_SHADER, vertex), fs = compile(gl.FRAGMENT_SHADER, fragment);
    gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Could not initialize 3D program.');
    const locations = {position: gl.getAttribLocation(program, 'aPosition'), normal: gl.getAttribLocation(program, 'aNormal'),
      model: gl.getUniformLocation(program, 'uModel'), vp: gl.getUniformLocation(program, 'uVP'),
      color: gl.getUniformLocation(program, 'uColor'), highlight: gl.getUniformLocation(program, 'uHighlight'),
      eye: gl.getUniformLocation(program, 'uEye'), gloss: gl.getUniformLocation(program, 'uGloss')};
    function upload(geometry) {
      if (geometry.gpu) return;
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      const buffers = [];
      for (const [attribute, array] of [[locations.position, geometry.positions], [locations.normal, geometry.normals]]) {
        const buffer = gl.createBuffer(); buffers.push(buffer); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, array, gl.STATIC_DRAW); gl.enableVertexAttribArray(attribute);
        gl.vertexAttribPointer(attribute, 3, gl.FLOAT, false, 0, 0);
      }
      const index = gl.createBuffer(); buffers.push(index); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geometry.indices, gl.STATIC_DRAW);
      geometry.gpu = {vao, buffers};
    }
    function release(model) {
      for (const geometry of model?.meshes.flat() || []) if (geometry.gpu) {
        geometry.gpu.buffers.forEach(b => gl.deleteBuffer(b)); gl.deleteVertexArray(geometry.gpu.vao); geometry.gpu = null;
      }
    }
    return {type: 'WebGL2 · 3D', gl, release,
      draw(items, vp, opacity, selected, eye) {
        gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
        gl.useProgram(program); gl.uniformMatrix4fv(locations.vp, false, vp); gl.uniform3fv(locations.eye, eye);
        const alpha = i => i.body ? opacity * (i.geometry.material === 'glass' ? .84 : 1) : (i.cabin ? Math.min(1,opacity*1.4) : i.geometry.color[3]);
        const opaque = items.filter(i => alpha(i) >= .99);
        const transparent = items.filter(i => alpha(i) < .99 && alpha(i) > .005).sort((a, b) => b.depth - a.depth);
        for (const [pass, list] of [[0, opaque], [1, transparent]]) {
          if (pass) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); }
          else { gl.disable(gl.BLEND); gl.depthMask(true); }
          for (const item of list) {
            const g = item.geometry; upload(g); gl.bindVertexArray(g.gpu.vao);
            gl.uniformMatrix4fv(locations.model, false, item.world);
            const color = [...g.color]; color[3] = alpha(item);
            if (item.inactive && !item.body) { color[0] = color[0] * .5 + .33; color[1] = color[1] * .5 + .33; color[2] = color[2] * .5 + .33; }
            gl.uniform4fv(locations.color, color); gl.uniform1f(locations.highlight, item.component === selected ? 1 : 0);
            gl.uniform1f(locations.gloss, ['body','glass','chrome','hub'].includes(g.material) ? .9 : .15);
            gl.drawElements(gl.TRIANGLES, g.indices.length, gl.UNSIGNED_INT, 0);
          }
        }
        gl.depthMask(true); gl.bindVertexArray(null);
      },
      dispose() { gl.deleteProgram(program); }
    };
  }

  function create(container, options = {}) {
    if (!container) throw new Error('VehicleView needs a container.');
    container.classList.add('vehicle-view');
    const compact = !!options.compact, locator = !!options.locator; let darkTheme = options.theme === 'dark'; container.classList.toggle('vv-compact', compact); container.classList.toggle('vv-dark',darkTheme);container.classList.toggle('vv-locator',locator);
    container.innerHTML = `<div class="vv-toolbar"><div class="vv-view-title"><span class="vv-kicker">LIVE VEHICLE</span><strong>${compact ? 'Your virtual vehicle' : 'Explore the vehicle'}</strong></div><div class="vv-tools"><span class="vv-renderer">Loading model…</span><button type="button" data-action="reset" title="Reset camera (Home)">Reset view</button><button type="button" data-action="top">Top view</button><button type="button" data-action="side">Side view</button></div></div>
      <div class="vv-stage"><canvas class="vv-ground" aria-hidden="true"></canvas><canvas class="vv-canvas" tabindex="0" role="img" aria-label="Vehicle component locations. Drag to rotate, scroll to zoom, arrow keys to rotate, Home to reset. Select a component in the vehicle tree or on the model."></canvas><canvas class="vv-overlay" aria-hidden="true"></canvas><div class="vv-labels"></div><div class="vv-orbit-hint">Drag to rotate <span>·</span> Scroll to zoom</div><div class="vv-orientation">FRONT</div><div class="vv-selection" hidden><strong></strong><span></span><button type="button" data-action="connection" hidden>Disconnect</button></div><div class="vv-loading">Loading the teaching vehicle…</div></div>
      <div class="vv-display-controls"><div class="vv-body-modes" role="group" aria-label="Vehicle body view"><button type="button" data-action="exterior" aria-pressed="${compact}">Exterior</button><button type="button" data-action="cutaway" aria-pressed="${!compact}">Cutaway</button></div><label class="vv-opacity">Body <input type="range" min="0" max="100" value="${compact ? 100 : 22}" aria-label="Vehicle body opacity"><output>${compact ? 100 : 22}%</output></label><label><input type="checkbox" data-option="wires" ${compact ? '' : 'checked'}> Wires</label><label><input type="checkbox" data-option="labels" ${compact ? '' : 'checked'}> Labels</label><div class="vv-legend"><span><i class="vv-live-dot"></i> Live signal</span><span><i class="vv-missing-dot"></i> Missing / open</span></div></div>
      <div class="vv-part-list" role="group" aria-label="Select vehicle component"></div>
      <p class="vv-signal-note">Wheel rotation follows physical wheel speed. Signal dots illustrate information flow; they are not electrical waveforms or CAN timing.</p>
      <details class="vv-model-details"><summary>Model & simulation bindings <span>GLB / Three.js ready</span></summary><div class="vv-model-body"><p>Load an uncompressed GLB vehicle, then bind named nodes to the same simulation signals.</p><div class="vv-model-actions"><button type="button" data-action="load-model">Load GLB</button><button type="button" data-action="load-bindings">Load bindings JSON</button><button type="button" data-action="sample">Restore sample</button><a href="/web/models/training_vehicle.glb" download>Sample GLB ↓</a><a href="/web/models/vehicle_bindings.json" download>Bindings JSON ↓</a><a href="/docs/VEHICLE_MODELS.html" target="_blank" rel="noopener">Model guide ↗</a></div><p class="vv-model-status" role="status">Waiting for model.</p><p class="vv-limit-note">This offline renderer supports embedded triangle geometry, node transforms and base colors. Textures, compressed meshes, skins and animation clips need a full renderer. The supplied Three.js adapter connects an existing Three.js scene to the same state.</p><input type="file" class="vv-model-file" accept=".glb" hidden><input type="file" class="vv-bindings-file" accept=".json,application/json" hidden></div></details>`;
    const $ = selector => container.querySelector(selector);
    const stage = $('.vv-stage'), canvas = $('.vv-canvas'), ground = $('.vv-ground'), groundContext = ground.getContext('2d'), overlay = $('.vv-overlay'), overlayContext = overlay.getContext('2d');
    let renderer;
    try { renderer = createRenderer(canvas); } catch (e) {
      const replacement = canvas.cloneNode(); canvas.replaceWith(replacement);
      renderer = {type: '2D fallback', gl: null};
    }
    const actualCanvas = $('.vv-canvas'), fallbackContext = renderer.gl ? null : actualCanvas.getContext('2d');
    $('.vv-renderer').textContent = renderer.type;
    const abort = new AbortController(), listen = (target, type, callback, extra = {}) => target.addEventListener(type, callback, {...extra, signal: abort.signal});
    let model = null, bindings = DEFAULT_BINDINGS, state = null, network = null, catalog = null,
      selected = compact || locator ? '' : 'coolant_sensor', visible = true, disposed = false, requested = false, width = 900, height = 500,
      yaw = .70 - Math.PI, pitch = .36, distance = compact ? 6.5 : 7.4, target = [-.12, .79, 0], opacity = compact ? 1 : .22,
      showWires = !compact, showLabels = !compact, wheelAngles = new Map(), drawnAngles = new Map(), fromAngles = new Map(), previousState = null,
      isPlaying = !!window.LabUI?.isRunning?.(), animationStart = 0, animationDuration = 0, lastUpdateAt = 0,
      fromTime = 0, displayTime = 0, targetTime = 0, eyePosition = [0,0,0], cameraMove = null,
      points = {}, wirePaths = [], vp = identity(), drawItems = [], drag = null, modelToken = 0;
    const labels = new Map(), chips = new Map();
    const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
    const reducedMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const modelStatus = message => { $('.vv-model-status').textContent = message; };
    function eventMessage(message) { modelStatus(message); $('.vv-loading').hidden = true; }
    function componentList() { return (catalog?.components || []).length ? catalog.components : Object.keys(LABELS).map(id => ({id, label: LABELS[id]})); }
    function componentLabel(id) { return componentList().find(c => c.id === id)?.label || LABELS[id] || id; }
    function resolveComponent(id) {
      if (LABELS[id] || points[id]) return id;
      return catalog?.sockets?.find(s => s.id === id)?.component_id || id;
    }
    function isActive(id) {
      if (state?.profile === 'engine' && ['battery', 'bmu', 'abs', 'supervisor', 'wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'].includes(id)) return false;
      return network?.components?.[id]?.installed !== false && network?.components?.[id]?.available !== false;
    }
    function isFitted(id) {
      if (!state?.vehicle?.configuration || !id) return true;
      const component = resolveComponent(id);
      // Wheel meshes are physical wheels, even when their ABS sensors are absent.
      if (/^wheel_(fl|fr|rl|rr)$/.test(component) || (bindings.wheels || []).some(w => (w.object_id || w.node) === component)) return true;
      return catalog?.components?.find(c => c.id === component)?.installed !== false && network?.components?.[component]?.installed !== false;
    }
    function connectionFor(id) { return bindings.connections?.[resolveComponent(id)] || DEFAULT_BINDINGS.connections[resolveComponent(id)] || null; }
    function liveConnected(id) { return (network?.connections || state?.connections || {})[id] !== false; }
    function effectiveConnected(id) { return (network?.effective_connections || state?.effective_connections || network?.connections || state?.connections || {})[id] !== false; }
    function describe(id) {
      if (!state) return 'Start or step the experiment to see live values.';
      const c = resolveComponent(id), s = state.sensors || {}, fmt = (v, digits = 1) => v == null ? 'Missing' : finite(v).toFixed(digits);
      if (!isFitted(c) || !state?.vehicle?.configuration && !isActive(c)) return 'Not fitted in this vehicle configuration.';
      if (network?.components?.[c]?.available === false) return 'Unit disconnected · fitted hardware remains in the vehicle.';
      if (id.startsWith('wheel_') && /^(wheel_fl|wheel_fr|wheel_rl|wheel_rr)$/.test(id)) {
        const index = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'].indexOf(id);
        return `${fmt(state.wheel_speeds_kph?.[index])} km/h physical · ${s.wheel_speeds_kph?.[index] == null ? 'sensor missing' : fmt(s.wheel_speeds_kph[index]) + ' km/h measured'}`;
      }
      if (c === 'coolant_sensor') return `${fmt(state.coolant_c)} °C coolant · ${fmt(s.ect_voltage_v, 2)} V at ECU${!liveConnected('ect') ? ' · connector open' : !effectiveConnected('ect') ? ' · injected open-circuit fault' : ''}`;
      if (c === 'engine') return `${fmt(state.rpm, 0)} rpm · ${fmt(state.coolant_c)} °C coolant`;
      if (c === 'ecu') return state.module_status?.ECU || 'Engine controller';
      if (c === 'battery') return `${fmt(state.soc_pct)}% SOC · ${fmt(state.battery_current_a)} A`;
      if (c === 'bmu') return `${fmt(s.bmu_message_age_ms, 0)} ms since battery report · ${state.contactor || ''}${!liveConnected('bmu') ? ' · CAN connector open' : !effectiveConnected('bmu') ? ' · injected message-loss fault' : ''}`;
      if (c === 'abs') return state.module_status?.ABS_ESP || 'Brake controller';
      if (c === 'supervisor') return state.mode || componentLabel(c);
      if (c === 'dlc' || c === 'scan_tool') return liveConnected('dlc') ? 'Diagnostic CAN branch connected' : 'Diagnostic CAN branch open · no ECU reply';
      const wire = network?.wires?.[id];
      if (wire) return `${wire.available === false || wire.value == null ? 'Unavailable' : fmt(wire.value, 2) + ' ' + (wire.unit || '')} · ${wire.status || ''}`;
      return 'Select a socket or wire in the training panel for its electrical properties.';
    }
    function syncSelection() {
      const info = $('.vv-selection'); info.hidden = !selected;
      const c = resolveComponent(selected), wire = catalog?.wires?.find(w => w.id === selected);
      info.querySelector('strong').textContent = wire?.label || componentLabel(c);
      info.querySelector('span').textContent = describe(selected);
      const connection = wire?.connection_id || connectionFor(c), button = info.querySelector('button');
      button.hidden = !connection || !options.onConnection || !isActive(c);
      button.textContent = connection && !liveConnected(connection) ? 'Reconnect' : 'Disconnect';
      button.dataset.connection = connection || '';
      for (const [id, element] of chips) {
        element.hidden = !isFitted(id);
        element.classList.toggle('selected', id === c); element.setAttribute('aria-pressed', String(id === c));
        element.classList.toggle('vv-not-installed', !isActive(id));
      }
    }
    function choose(id, notify = true) {
      selected = id; syncSelection(); schedule();
      if (notify && options.onSelect) options.onSelect(id);
    }
    function rebuildParts() {
      $('.vv-part-list').replaceChildren(); $('.vv-labels').replaceChildren(); labels.clear(); chips.clear();
      for (const component of componentList()) {
        if (!FALLBACK_POSITIONS[component.id] && !points[component.id]) continue;
        const button = document.createElement('button'); button.type = 'button'; button.textContent = component.label || LABELS[component.id] || component.id;
        button.dataset.component = component.id; button.setAttribute('aria-pressed', 'false');
        listen(button, 'click', () => choose(component.id)); $('.vv-part-list').append(button); chips.set(component.id, button);
        if (['engine', 'ecu', 'coolant_sensor', 'battery', 'bmu', 'abs', 'dlc', 'scan_tool'].includes(component.id)) {
          const label = document.createElement('button'); label.type = 'button'; label.className = 'vv-label';
          label.textContent = component.label || LABELS[component.id] || component.id; label.dataset.component = component.id;
          listen(label, 'click', () => choose(component.id)); $('.vv-labels').append(label); labels.set(component.id, label);
        }
      }
      syncSelection();
    }
    function nodeBindings() {
      const names = new Map();
      for (const [id, binding] of Object.entries(bindings.components || {})) names.set(binding.node, binding.object_id || id);
      for (const wheel of bindings.wheels || []) names.set(wheel.node, wheel.object_id || wheel.node);
      return names;
    }
    function traverseModel() {
      if (!model) return;
      const names = nodeBindings(), wheels = new Map((bindings.wheels || []).map(w => [w.node, w])), bodyNames = new Set(bindings.body_nodes || []);
      const nextPoints = {}; drawItems = [];
      function visit(index, parent, inherited) {
        const node = model.nodes[index], binding = wheels.get(node.name), angle = drawnAngles.get(node.name) ?? wheelAngles.get(node.name) ?? 0;
        const local = binding ? multiply(node.rest, rotation(binding.axis, angle)) : node.rest;
        const world = multiply(parent, local), component = names.get(node.name) || node.extras?.component_id || inherited;
        if (names.has(node.name) || (node.extras?.component_id && !nextPoints[component])) nextPoints[component] = transform(world, [0, 0, 0]).slice(0, 3);
        const body = bodyNames.has(node.name) || node.extras?.role === 'body' || /^(body_|glass_)/.test(node.name);
        const hiddenInExterior=compact && opacity>=.95 && component && !String(component).startsWith('wheel_');
        if (node.mesh != null && !hiddenInExterior && (body || isFitted(component))) for (const geometry of model.meshes[node.mesh]) {
          const center = transform(world, [0, 0, 0]), projected = transform(vp, center);
          drawItems.push({world, geometry, component, body, cabin: node.extras?.role === 'cabin', inactive: component && !isActive(component), depth: projected[2] / projected[3]});
        }
        for (const child of node.children) visit(child, world, component);
      }
      model.roots.forEach(index => visit(index, identity(), null)); points = nextPoints;
    }
    function project(point) {
      const p = transform(vp, point), w = p[3];
      return {x: (p[0] / w * .5 + .5) * width, y: (-p[1] / w * .5 + .5) * height,
        depth: p[2] / w, visible: w > .01 && p[2] / w > -1 && p[2] / w < 1};
    }
    function cameraMatrix() {
      const cameraDistance=distance*Math.max(1,1.25/(width/height));
      const eye = [target[0] + Math.sin(yaw) * Math.cos(pitch) * cameraDistance,
        target[1] + Math.sin(pitch) * cameraDistance, target[2] + Math.cos(yaw) * Math.cos(pitch) * cameraDistance];
      eyePosition = eye; vp = multiply(perspective(width / height), lookAt(eye, target));
    }
    function drawFallback() {
      const ctx = fallbackContext; if (!ctx) return;
      const scale = actualCanvas.width / width; ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.clearRect(0,0,width,height);
      const polygons = [];
      for (const item of drawItems) {
        // A compact exterior uses the outer shell; hidden internal boxes would
        // otherwise interleave with small shell triangles in a painter fallback.
        if(opacity>=.95 && !item.body && !item.cabin && !String(item.component||'').startsWith('wheel_') && item.component!=='scan_tool') continue;
        const g = item.geometry, color = [...g.color];
        if (item.body) color[3] = opacity * (g.material === 'glass' ? .84 : 1);
        if (item.cabin) color[3] = Math.min(1,opacity*1.4);
        if (color[3] < .005) continue;
        if (item.inactive) for (let c = 0; c < 3; c++) color[c] = color[c] * .5 + .33;
        const world = []; for (let i = 0; i < g.positions.length; i += 3) world.push(transform(item.world, g.positions.subarray(i, i + 3)).slice(0, 3));
        for (let i = 0; i < g.indices.length; i += 3) {
          const vertices = [world[g.indices[i]], world[g.indices[i + 1]], world[g.indices[i + 2]]], projected = vertices.map(project);
          if (!projected.every(p => p.visible)) continue;
          let n = norm(cross(sub(vertices[1], vertices[0]), sub(vertices[2], vertices[0])));
          if (dot(n,sub(eyePosition,vertices[0])) < 0) n = n.map(v=>-v);
          const light = .52 + .43 * Math.max(0,dot(n,norm([-.55,1,-.7]))) + .12 * Math.max(0,dot(n,norm([.8,.35,.4])));
          polygons.push({projected, color, light, selected: item.component === resolveComponent(selected), depth: projected.reduce((s, p) => s + p.depth, 0) / 3});
        }
      }
      polygons.sort((a, b) => b.depth - a.depth);
      for (const polygon of polygons) {
        const p = polygon.projected, c = polygon.color.map((v, i) => i < 3 ? Math.round(v * polygon.light * 255) : v);
        ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y); ctx.lineTo(p[1].x, p[1].y); ctx.lineTo(p[2].x, p[2].y); ctx.closePath();
        ctx.fillStyle = `rgba(${c.join(',')})`; ctx.fill();
        if(c[3]>.98){ctx.strokeStyle=ctx.fillStyle;ctx.lineWidth=.65;ctx.stroke();}
        if (polygon.selected) {ctx.strokeStyle = 'rgba(90,100,240,.28)'; ctx.lineWidth = .5; ctx.stroke();}
      }
    }
    function wireDefinitions() {
      if (!catalog?.wires?.length) return DEFAULT_WIRES.map(([id, from, to, connection_id, color]) => ({id, fromComponent: from, toComponent: to, connection_id, color}));
      const socketMap = Object.fromEntries((catalog.sockets || []).map(s => [s.id, s.component_id]));
      return catalog.wires.map(w => ({...w, fromComponent: socketMap[w.from?.socket_id], toComponent: socketMap[w.to?.socket_id]}));
    }
    function routeWire(wire, index) {
      const a = points[wire.fromComponent], b = points[wire.toComponent]; if (!a || !b) return null;
      const offset = (index % 2 ? 1 : -1) * .035, lift = .09;
      // Harness paths avoid straight lines through the engine; two parallel CAN conductors stay distinct.
      if (wire.id.startsWith('wheel_')) {
        const side = a[0] < 0 ? -.86 : .86;
        return [a, [side + offset, .67, a[2]], [side + offset, .67, -.66], [b[0], b[1] + lift, b[2]], b];
      }
      if (wire.id.startsWith('dlc_can')) return [a, [a[0] + offset, 1.22, a[2]], [a[0] + offset, 1.22, -1.65], [b[0], 1.22, -1.65], b];
      if (wire.id.startsWith('dlc_')) return [a, [a[0] - .35, a[1] + lift, a[2] + offset], [b[0], b[1] + lift, b[2] + offset], b];
      if (wire.id.startsWith('bmu_')) return [a, [a[0] + offset, 1.05, a[2]], [b[0] + offset, 1.05, b[2]], b];
      return [a, [a[0], a[1] + .17 + offset, a[2] + offset], [b[0], b[1] + .17 + offset, b[2] + offset], b];
    }
    function pointOnPath(path, phase) {
      const lengths = path.slice(1).map((p, i) => Math.hypot(p.x - path[i].x, p.y - path[i].y));
      let at = phase * lengths.reduce((a, b) => a + b, 0);
      for (let i = 0; i < lengths.length; i++) {
        if (at <= lengths[i] || i === lengths.length - 1) {
          const f = lengths[i] ? at / lengths[i] : 0;
          return {x: path[i].x + (path[i + 1].x - path[i].x) * f, y: path[i].y + (path[i + 1].y - path[i].y) * f};
        }
        at -= lengths[i];
      }
      return path[0];
    }
    function drawGround() {
      const ctx = groundContext; if (!ctx) return;
      const scale = ground.width / width; ctx.setTransform(scale,0,0,scale,0,0);
      const wash = ctx.createLinearGradient(0,0,0,height); wash.addColorStop(0,darkTheme?'#171d25':'#f6f9fb'); wash.addColorStop(.65,darkTheme?'#202934':'#eef3f6'); wash.addColorStop(1,darkTheme?'#141a22':'#e8eef2');
      ctx.fillStyle=wash; ctx.fillRect(0,0,width,height);
      function ellipse3D(cx,cz,rx,rz,alpha) {
        const path=Array.from({length:65},(_,i)=>project([cx+Math.cos(i/64*TAU)*rx,.015,cz+Math.sin(i/64*TAU)*rz]));
        if(!path.every(p=>p.visible)) return;
        ctx.beginPath();ctx.moveTo(path[0].x,path[0].y);path.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));ctx.closePath();ctx.fillStyle=darkTheme?`rgba(0,0,0,${alpha*1.8})`:`rgba(39,57,68,${alpha})`;ctx.fill();
      }
      for(let i=10;i>=0;i--) ellipse3D(0,0,1.0+i*.037,2.02+i*.047,.016);
      for(const x of [-1.01,1.01]) for(const z of [-1.4,1.4]) for(let i=3;i>=0;i--) ellipse3D(x,z,.17+i*.018,.24+i*.03,.035);
      if(opacity < .6 && !compact) {
        ctx.strokeStyle=darkTheme?'rgba(127,164,182,.08)':'rgba(93,121,143,.07)';ctx.lineWidth=1;
        for(let n=-4;n<=4;n++) for(const line of [[[n,.001,-4],[n,.001,4]],[[-4,.001,n],[4,.001,n]]]){
          const [a,b]=line.map(project);if(!a.visible||!b.visible)continue;
          ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
        }
      }
    }
    function advanceDisplay(at) {
      const blend = animationDuration && isPlaying ? clamp((at-animationStart)/animationDuration,0,1) : 1;
      for(const [node,angle] of wheelAngles) drawnAngles.set(node,(fromAngles.get(node) ?? angle)+(angle-(fromAngles.get(node) ?? angle))*blend);
      displayTime=fromTime+(targetTime-fromTime)*blend;
      let moving=blend<1;
      if(cameraMove) {
        const f=clamp((at-cameraMove.at)/320,0,1),e=1-Math.pow(1-f,3);
        yaw=cameraMove.yaw+(cameraMove.toYaw-cameraMove.yaw)*e;
        pitch=cameraMove.pitch+(cameraMove.toPitch-cameraMove.pitch)*e;
        distance=cameraMove.distance+(cameraMove.toDistance-cameraMove.distance)*e;
        if(f>=1)cameraMove=null;else moving=true;
      }
      return moving;
    }
    function drawOverlay() {
      const ctx = overlayContext; if (!ctx) return;
      const scale = overlay.width / width; ctx.setTransform(scale, 0, 0, scale, 0, 0); ctx.clearRect(0, 0, width, height);
      wirePaths = [];
      if (showWires) wireDefinitions().forEach((wire, index) => {
        if (!isFitted(wire.fromComponent) || !isFitted(wire.toComponent)) return;
        const route = routeWire(wire, index); if (!route) return;
        const path = route.map(project); if (!path.every(p => p.visible)) return;
        const live = network?.wires?.[wire.id], connected = live ? live.connected !== false : !wire.connection_id || liveConnected(wire.connection_id);
        const available = isActive(wire.fromComponent) && isActive(wire.toComponent) && connected && live?.available !== false;
        const color = /^#[0-9a-f]{3,8}$/i.test(wire.color || '') ? wire.color : '#00a9b5';
        ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = selected === wire.id ? 4.2 : 2.1;
        ctx.strokeStyle = available ? color : '#8b99ac'; ctx.globalAlpha = available ? .88 : .55;
        if (!connected) ctx.setLineDash([5, 6]); else if (!available) ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.moveTo(path[0].x, path[0].y); path.slice(1).forEach(p => ctx.lineTo(p.x, p.y)); ctx.stroke(); ctx.setLineDash([]);
        if (available && live?.activity !== false && state?.inputs?.ignition !== false) {
          const p = pointOnPath(path, (displayTime * .52 + index * .12) % 1);
          ctx.globalAlpha = 1; ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 7;
          ctx.beginPath(); ctx.arc(p.x, p.y, selected === wire.id ? 4 : 2.8, 0, TAU); ctx.fill();
        }
        if (!connected) {
          const p = pointOnPath(path, .52); ctx.globalAlpha = 1; ctx.strokeStyle = '#d14f53'; ctx.lineWidth = 2; ctx.shadowBlur = 0;
          ctx.beginPath(); ctx.moveTo(p.x - 4, p.y - 4); ctx.lineTo(p.x + 4, p.y + 4); ctx.moveTo(p.x + 4, p.y - 4); ctx.lineTo(p.x - 4, p.y + 4); ctx.stroke();
        }
        ctx.restore(); wirePaths.push({id: wire.id, path});
      });
      const selectedComponent = resolveComponent(selected), anchor = isFitted(selectedComponent) ? points[selectedComponent] : null;
      if (anchor) {
        const p = project(anchor); if (p.visible) {
          ctx.beginPath(); ctx.arc(p.x, p.y, 15, 0, TAU); ctx.strokeStyle = 'rgba(87,91,220,.78)'; ctx.lineWidth = 2; ctx.stroke();
          ctx.beginPath(); ctx.arc(p.x, p.y, 20, 0, TAU); ctx.strokeStyle = 'rgba(87,91,220,.17)'; ctx.lineWidth = 5; ctx.stroke();
        }
      }
      const placed = [];
      for (const [id, label] of labels) {
        const position = points[id]; label.hidden = !showLabels || !position || !isFitted(id);
        if (label.hidden) continue;
        const p = project(position); label.hidden = !p.visible; if (label.hidden) continue;
        const labelWidth = Math.min(135, label.offsetWidth || 105), labelHeight = 27;
        let x = clamp(p.x - labelWidth / 2, 8, width - labelWidth - 8), y = clamp(p.y - 36, 16, height - 105);
        for (let attempt = 0; attempt < 9; attempt++) {
          if (!placed.some(r => x < r.x + r.w + 5 && x + labelWidth + 5 > r.x && y < r.y + r.h + 4 && y + labelHeight + 4 > r.y)) break;
          y -= 30; if (y < 10) { y = p.y + 20 + attempt * 5; x = clamp(x + 25, 8, width - labelWidth - 8); }
        }
        placed.push({x, y, w: labelWidth, h: labelHeight}); label.style.left = x + 'px'; label.style.top = y + 'px';
        label.classList.toggle('selected', id === selectedComponent); label.classList.toggle('vv-not-installed', !isActive(id));
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(x + labelWidth / 2, y + labelHeight);
        ctx.strokeStyle = 'rgba(81,104,137,.35)'; ctx.lineWidth = 1; ctx.stroke();
      }
      const front = project([0, .1, -2.8]);
      $('.vv-orientation').style.left = clamp(front.x - 20, 12, width - 70) + 'px';
      $('.vv-orientation').style.top = clamp(front.y, 34, height - 130) + 'px';
    }
    function render() {
      requested = false; if (disposed || !visible || !model || !stage.clientWidth) return;
      width = stage.clientWidth; height = stage.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      for (const surface of [ground, actualCanvas, overlay]) {
        const w = Math.round(width * dpr), h = Math.round(height * dpr);
        if (surface.width !== w || surface.height !== h) {surface.width = w; surface.height = h;}
      }
      const moving = advanceDisplay(now()); cameraMatrix(); traverseModel(); drawGround();
      if (renderer.gl) renderer.draw(drawItems, vp, opacity, resolveComponent(selected), eyePosition); else drawFallback();
      drawOverlay(); syncSelection(); if(moving) schedule();
    }
    function schedule() { if (!disposed && !requested) { requested = true; requestAnimationFrame(render); } }
    function moveCamera(toYaw,toPitch,toDistance=distance) {
      if(reducedMotion) {yaw=toYaw;pitch=toPitch;distance=toDistance;cameraMove=null;}
      else cameraMove={yaw,pitch,distance,toYaw,toPitch,toDistance,at:now()}; schedule();
    }
    function resetCamera() {target = [-.12,.79,0];moveCamera(.70-Math.PI,.36,compact ? 6.5 : 7.4);}
    function fitModel() {
      cameraMatrix(); traverseModel();
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (const item of drawItems) for (let i = 0; i < item.geometry.positions.length; i += 3) {
        const p = transform(item.world, item.geometry.positions.subarray(i, i + 3));
        for (let j = 0; j < 3; j++) {min[j] = Math.min(min[j], p[j]); max[j] = Math.max(max[j], p[j]);}
      }
      if (min.every(Number.isFinite)) {
        target = min.map((v, i) => (v + max[i]) / 2); distance = clamp(Math.max(...max.map((v, i) => v - min[i])) * 1.85, 2, 180);
      }
    }
    function reportBindings(name) {
      const bound = (bindings.wheels || []).filter(w => model.nodes.some(n => n.name === w.node)).length;
      modelStatus(`${name} · ${model.vertices.toLocaleString()} vertices · ${Object.keys(points).length} named components · ${bound}/${bindings.wheels.length} wheels bound to simulation.`);
    }
    async function loadModel(buffer, name = 'Local model.glb', fit = true) {
      const next = parseGLB(buffer); next.name = name;
      renderer.release?.(model); model = next; wheelAngles.clear(); drawnAngles.clear(); fromAngles.clear(); previousState = null; animationDuration=0;
      if (fit) fitModel(); else {cameraMatrix(); traverseModel();}
      rebuildParts(); reportBindings(name); $('.vv-loading').hidden = true; schedule(); return {vertices: model.vertices, components: Object.keys(points)};
    }
    async function restoreSample() {
      const token = ++modelToken; modelStatus('Loading local sample…');
      try {
        const results = await Promise.all([fetch('/web/models/training_vehicle.glb'), fetch('/web/models/vehicle_bindings.json')]);
        if (results.some(r => !r.ok)) throw new Error('The local sample files could not be loaded.');
        const [buffer, config] = await Promise.all([results[0].arrayBuffer(), results[1].json()]);
        if (disposed || token !== modelToken) return;
        bindings = validateBindings(config); resetCamera(); await loadModel(buffer, 'training_vehicle.glb', false);
      } catch (error) {
        if (disposed) return;
        eventMessage(error.message); $('.vv-loading').hidden = false; $('.vv-loading').textContent = 'Vehicle model could not load. Use Restore sample or Load GLB below.';
      }
    }
    function loadBindings(raw) {
      bindings = validateBindings(raw); wheelAngles.clear(); drawnAngles.clear(); fromAngles.clear(); previousState = null; animationDuration=0;
      if (model) {cameraMatrix(); traverseModel(); rebuildParts(); reportBindings(model.name);} schedule();
    }
    function setOpacity(value){ opacity=clamp(value,0,1);$('.vv-opacity input').value=Math.round(opacity*100);$('.vv-opacity output').textContent=Math.round(opacity*100)+'%';
      $('[data-action="exterior"]').setAttribute('aria-pressed',String(opacity>=.95));$('[data-action="cutaway"]').setAttribute('aria-pressed',String(opacity<.6));schedule();}
    listen($('.vv-opacity input'),'input',e=>setOpacity(finite(e.target.value)/100));
    listen($('[data-action="exterior"]'),'click',()=>{setOpacity(1);showWires=false;showLabels=false;$('[data-option="wires"]').checked=false;$('[data-option="labels"]').checked=false;});
    listen($('[data-action="cutaway"]'),'click',()=>{setOpacity(.22);showWires=true;showLabels=!compact;$('[data-option="wires"]').checked=true;$('[data-option="labels"]').checked=!compact;});
    listen($('[data-option="wires"]'), 'change', e => {showWires = e.target.checked; schedule();});
    listen($('[data-option="labels"]'), 'change', e => {showLabels = e.target.checked; schedule();});
    listen($('[data-action="reset"]'), 'click', resetCamera);
    listen($('[data-action="top"]'), 'click', () => moveCamera(-Math.PI,1.54));
    listen($('[data-action="side"]'), 'click', () => moveCamera(-Math.PI/2,.14));
    listen($('[data-action="connection"]'), 'click', e => {
      const id = e.currentTarget.dataset.connection; if (id && options.onConnection) options.onConnection(id, !liveConnected(id));
    });
    listen($('[data-action="load-model"]'), 'click', () => $('.vv-model-file').click());
    listen($('[data-action="load-bindings"]'), 'click', () => $('.vv-bindings-file').click());
    listen($('[data-action="sample"]'), 'click', restoreSample);
    listen($('.vv-model-file'), 'change', async e => {
      const file = e.target.files?.[0]; if (!file) return; ++modelToken;
      try { if (file.size > 12 * 1024 * 1024) throw new Error('Choose a GLB file smaller than 12 MB.'); await loadModel(await file.arrayBuffer(), file.name); }
      catch (error) {eventMessage(error.message + ' The previous model is retained.');} finally {e.target.value = '';}
    });
    listen($('.vv-bindings-file'), 'change', async e => {
      const file = e.target.files?.[0]; if (!file) return;
      try { if (file.size > 65536) throw new Error('Bindings JSON must be smaller than 64 KB.'); loadBindings(JSON.parse(await file.text())); }
      catch (error) {eventMessage(error.message + ' The previous bindings are retained.');} finally {e.target.value = '';}
    });
    function hitTest(x, y) {
      let closest = null, threshold = 24;
      for (const [id, position] of Object.entries(points)) {
        if (!isFitted(id)) continue;
        if(compact && opacity>=.95 && !id.startsWith('wheel_')) continue;
        const p = project(position), d = Math.hypot(p.x - x, p.y - y);
        if (p.visible && d < threshold) {closest = id; threshold = d;}
      }
      if (closest) return closest;
      for (const wire of wirePaths) for (let i = 0; i < wire.path.length - 1; i++) {
        const a = wire.path[i], b = wire.path[i + 1], dx = b.x - a.x, dy = b.y - a.y,
          f = clamp(((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1),
          d = Math.hypot(x - a.x - f * dx, y - a.y - f * dy);
        if (d < 7 && d < threshold) {closest = wire.id; threshold = d;}
      }
      return closest;
    }
    listen(actualCanvas, 'pointerdown', e => {
      if (e.button !== 0) return; actualCanvas.setPointerCapture?.(e.pointerId);
      cameraMove=null; drag = {x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, moved: false}; actualCanvas.classList.add('vv-dragging');
    });
    listen(actualCanvas, 'pointermove', e => {
      if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 3) drag.moved = true;
      if (drag.moved) {yaw -= dx * .008; pitch = clamp(pitch + dy * .007, .05, 1.54); schedule();}
      drag.x = e.clientX; drag.y = e.clientY;
    });
    listen(actualCanvas, 'pointerup', e => {
      if (drag && !drag.moved) {const rect = actualCanvas.getBoundingClientRect(), id = hitTest(e.clientX - rect.left, e.clientY - rect.top); if (id) choose(id);}
      drag = null; actualCanvas.classList.remove('vv-dragging');
    });
    listen(actualCanvas, 'pointercancel', () => {drag = null; actualCanvas.classList.remove('vv-dragging');});
    listen(actualCanvas, 'wheel', e => {e.preventDefault(); cameraMove=null; distance = clamp(distance * Math.exp(e.deltaY * .001), 2.3, 180); schedule();}, {passive: false});
    listen(actualCanvas, 'keydown', e => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'Home'].includes(e.key)) e.preventDefault(); else return;
      cameraMove=null;if (e.key === 'Home') resetCamera(); if (e.key === 'ArrowLeft') yaw -= .15; if (e.key === 'ArrowRight') yaw += .15;
      if (e.key === 'ArrowUp') pitch = clamp(pitch + .10, .05, 1.54); if (e.key === 'ArrowDown') pitch = clamp(pitch - .10, .05, 1.54);
      if (e.key === '+' || e.key === '=') distance = clamp(distance * .90, 2.3, 180); if (e.key === '-') distance = clamp(distance * 1.10, 2.3, 180); schedule();
    });
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    observer?.observe(stage); listen(window, 'resize', schedule);
    listen(actualCanvas, 'webglcontextlost', e => {e.preventDefault(); modelStatus('3D graphics context was lost. Reload the page to restore it.');});
    listen(window,'lab:play',e=>{isPlaying=!!e.detail?.running;if(!isPlaying){animationDuration=0;displayTime=finite(state?.t);for(const [node,angle] of wheelAngles)drawnAngles.set(node,angle);}schedule();});
    rebuildParts(); restoreSample();
    return {
      update(snapshot, nextNetwork, nextCatalog) {
        const changedCatalog = nextCatalog && nextCatalog !== catalog; state = snapshot || state; network = nextNetwork || network; catalog = nextCatalog || catalog;
        if (state) {
          const at=now(), dt=previousState ? state.t-previousState.t : 0;
          advanceDisplay(at);
          if(dt<0 || (previousState && state.profile!==previousState.profile)) {
            wheelAngles.clear();drawnAngles.clear();fromAngles.clear();animationDuration=0;
          } else if(dt>0 && dt<=10) {
            fromAngles=new Map(drawnAngles); fromTime=displayTime;
            for(const wheel of bindings.wheels || []) {
              if(!fromAngles.has(wheel.node))fromAngles.set(wheel.node,wheelAngles.get(wheel.node)||0);
              const rawSpeed=readPath(state,wheel.signal_path),rawPrevious=readPath(previousState,wheel.signal_path);
              const speed=rawSpeed==null?null:rawSpeed*(state.vehicle?.direction ?? 1),previous=rawPrevious==null?null:rawPrevious*(previousState?.vehicle?.direction ?? 1);
              if(speed!=null) wheelAngles.set(wheel.node,(wheelAngles.get(wheel.node)||0)+((previous??speed)+speed)/2/3.6/wheel.radius_m*dt*(wheel.direction??-1));
            }
            animationStart=at;animationDuration=isPlaying && !reducedMotion ? clamp(lastUpdateAt ? at-lastUpdateAt : 100,40,250) : 0;
          }
          if(dt!==0)lastUpdateAt=at;
          targetTime=finite(state.t); previousState=state;
          if(!animationDuration || !isPlaying){for(const [node,angle] of wheelAngles)drawnAngles.set(node,angle);displayTime=finite(state.t);}
        }
        if (changedCatalog) rebuildParts(); syncSelection(); schedule();
      },
      select(id) {choose(id, false);}, resize: schedule,
      setTheme(theme) {darkTheme=theme==='dark';container.classList.toggle('vv-dark',darkTheme);schedule();},
      setVisible(value) {visible = !!value; if (visible) schedule();},
      loadModel, loadBindings,
      inspect() {return {renderer: renderer.type, model: model?.name || null, components: Object.keys(points),
        renderedComponents: [...new Set(drawItems.map(item => item.component).filter(Boolean))],
        inactiveComponents: [...new Set(drawItems.filter(item => item.inactive).map(item => item.component))],
        bodyMeshes: drawItems.filter(item => item.body).length,
        shownParts: [...chips].filter(([,element]) => !element.hidden).map(([id]) => id),
        shownLabels: [...labels].filter(([,element]) => !element.hidden).map(([id]) => id),
        shownWires: wirePaths.map(wire => wire.id),
        wheelAngles: Object.fromEntries(wheelAngles), drawnAngles: Object.fromEntries(drawnAngles), compact, locator, theme: darkTheme ? 'dark' : 'light', opacity, selected, bindings: bindings.wheels.length, time: state?.t ?? null};},
      dispose() {disposed = true; ++modelToken; abort.abort(); observer?.disconnect(); renderer.release?.(model); renderer.dispose?.(); container.replaceChildren();}
    };
  }
  window.VehicleView = {create, parseGLB, validateBindings};
})();
