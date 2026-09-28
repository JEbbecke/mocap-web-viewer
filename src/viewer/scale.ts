/** Temporary render coordinates only: 1000 scientific mm occupy one scene unit. */
export const SCENE_UNITS_PER_MM = 0.001;
export const sceneLength = (millimetres: number): number => millimetres * SCENE_UNITS_PER_MM;
