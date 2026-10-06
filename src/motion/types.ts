import type { MOTION_UNITS } from './units';
import type { RecordingInfo } from './metadata';

export type Vec3 = [number, number, number];
/** MotionData uses lab XYZ: positions/distances in mm, forces in N, moments in Nm.
 * Series units follow their field; analog and named signals retain explicit source units. */
export interface Series {
  values: Float64Array;
  rate: number;
  components: number;
  startTime: number;
  /** Explicit seconds relative to recording origin, including irregular clocks. */
  times?: Float64Array;
}
/** Original C3D definition embedded in H5, in mm/N/Nmm conventions.
 * Channel identities are zero-based original analog column IDs. */
export interface C3DPlateDefinition {
  type: 2 | 3 | 4;
  channels: number[];
  corners: Float64Array;
  origin: Vec3;
  calibration?: Float64Array;
  copPolynomial?: Float64Array;
}
export interface C3DAnalogEncoding {
  scale: Float64Array;
  offset: Float64Array;
}
export interface ForcePlatform {
  name: string;
  sourceIndex?: number;
  sourcePath?: string;
  force: Series;
  moment: Series;
  cop: Series;
  freeMoment?: Series;
  corners?: Series; // sample-major [corner, xyz], 12 components; one sample = static
  position?: Series; // plate origin in global XYZ, mm
  rotation?: Series; // row-major local-to-global 3x3 matrices, independent geometry clock
  origin?: Float64Array; // sensor offset in mm below the surface; not a translation of global corners
  poseFrame?: 'global'; // declared global pose; legacy Position/Rotation may be placeholders
  coordinateFrame: 'global' | 'unresolved';
  provenance: string;
  c3dSource?: { definition?: C3DPlateDefinition; issue?: string };
}
export interface MotionEvent {
  label: string;
  context: string;
  time: number;
  description?: string;
  subject?: string;
  /** Original EVENT row, used only to preserve opaque per-event metadata. */
  sourceIndex?: number;
  /** Original H5 frame; export recomputes it only when event time changes. */
  sourceFrame?: number;
  genericFlag?: number;
  iconId?: number;
}
export interface MotionData {
  readonly units: typeof MOTION_UNITS;
  name: string;
  source: {
    format: string;
    originalPositionUnit: string;
    metadata: Record<string, unknown>;
    /** Curated embedded metadata; raw metadata and original File remain intact. */
    info?: RecordingInfo;
    /** Cumulative point boundaries in the immutable original file. */
    crop?: { start: number; end: number };
    eventsEdited?: boolean;
    labelsEdited?: boolean;
    analogLabelsEdited?: boolean;
    /** Small label overrides keyed by collection and stable in-memory index. */
    dataLabels?: Record<string, string>;
    timeOrigin?: number;
    eventSchema?: 'institute-v1' | 'institute-current';
    h5Layout?: 'legacy' | 'institute-v1' | 'institute-current';
    c3dAnalogEncoding?: C3DAnalogEncoding;
  };
  timeline: { rate: number; frameCount: number; firstFrame: number; duration: number };
  markers: {
    labels: string[];
    /** Imported labels anchor built-in preset links to stable source-column indices. */
    connectionLabels?: string[];
    positions: Float32Array | Float64Array; // [frame, marker, xyz]
    valid: Uint8Array; // [frame, marker]
    residuals?: Float32Array | Float64Array; // mm, negative = invalid
    quality?: {
      type?: Int8Array;
      cameraMasks?: Uint8Array;
      cameraCount: number;
      cameraMasksKnown?: Uint8Array;
      virtual?: Uint8Array;
    };
  };
  analogs: { name: string; unit: string; signal: Series; sourceChannel?: number }[];
  signals?: {
    name: string;
    group: string;
    unit: string;
    signal: Series;
    sourceIndex?: number;
    sourcePath?: string;
    sourceChannel?: number;
    /** Dedicated EMG may reference an identical analog signal without duplicating arrays. */
    analogIndex?: number;
  }[];
  rigidBodies?: {
    name: string;
    markers: string[];
    position: Series;
    rotation?: Series;
    sourcePath?: string;
  }[];
  forcePlatforms: ForcePlatform[];
  events: MotionEvent[];
  warnings: string[];
}
