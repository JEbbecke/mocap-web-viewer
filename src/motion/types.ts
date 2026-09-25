export type Vec3 = [number, number, number];
/** All spatial arrays use lab XYZ, metres, Newtons, Newton-metres. No axis swap. */
export interface Series {
  values: Float64Array;
  rate: number;
  components: number;
  startTime: number;
}
export interface ForcePlatform {
  name: string;
  force: Series;
  moment: Series;
  cop: Series;
  freeMoment?: Series;
  corners?: Series; // sample-major [corner, xyz], 12 components; one sample = static
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
  };
  timeline: { rate: number; frameCount: number; firstFrame: number; duration: number };
  markers: {
    labels: string[];
    positions: Float32Array; // [frame, marker, xyz]
    valid: Uint8Array; // [frame, marker]
    residuals?: Float32Array; // metres, negative = invalid
  };
  analogs: { name: string; unit: string; signal: Series }[];
  forcePlatforms: ForcePlatform[];
  events: MotionEvent[];
  warnings: string[];
}
