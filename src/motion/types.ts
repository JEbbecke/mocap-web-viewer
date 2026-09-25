export type Vec3 = [number, number, number];
/** All spatial arrays use lab XYZ, metres, Newtons, Newton-metres. No axis swap. */
export interface Series {
  values: Float64Array;
  rate: number;
  components: number;
  startTime: number;
  /** Explicit seconds relative to recording origin, including irregular clocks. */
  times?: Float64Array;
}
export interface ForcePlatform {
  name: string;
  force: Series;
  moment: Series;
  cop: Series;
  freeMoment?: Series;
  corners?: Series; // sample-major [corner, xyz], 12 components; one sample = static
  position?: Series; // plate origin in global XYZ, metres
  rotation?: Series; // row-major local-to-global 3x3 matrices, independent geometry clock
  origin?: Float64Array; // sensor offset below the surface; not a translation of global corners
  poseFrame?: 'global'; // declared global pose; legacy Position/Rotation may be placeholders
  coordinateFrame: 'global' | 'unresolved';
  provenance: string;
}
export interface MotionEvent {
  label: string;
  context: string;
  time: number;
  description?: string;
  subject?: string;
  /** Original EVENT row, used only to preserve opaque per-event metadata. */
  sourceIndex?: number;
}
export interface MotionData {
  name: string;
  source: {
    format: string;
    originalPositionUnit: string;
    metadata: Record<string, unknown>;
    /** Cumulative point boundaries in the immutable original file. */
    crop?: { start: number; end: number };
    eventsEdited?: boolean;
    timeOrigin?: number;
    eventSchema?: 'institute-v1';
  };
  timeline: { rate: number; frameCount: number; firstFrame: number; duration: number };
  markers: {
    labels: string[];
    positions: Float32Array | Float64Array; // [frame, marker, xyz]
    valid: Uint8Array; // [frame, marker]
    residuals?: Float32Array | Float64Array; // metres, negative = invalid
    quality?: {
      type?: Int8Array;
      cameraMasks?: Uint8Array;
      cameraCount: number;
      cameraMasksKnown?: Uint8Array;
      virtual?: Uint8Array;
    };
  };
  analogs: { name: string; unit: string; signal: Series }[];
  signals?: { name: string; group: string; unit: string; signal: Series }[];
  rigidBodies?: { name: string; markers: string[]; position: Series; rotation?: Series }[];
  forcePlatforms: ForcePlatform[];
  events: MotionEvent[];
  warnings: string[];
}
