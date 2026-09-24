export function croppedFilename(name: string) {
  return name.replace(/\.(c3d|h5|hdf5)$/i, '_cropped.$1');
}
