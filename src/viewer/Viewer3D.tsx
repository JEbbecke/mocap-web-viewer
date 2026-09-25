import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { MotionData } from '../motion/types';
import { sample, sample3 } from '../motion/math';
import { resolveConnections } from '../motion/connections';
import { setCamera, useSession, type CameraPreset } from '../state/session';

function bounds(data: MotionData) {
  const box = new THREE.Box3(),
    v = new THREE.Vector3();
  const p = data.markers.positions;
  for (let i = 0; i < data.markers.valid.length; i++)
    if (data.markers.valid[i]) box.expandByPoint(v.fromArray(p, i * 3));
  // Moving plates can travel outside the marker envelope. Fit their full recorded path.
  for (const plate of data.forcePlatforms) {
    const values = plate.corners?.values;
    if (values)
      for (let i = 0; i < values.length; i += 3) {
        v.fromArray(values, i);
        if ([v.x, v.y, v.z].every(Number.isFinite)) box.expandByPoint(v);
      }
  }
  if (box.isEmpty()) box.set(new THREE.Vector3(-1, -1, 0), new THREE.Vector3(1, 1, 2));
  return {
    center: box.getCenter(new THREE.Vector3()),
    size: Math.max(0.8, box.getSize(new THREE.Vector3()).length()),
  };
}
function Camera({ data }: { data: MotionData }) {
  const { camera } = useThree(),
    controls = useRef<OrbitControlsImpl>(null),
    view = useSession((s) => s.camera);
  const extent = useMemo(() => bounds(data), [data]);
  useEffect(() => {
    camera.up.set(0, 0, 1);
    const offset: Record<CameraPreset, number[]> = {
      perspective: [1.3, -1.8, 1.0],
      front: [2, 0, 0],
      side: [0, -2, 0],
      top: [0, -0.001, 2],
    };
    camera.position
      .copy(extent.center)
      .add(new THREE.Vector3(...offset[view.preset]).multiplyScalar(extent.size * 0.65));
    camera.lookAt(extent.center);
    controls.current?.target.copy(extent.center);
    controls.current?.update();
  }, [camera, extent, view]);
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.12}
      minDistance={0.05}
      maxDistance={1000}
    />
  );
}
function Markers({ data }: { data: MotionData }) {
  const ref = useRef<THREE.InstancedMesh>(null),
    matrix = useMemo(() => new THREE.Matrix4(), []),
    color = useMemo(() => new THREE.Color(), []);
  const count = data.markers.labels.length;
  const extent = useMemo(() => bounds(data), [data]);
  useEffect(() => {
    if (ref.current)
      ref.current.boundingSphere = new THREE.Sphere(extent.center, extent.size / 2 + 0.03);
  }, [extent]);
  const click = (event: ThreeEvent<MouseEvent>) => {
    const s = useSession.getState();
    if (
      event.delta > 4 ||
      event.instanceId == null ||
      s.hidden.has(event.instanceId) ||
      !data.markers.valid[s.frame * count + event.instanceId]
    )
      return;
    event.stopPropagation();
    useSession.setState({ selected: event.instanceId, plot: 'marker' });
  };
  useFrame(() => {
    if (!ref.current) return;
    const { frame, selected, hidden, display } = useSession.getState();
    ref.current.visible = display.markers;
    for (let i = 0; i < count; i++) {
      const index = frame * count + i,
        show = data.markers.valid[index] && !hidden.has(i),
        r = show ? (i === selected ? 0.014 : 0.009) : 0;
      matrix.makeScale(r, r, r);
      matrix.setPosition(
        data.markers.positions[index * 3] || 0,
        data.markers.positions[index * 3 + 1] || 0,
        data.markers.positions[index * 3 + 2] || 0,
      );
      ref.current.setMatrixAt(i, matrix);
      ref.current.setColorAt(
        i,
        color.set(
          i === selected
            ? '#ffc875'
            : data.markers.labels[i].startsWith('L')
              ? '#70bcff'
              : '#78e0c1',
        ),
      );
    }
    ref.current.instanceMatrix.needsUpdate = true;
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, count]}
      frustumCulled={false}
      onClick={click}
    >
      <sphereGeometry args={[1, 12, 8]} />
      <meshStandardMaterial roughness={0.55} />
    </instancedMesh>
  );
}
function Connections({ data }: { data: MotionData }) {
  const id = useSession((s) => s.connectionSet),
    pairs = useMemo(() => resolveConnections(data.markers.labels, id), [data, id]);
  const object = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(pairs.length * 6), 3),
    );
    return new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ color: '#8697b0', transparent: true, opacity: 0.7 }),
    );
  }, [pairs]);
  useEffect(
    () => () => {
      object.geometry.dispose();
      object.material.dispose();
    },
    [object],
  );
  useFrame(() => {
    const { frame, hidden, display } = useSession.getState();
    object.visible = display.connections;
    const values = object.geometry.attributes.position.array as Float32Array,
      n = data.markers.labels.length;
    let drawn = 0;
    for (const [a, b] of pairs) {
      if (
        hidden.has(a) ||
        hidden.has(b) ||
        !data.markers.valid[frame * n + a] ||
        !data.markers.valid[frame * n + b]
      )
        continue;
      for (const marker of [a, b]) {
        const i = (frame * n + marker) * 3;
        values.set(data.markers.positions.subarray(i, i + 3), drawn * 3);
        drawn++;
      }
    }
    object.geometry.setDrawRange(0, drawn);
    object.geometry.attributes.position.needsUpdate = true;
  });
  return <primitive object={object} frustumCulled={false} />;
}
function MarkerLabels({ data }: { data: MotionData }) {
  const enabled = useSession((s) => s.display.labels);
  const group = useMemo(() => {
    const g = new THREE.Group();
    if (!enabled) return g;
    for (const label of data.markers.labels) {
      const canvas = document.createElement('canvas');
      canvas.width = 384;
      canvas.height = 48;
      const ctx = canvas.getContext('2d')!;
      ctx.font = '24px system-ui';
      ctx.fillStyle = '#dae8f4';
      ctx.fillText(label, 4, 32);
      const texture = new THREE.CanvasTexture(canvas),
        sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }),
        );
      sprite.scale.set(0.3, 0.0375, 1);
      sprite.center.set(0, 0);
      g.add(sprite);
    }
    return g;
  }, [data, enabled]);
  useEffect(
    () => () => {
      for (const child of group.children) {
        const sprite = child as THREE.Sprite;
        sprite.material.map?.dispose();
        sprite.material.dispose();
      }
    },
    [group],
  );
  useFrame(() => {
    const { frame, hidden, display } = useSession.getState(),
      n = data.markers.labels.length;
    group.children.forEach((sprite, i) => {
      const index = frame * n + i;
      sprite.visible = display.markers && !hidden.has(i) && !!data.markers.valid[index];
      sprite.position.fromArray(data.markers.positions, index * 3).addScalar(0.014);
    });
  });
  return <primitive object={group} />;
}
function Plates({ data }: { data: MotionData }) {
  const objects = useMemo(
    () =>
      data.forcePlatforms.map((_, index) => {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
        geometry.setIndex([0, 1, 2, 0, 2, 3]);
        const mesh = new THREE.Mesh(
          geometry,
          new THREE.MeshBasicMaterial({
            color: '#3b8e8d',
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.55,
            depthWrite: false,
            // Plate surfaces commonly coincide with the ground grid.
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
          }),
        );
        const outline = new THREE.LineLoop(
          new THREE.BufferGeometry(),
          new THREE.LineBasicMaterial({ color: '#69bab6' }),
        );
        outline.geometry.setAttribute(
          'position',
          new THREE.BufferAttribute(new Float32Array(12), 3),
        );
        mesh.renderOrder = 1;
        outline.renderOrder = 2;
        const arrow = new THREE.ArrowHelper(
          new THREE.Vector3(0, 0, 1),
          new THREE.Vector3(),
          1,
          '#ffbd70',
          0.07,
          0.03,
        );
        const point = new THREE.Mesh(
          new THREE.SphereGeometry(0.012, 12, 8),
          new THREE.MeshBasicMaterial({ color: '#ffdeac' }),
        );
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 128;
        const context = canvas.getContext('2d')!;
        context.font = '600 80px system-ui';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.lineWidth = 7;
        context.strokeStyle = '#111c26';
        context.fillStyle = '#b9f5e5';
        context.strokeText(String(index + 1), 64, 66);
        context.fillText(String(index + 1), 64, 66);
        const number = new THREE.Mesh(
          new THREE.PlaneGeometry(1, 1),
          new THREE.MeshBasicMaterial({
            map: new THREE.CanvasTexture(canvas),
            transparent: true,
            opacity: 0.5,
            side: THREE.DoubleSide,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
          }),
        );
        number.renderOrder = 3;
        return {
          mesh,
          outline,
          arrow,
          point,
          number,
          axisX: new THREE.Vector3(),
          axisY: new THREE.Vector3(),
          normal: new THREE.Vector3(),
          basis: new THREE.Matrix4(),
          posePosition: new THREE.Vector3(),
        };
      }),
    [data],
  );
  useEffect(
    () => () => {
      for (const o of objects) {
        o.mesh.geometry.dispose();
        o.mesh.material.dispose();
        o.outline.geometry.dispose();
        o.outline.material.dispose();
        o.point.geometry.dispose();
        o.point.material.dispose();
        o.arrow.dispose();
        o.number.material.map?.dispose();
        o.number.material.dispose();
        o.number.geometry.dispose();
      }
    },
    [objects],
  );
  useFrame(() => {
    const state = useSession.getState(),
      time = state.frame / data.timeline.rate;
    data.forcePlatforms.forEach((plate, i) => {
      const o = objects[i],
        global = plate.coordinateFrame === 'global' || state.assumeGlobal;
      o.mesh.visible = o.outline.visible = !!plate.corners && state.display.plates;
      o.number.visible = false;
      if (plate.corners) {
        const positions = o.mesh.geometry.attributes.position.array as Float32Array;
        for (let j = 0; j < 12; j++) positions[j] = sample(plate.corners, time, j, true);
        const finite = positions.every(Number.isFinite);
        o.mesh.visible = o.outline.visible = o.mesh.visible && finite;
        if (finite) {
          o.mesh.geometry.attributes.position.needsUpdate = true;
          (o.outline.geometry.attributes.position.array as Float32Array).set(positions);
          o.outline.geometry.attributes.position.needsUpdate = true;
          // Center the identifier on the current plate, including moving H5 geometry.
          o.number.position.set(0, 0, 0);
          let shortestEdge = Infinity;
          for (let corner = 0; corner < 4; corner++) {
            const a = corner * 3,
              b = ((corner + 1) % 4) * 3;
            o.number.position.x += positions[a] / 4;
            o.number.position.y += positions[a + 1] / 4;
            o.number.position.z += positions[a + 2] / 4;
            shortestEdge = Math.min(
              shortestEdge,
              Math.hypot(
                positions[a] - positions[b],
                positions[a + 1] - positions[b + 1],
                positions[a + 2] - positions[b + 2],
              ),
            );
          }
          const size = shortestEdge * 0.45;
          o.number.scale.set(size, size, 1);
          // Follow the plate's own plane rather than the camera, also for tilted plates.
          o.axisX.set(
            positions[3] - positions[0],
            positions[4] - positions[1],
            positions[5] - positions[2],
          );
          o.axisY.set(
            positions[9] - positions[0],
            positions[10] - positions[1],
            positions[11] - positions[2],
          );
          o.normal.crossVectors(o.axisX, o.axisY);
          // Rotation maps plate-local axes into lab XYZ. Use it to orient the
          // label, not to transform Corners a second time: those are already global.
          if (plate.rotation && plate.poseFrame === 'global') {
            const r = Array.from({ length: 9 }, (_, j) => sample(plate.rotation!, time, j, true));
            const x = new THREE.Vector3(r[0], r[3], r[6]);
            const y = new THREE.Vector3(r[1], r[4], r[7]);
            if (
              r.every(Number.isFinite) &&
              Math.abs(x.lengthSq() - 1) < 1e-4 &&
              Math.abs(y.lengthSq() - 1) < 1e-4 &&
              Math.abs(x.dot(y)) < 1e-4
            ) {
              o.axisX.copy(x);
              o.axisY.copy(y);
              o.normal.crossVectors(x, y);
            }
          }
          if (o.normal.lengthSq() > 1e-16 && size > 0) {
            o.axisX.normalize();
            o.normal.normalize();
            // Corner winding varies by source; keep the text's front face toward lab +Z.
            if (o.normal.z < 0) o.normal.negate();
            o.axisY.crossVectors(o.normal, o.axisX).normalize();
            o.number.quaternion.setFromRotationMatrix(
              o.basis.makeBasis(o.axisX, o.axisY, o.normal),
            );
            if (plate.position && plate.poseFrame === 'global') {
              o.posePosition.set(
                ...([0, 1, 2].map((j) => sample(plate.position!, time, j, true)) as [
                  number,
                  number,
                  number,
                ]),
              );
              if ([o.posePosition.x, o.posePosition.y, o.posePosition.z].every(Number.isFinite)) {
                // Position is the global origin. Project it onto the surface so
                // a below-plane sensor origin does not hide the label inside it.
                const distance = o.posePosition.clone().sub(o.number.position).dot(o.normal);
                o.number.position.copy(o.posePosition).addScaledVector(o.normal, -distance);
              }
            }
            o.number.position.addScaledVector(o.normal, 0.001);
            o.number.visible = o.mesh.visible && state.display.plateNumbers;
          }
        }
      }
      const force = sample3(plate.force, time),
        cop = sample3(plate.cop, time),
        magnitude = Math.hypot(...force),
        finite =
          force.every(Number.isFinite) &&
          cop.every(Number.isFinite) &&
          magnitude >= state.threshold;
      o.arrow.visible = global && finite && state.display.forces && magnitude > 0;
      o.point.visible = global && finite && state.display.cop;
      if (finite) {
        o.point.position.set(...cop);
        o.arrow.position.set(...cop);
        if (magnitude > 0) {
          o.arrow.setDirection(new THREE.Vector3(...force).divideScalar(magnitude));
          const length = magnitude * state.forceScale;
          o.arrow.setLength(length, Math.min(0.07, length * 0.25), Math.min(0.03, length * 0.12));
        }
      }
    });
  });
  return (
    <group>
      {objects.map((o, i) => (
        <group key={i}>
          <primitive object={o.mesh} frustumCulled={false} />
          <primitive object={o.outline} frustumCulled={false} />
          <primitive object={o.arrow} />
          <primitive object={o.point} />
          <primitive object={o.number} />
        </group>
      ))}
    </group>
  );
}
function Ground() {
  const grid = useSession((s) => s.display.grid),
    axes = useSession((s) => s.display.axes);
  return (
    <>
      {grid && <gridHelper args={[20, 40, '#3c4d5b', '#24333f']} rotation={[Math.PI / 2, 0, 0]} />}{' '}
      {axes && <axesHelper args={[0.5]} />}
    </>
  );
}
export function Viewer3D({ data }: { data: MotionData | null }) {
  return (
    <div className="viewport">
      <Canvas
        camera={{ position: [2, -3, 2], up: [0, 0, 1], near: 0.005, far: 2000, fov: 42 }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
        fallback={
          <div className="empty-state">
            WebGL is unavailable. Enable hardware acceleration to use the 3D viewer.
          </div>
        }
      >
        <color attach="background" args={['#111c26']} />
        <ambientLight intensity={1.3} />
        <directionalLight position={[3, -2, 5]} intensity={2} />
        <Ground />
        {data ? (
          <>
            <Camera data={data} />
            <Markers data={data} />
            <Connections data={data} />
            <MarkerLabels data={data} />
            <Plates data={data} />
          </>
        ) : (
          <OrbitControls makeDefault />
        )}
      </Canvas>
      <div className="viewport-title">
        <span className="live-dot" /> LAB SPACE <span className="muted">XYZ · metres · Z up</span>
      </div>
      <div className="camera-tools">
        {(['perspective', 'front', 'side', 'top'] as CameraPreset[]).map((p) => (
          <button
            key={p}
            disabled={!data}
            onClick={() => setCamera(p)}
            title={p === 'perspective' ? 'Reset camera' : `${p} view`}
          >
            {p === 'perspective' ? 'Reset' : p[0].toUpperCase() + p.slice(1)}
          </button>
        ))}
      </div>
      <div className="viewport-footer">
        <span>
          <i className="axis-x">X</i> <i className="axis-y">Y</i> <i className="axis-z">Z</i>
        </span>
        <span>Drag to orbit · Right drag to pan · Scroll to zoom</span>
      </div>
    </div>
  );
}
