# Transparent vehicle and model bindings

The vehicle view places the same components, connections and signals from the training panel inside an original contoured crossover. It reads the simulation snapshot; it does not run a second vehicle model.

## Use the view

Drag to orbit, scroll to zoom, or use **Top view**, **Side view** and **Reset view**. Keyboard users can focus the vehicle canvas, use arrow keys to rotate, **+ / −** to zoom and **Home** to reset. **Exterior** shows the painted body and cabin glass. **Cutaway** exposes the components and wiring; the **Body** slider sets the transparency between these views. The compact vehicle in Live dashboard uses the same scene and state. Component buttons below the view provide an accessible alternative to picking the model.

Select the coolant sensor, DLC socket, battery monitor or front-left wheel to disconnect the corresponding teaching connection. The effect belongs to the shared experiment. A physical wheel continues rotating when its measurement disappears. Opening the diagnostic CAN branch prevents scan-tool replies without stopping the vehicle controllers.

Wire colors and moving dots help follow the selected path. Dots advance with simulation time and stop when the simulation is paused. They are conceptual information flow, not measured voltage pulses, an oscilloscope trace, CAN arbitration, bit timing or an ISO-TP timing visualization. The diagnostic CAN conductors do not claim continuous packet traffic. A gray dashed path and red cross show a disconnected path. The engine-stand profile leaves battery and wheel components unavailable; select a hybrid or braking experiment to use them.

## What is included

| File | Purpose |
| --- | --- |
| `web/models/training_vehicle.glb` | Original contoured crossover with curved body panels, cabin glass, alloy rims, seats, selectable modules and four physical wheel groups. |
| `web/models/vehicle_bindings.json` | Maps named model nodes to component IDs, signals, wheel axes, wheel radius and connection IDs. |
| `tools/build_vehicle_model.py` | Rebuilds both sample files with Python's standard library. |
| `web/vehicle.js` | Offline WebGL2 renderer with a Canvas fallback, restricted GLB reader and live bindings. |
| `web/three-adapter.js` | ES module that drives a scene loaded by a separately supplied Three.js application. |

The default renderer uses WebGL2. If WebGL2 is unavailable, a Canvas 2D projection keeps the component model and selection usable; the renderer badge tells you which path is active. It is not the Three.js renderer. No JavaScript package or network download is required to run this lab.

## Replace the model

Open **Model & simulation bindings**, choose **Load GLB**, and select a local `.glb` file. Loading happens in the browser; the file is not uploaded to a service. Files are limited to 12 MB, 800 nodes, 400 meshes and one million vertices in this teaching viewer.

The built-in reader supports glTF 2.0 GLB files with one embedded binary buffer, triangle geometry, float32 positions/normals, indexed or unindexed meshes, node transforms and material base-color factors. It calculates normals when they are absent. It does not support textures, external buffers, required extensions, Draco/compressed meshes, morph targets, skinning or stored animation clips. Unsupported files are rejected and the previous model remains displayed. A full Three.js application can use its own GLTFLoader for broader glTF support.

For immediate simulation binding, give nodes the sample names: `engine`, `ecu`, `coolant_sensor`, `battery`, `bmu`, `abs`, `supervisor`, `dlc`, `scan_tool`, `wheel_fl`, `wheel_fr`, `wheel_rl` and `wheel_rr`. Each wheel should be a group whose pivot is at the axle center. Put tire, hub and spoke meshes inside that group. Keep wheel groups distinct so the physical wheel speeds can differ during braking.

The sample coordinate convention is **+Y up, −Z front, −X vehicle left**, in illustrative metres. The geometry is a teaching layout, not a manufacturer service drawing. The renderer integrates the published physical wheel-speed samples using the model's 0.31 m physical wheel radius. During playback, intermediate animation frames interpolate between completed simulation samples. They do not predict future state or run a second simulation clock. Pausing snaps to the latest completed sample and holds. With large simulation steps, visible angle is an approximation to the rotation between snapshots; instantaneous physical and measured speeds remain separate. A user preference for reduced motion disables that interpolation.

## Change the bindings

Download **Bindings JSON**, edit node names to match your GLB, then use **Load bindings JSON**. A wheel binding looks like this:

```json
{
  "node": "wheel_fl",
  "object_id": "wheel_fl",
  "signal_path": "wheel_speeds_kph.0",
  "measurement_path": "sensors.wheel_speeds_kph.0",
  "axis": "x",
  "direction": -1,
  "radius_m": 0.31
}
```

`signal_path` drives the physical wheel. `measurement_path` reports what the controller can see. A disconnected sensor produces a missing measurement; it does not force the physical wheel to stop. `direction` is −1 for the sample's forward −Z direction and X axle; use +1 if your model's axle convention requires the reverse. `body_nodes` identifies the meshes affected by the opacity slider. `components` binds model names to stable network object IDs, and `connections` maps those IDs to the four supported connection switches. Bindings are data; they do not contain executable code.

Local model and binding imports live only in the current browser view. Each mounted view owns its own model, camera and selection; the shared experiment remains the source of physical state. To make a permanent project change, replace the sample files in the editable source package and rebuild the standalone launcher with `tools/build_standalone.py`.

## Connect a Three.js renderer

Three.js is deliberately supplied by the integrating application. Its GLTFLoader loads the scene, and the adapter receives the already loaded scene plus the binding JSON. Host the Three.js distribution and addons locally if the final application must remain offline. The lab does not automatically download either of them.

```javascript
import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { createThreeSimulationBindings } from './three-adapter.js';

const gltf = await new GLTFLoader().loadAsync('/web/models/training_vehicle.glb');
const bindings = await fetch('/web/models/vehicle_bindings.json').then(r => r.json());
const bridge = createThreeSimulationBindings({
  THREE, scene: gltf.scene, bindings
});
scene.add(gltf.scene); // scene and renderer are owned by your application
bridge.setBodyOpacity(0.20);

// Use each existing lab update; do not create another simulation timer.
window.addEventListener('lab:state', event => {
  const {state, network} = event.detail;
  bridge.update(state, network);
  renderer.render(scene, camera);
});
```

The example assumes your Three.js installation resolves the addons' `three` imports, commonly with a local import map. It is integration code, not a second runnable entry point. `bridge.warnings` identifies absent nodes. `setSelection(id)` highlights named components; `setBodyOpacity(value)` changes panels; `dispose()` restores original materials and wheel transforms.

For custom wire geometry, pass `wires: [{id, line, marker, curve, phase}]`. `id` must match the network wire ID, such as `ect_signal`. `line` is a Three.js object, `marker` is an optional moving marker and `curve` implements `getPointAt()`. The adapter records live values in `userData.obdii`, dims disconnected lines and moves a marker only when the network reports activity. The positions remain visual aids, not simulated physical wires.

## Technical references

- [Three.js GLTFLoader documentation](https://threejs.org/docs/pages/GLTFLoader.html): loading glTF scenes in a full renderer.
- [Three.js Object3D documentation](https://threejs.org/docs/pages/Object3D.html): named object lookup and scene transforms.
- [Three.js glTF loading manual](https://threejs.org/manual/pages/load-gltf.html): inspecting named nodes and connecting animation to objects.

The live model, geometry and adapter are original teaching code. They do not contain production ECU firmware or manufacturer vehicle assets.
