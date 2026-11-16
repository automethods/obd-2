/**
 * OBD II Lab bridge for an application that already owns a Three.js renderer.
 * This module does not import or download Three.js. Pass your own THREE module,
 * a loaded glTF scene, and vehicle_bindings.json. See docs/VEHICLE_MODELS.html.
 */
export function createThreeSimulationBindings({THREE, scene, bindings, wires = []}) {
  if (!THREE?.Quaternion || !THREE?.Vector3 || !scene?.getObjectByName)
    throw new TypeError('Pass THREE and an already loaded Three.js scene.');
  if (bindings?.schema !== 'obdii-lab.vehicle-bindings.v1')
    throw new TypeError('Expected obdii-lab.vehicle-bindings.v1.');

  const warnings = [], components = new Map(), body = [], materials = new Map();
  const axes = {x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1)};
  let previous = null, selected = null;
  function pathValue(snapshot, path) {
    let value = snapshot;
    for (const part of String(path).split('.')) {
      if (value == null || !Object.prototype.hasOwnProperty.call(value, part)) return null;
      value = value[part];
    }
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
  function rememberMaterials(object) {
    object.traverse(child => {
      if (!child.material || materials.has(child)) return;
      const originals = Array.isArray(child.material) ? child.material : [child.material];
      const copies = originals.map(material => material.clone());
      materials.set(child, {original: child.material, copies});
      child.material = Array.isArray(child.material) ? copies : copies[0];
    });
  }
  for (const [id, definition] of Object.entries(bindings.components || {})) {
    const node = scene.getObjectByName(definition.node);
    if (node) {components.set(definition.object_id || id, node); rememberMaterials(node);}
    else warnings.push(`Component node not found: ${definition.node}`);
  }
  const wheels = (bindings.wheels || []).flatMap(binding => {
    const node = scene.getObjectByName(binding.node);
    if (!node) {warnings.push(`Wheel node not found: ${binding.node}`); return [];}
    if (!axes[binding.axis || 'x'] || !(binding.radius_m > 0)) {
      warnings.push(`Invalid wheel axis or radius: ${binding.node}`); return [];
    }
    components.set(binding.object_id || binding.node, node); rememberMaterials(node);
    return [{...binding, node, rest: node.quaternion.clone(), angle: 0,
      axisVector: axes[binding.axis || 'x'], quaternion: new THREE.Quaternion()}];
  });
  for (const name of bindings.body_nodes || []) {
    const node = scene.getObjectByName(name);
    if (node) {body.push(node); rememberMaterials(node);} else warnings.push(`Body node not found: ${name}`);
  }
  for (const wire of wires) {if (wire.line) rememberMaterials(wire.line); if (wire.marker) rememberMaterials(wire.marker);}
  const forMaterial = (node, fn) => node?.traverse(child => {
    const saved = materials.get(child); if (saved) saved.copies.forEach(fn);
  });
  return {
    warnings,
    components,
    update(snapshot, network) {
      if (!snapshot || !Number.isFinite(snapshot.t)) return;
      const dt = previous ? snapshot.t - previous.t : 0;
      const reset = dt < 0 || (previous && snapshot.profile !== previous.profile);
      for (const wheel of wheels) {
        if (reset) wheel.angle = 0;
        else if (dt > 0 && dt <= 10) {
          const current = pathValue(snapshot, wheel.signal_path), before = pathValue(previous, wheel.signal_path);
          if (current != null) wheel.angle = (wheel.angle + ((before ?? current) + current) / 2 / 3.6 / wheel.radius_m * dt * (wheel.direction ?? -1)) % (2 * Math.PI);
        }
        wheel.quaternion.setFromAxisAngle(wheel.axisVector, wheel.angle);
        wheel.node.quaternion.copy(wheel.rest).multiply(wheel.quaternion);
        // Physical wheel speed and measured wheel speed remain distinct.
        wheel.node.userData.obdii = {physicalSpeedKph: pathValue(snapshot, wheel.signal_path),
          measuredSpeedKph: wheel.measurement_path ? pathValue(snapshot, wheel.measurement_path) : null};
      }
      for (const [id, node] of components) {
        const live = network?.components?.[id] || {};
        node.userData.obdii = {...node.userData.obdii, objectId: id, simulationTime: snapshot.t, ...live};
      }
      for (const wire of wires) {
        const live = network?.wires?.[wire.id];
        const active = !!live && live.available !== false && live.connected !== false && live.activity === true;
        if (wire.line) {
          wire.line.userData.obdii = {...live, objectId: wire.id};
          forMaterial(wire.line, material => {
            material.transparent = true; material.opacity = live?.connected === false ? .3 : .9;
            if (material.emissive) material.emissive.setHex(selected === wire.id ? 0x493fbb : 0x000000);
          });
        }
        if (wire.marker) {
          wire.marker.visible = active;
          if (active && wire.curve?.getPointAt) wire.marker.position.copy(wire.curve.getPointAt((snapshot.t * .52 + (wire.phase || 0)) % 1));
        }
      }
      previous = snapshot;
    },
    setSelection(id) {
      selected = id;
      for (const [componentId, node] of components) forMaterial(node, material => {
        if (material.emissive) material.emissive.setHex(componentId === id ? 0x332d89 : 0x000000);
      });
    },
    setBodyOpacity(value) {
      const opacity = Math.max(0, Math.min(1, Number(value) || 0));
      for (const node of body) forMaterial(node, material => {
        material.transparent = opacity < 1; material.opacity = opacity;
        material.depthWrite = opacity >= 1; material.needsUpdate = true;
      });
    },
    reset() {previous = null; wheels.forEach(wheel => {wheel.angle = 0; wheel.node.quaternion.copy(wheel.rest);});},
    dispose() {
      wheels.forEach(wheel => wheel.node.quaternion.copy(wheel.rest));
      for (const [node, saved] of materials) {node.material = saved.original; saved.copies.forEach(material => material.dispose());}
      materials.clear(); components.clear();
    }
  };
}
