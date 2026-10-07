import { useLayoutEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { MotionData } from '../motion/types';
import { useSession } from '../state/session';

export type SceneDisplayState = Pick<
  ReturnType<typeof useSession.getState>,
  'selected' | 'hidden' | 'display' | 'forceScale' | 'threshold' | 'assumeGlobal'
>;
export type SceneObject = <T extends THREE.Object3D>(object: T) => T;
export type SceneUpdate = (time: number, state: SceneDisplayState, object: SceneObject) => void;
const registry = new WeakMap<THREE.Scene, Set<{ current: SceneUpdate }>>();
const identity: SceneObject = (object) => object;

/** Match live playback's point-sample hold; fractional force/geometry clocks use sample() separately. */
export function markerFrameAt(data: MotionData, time: number) {
  const index = time * data.timeline.rate;
  const nearest = Math.round(index);
  return Math.max(
    0,
    Math.min(
      data.timeline.frameCount - 1,
      Math.floor(Math.abs(index - nearest) < 1e-8 ? nearest : index),
    ),
  );
}

/** A single display update serves the live root and isolated media jobs. */
export function useScientificFrame(data: MotionData, update: SceneUpdate) {
  const scene = useThree((state) => state.scene);
  const latest = useRef(update);
  latest.current = update;
  useLayoutEffect(() => registerSceneUpdate(scene, latest), [scene]);
  useFrame(() => {
    const state = useSession.getState();
    latest.current(state.frame / data.timeline.rate, state, identity);
  });
}
export function registerSceneUpdate(scene: THREE.Scene, update: { current: SceneUpdate }) {
  let updates = registry.get(scene);
  if (!updates) {
    updates = new Set();
    registry.set(scene, updates);
  }
  updates.add(update);
  return () => {
    updates.delete(update);
  };
}

/** Snapshot current display objects, cloning mutable geometry/instances while sharing read-only materials. */
export function isolateScientificScene(scene: THREE.Scene, state: SceneDisplayState) {
  const clone = scene.clone();
  const mapping = new Map<THREE.Object3D, THREE.Object3D>();
  const geometries = new Set<THREE.BufferGeometry>();
  const pair = (live: THREE.Object3D, copy: THREE.Object3D) => {
    mapping.set(live, copy);
    if (copy instanceof THREE.Mesh || copy instanceof THREE.Line) {
      copy.geometry = copy.geometry.clone();
      geometries.add(copy.geometry);
    }
    live.children.forEach((child, index) => pair(child, copy.children[index]));
  };
  pair(scene, clone);
  const resolve: SceneObject = (object) => {
    const copy = mapping.get(object);
    if (!copy) throw new Error('The scientific scene changed during video export. Try again.');
    return copy as typeof object;
  };
  const snapshot = { ...state, hidden: new Set(state.hidden), display: { ...state.display } };
  const updates = [...(registry.get(scene) ?? [])].map((ref) => ref.current);
  return {
    scene: clone,
    update(time: number) {
      for (const update of updates) update(time, snapshot, resolve);
    },
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      clone.traverse((object) => {
        if (object instanceof THREE.InstancedMesh) object.dispose();
      });
      mapping.clear();
      geometries.clear();
      clone.clear();
    },
  };
}
