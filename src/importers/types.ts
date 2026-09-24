import type { MotionData } from '../motion/types';
export interface MotionImporter {
  canImport(file: File): boolean;
  import(file: File): Promise<MotionData>;
}
