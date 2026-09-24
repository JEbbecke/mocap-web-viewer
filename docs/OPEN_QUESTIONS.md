# Open questions and scientific limits

1. H5 CoordinateSystem=0 contradicts the exporter and actual already-global force arrays. Recognized converter output follows stored values with a warning. Other local force frames are not automatically transformed. Establish a versioned schema with genuine rotations/positions before supporting local H5 sensors.
2. No trustworthy H5 event/rigid-body/connection schema or Type code table exists in the inspected sources. Preserve/document unknown information; do not interpret it.
3. H5 marker unit defaults to mm only for compatibility when missing, visibly disclosed. The older file lacks residuals; finite zeros cannot reliably be distinguished from true origin samples.
4. GlobalCoordinateSystem is empty; lab XYZ is retained and Z-up is a camera convention. Never apply the converter's OpenSim -90° rotation during viewing.
5. Reference force helpers have inconsistent axes, NaN-to-zero conversion, zero geometry defaults and placeholder rotation bugs. They are not a reliable independent correctness oracle for those fields; compare C3D forces against ezc3d and H5 raw datasets instead.
6. No source measurements may be committed/deployed. Local integration comparisons are opt-in; CI uses synthetic fixtures.
7. Installed ezc3d 1.7.0 decodes positive floating point residual magnitudes inconsistently with the published C3D format (reproduced with a synthetic 2.0 fourth word). Web uses the standard conversion and retains validity; exact values and reproduction are in VALIDATION.md. H5 may already contain an exporter-decoded residual; no correction is guessed without raw C3D records.
