import assert from 'node:assert/strict';

/** Real pointer events using the camera suite's development-only scene probe. */
export async function verifyMarkerPicking(page, { demo = false } = {}) {
  const viewer = page.getByLabel('3D Viewer', { exact: true });
  const menu = page.getByRole('menu', { name: /^Marker:/ });
  const selected = () => page.evaluate(() => window.cameraProbe.useSession.getState().selected);
  const settle = () => page.waitForTimeout(120);
  const reset = async () => {
    await viewer.focus();
    await page.keyboard.press('f');
    await settle();
  };
  const selectOther = (marker) =>
    page.evaluate((m) => {
      const probe = window.cameraProbe;
      const count = probe.useSession.getState().data.markers.labels.length;
      probe.selectMarker((m + Math.floor(count / 2)) % count);
    }, marker);
  const point = (m) => page.evaluate((marker) => window.cameraProbe.markerPoint(marker), m);
  const nearCase = (onlyMarker = null) =>
    page.evaluate((onlyMarker) => {
      const probe = window.cameraProbe,
        s = probe.useSession.getState();
      const rect = document.querySelector('.viewport canvas').getBoundingClientRect();
      const points = s.data.markers.labels
        .map((_, m) => ({ m, p: probe.markerPoint(m) }))
        .filter(({ m, p }) => p && !s.hidden.has(m));
      for (const { m, p } of points) {
        if (onlyMarker !== null && m !== onlyMarker) continue;
        if (
          onlyMarker === null &&
          points.some(({ m: other, p: q }) => other !== m && Math.hypot(p.x - q.x, p.y - q.y) < 20)
        )
          continue;
        if (
          p.x < rect.left + 30 ||
          p.x > rect.right - 30 ||
          p.y < rect.top + 65 ||
          p.y > rect.bottom - 40
        )
          continue;
        if (probe.markerHits(p.x, p.y)[0] !== m) continue;
        for (const [dx, dy] of [
          [9, 0],
          [-9, 0],
          [0, 9],
          [0, -9],
        ]) {
          const x = p.x + dx,
            y = p.y + dy;
          if (probe.markerHits(x, y).length) continue;
          if (points.some(({ m: other, p: q }) => other !== m && Math.hypot(x - q.x, y - q.y) < 12))
            continue;
          return { marker: m, x, y };
        }
      }
      return null;
    }, onlyMarker);

  await page.evaluate(() => window.cameraProbe.setFrame(0));
  await reset();
  const initialSize = page.viewportSize();
  const initialPick = await nearCase();
  assert(initialPick);
  const fixedMarker = initialPick.marker;
  const cases = [];
  for (const [size, factor] of [
    [initialSize, 0.6],
    [initialSize, demo ? 2 : 4],
    [{ width: 1440, height: 1000 }, demo ? 1.5 : 3],
  ]) {
    await page.setViewportSize(size);
    await reset();
    await page.evaluate((m) => window.cameraProbe.selectMarker(m), fixedMarker);
    await viewer.focus();
    await page.keyboard.press('c');
    await settle();
    await page.evaluate((f) => window.cameraProbe.scaleDistance(f), factor);
    await selectOther(fixedMarker);
    await settle();
    const pick = await nearCase(fixedMarker);
    assert(pick, `isolated near miss exists: demo=${demo}, factor=${factor}`);
    const p = await point(pick.marker);
    await selectOther(pick.marker);
    await page.mouse.click(p.x, p.y);
    assert.equal(await selected(), pick.marker, 'direct sphere hit');
    await selectOther(pick.marker);
    await settle();
    await page.mouse.click(pick.x, pick.y);
    assert.equal(await selected(), pick.marker, '9px miss selects marker');
    await selectOther(pick.marker);
    await settle();
    await page.mouse.click(pick.x, pick.y, { button: 'right' });
    await menu.waitFor();
    assert.equal(await selected(), pick.marker, '9px right miss opens correct marker menu');
    await page.keyboard.press('Escape');
    cases.push({ size, factor, marker: pick.marker });
  }
  assert.equal(await page.evaluate(() => devicePixelRatio), 2);
  await viewer.focus();
  await page.keyboard.press('c');
  await settle();
  const focus = await page.evaluate(() => window.cameraProbe.snapshot());
  const world = (await point(await selected())).world;
  focus.target.forEach((v, i) => assert(Math.abs(v - world[i]) < 1e-6, 'C focuses picked marker'));

  await reset();
  const pick = await nearCase();
  assert(pick);
  const box = await page.locator('.viewport canvas').boundingBox();
  await selectOther(pick.marker);
  const before = await selected();
  await page.evaluate((m) => window.cameraProbe.toggleMarker(m), pick.marker);
  await settle();
  await page.mouse.click(pick.x, pick.y);
  assert.equal(await selected(), before, 'hidden markers are excluded from fallback');
  await page.evaluate((m) => window.cameraProbe.toggleMarker(m), pick.marker);
  await page.evaluate(() => {
    const s = window.cameraProbe.useSession.getState();
    window.cameraProbe.useSession.setState({ display: { ...s.display, markers: false } });
  });
  await settle();
  await page.mouse.click(pick.x, pick.y, { button: 'right' });
  assert.equal(await selected(), before, 'disabled marker display cannot be picked');
  assert.equal(await menu.count(), 0);
  await page.evaluate(() => {
    const s = window.cameraProbe.useSession.getState();
    window.cameraProbe.useSession.setState({ display: { ...s.display, markers: true } });
  });
  await settle();
  await page.mouse.click(box.x + 15, box.y + box.height - 40);
  assert.equal(await selected(), before, 'empty left click preserves selection');
  await page.mouse.click(box.x + 15, box.y + box.height - 40, { button: 'right' });
  assert.equal(await menu.count(), 0, 'empty right click has no marker menu');
  assert.equal(await selected(), before);

  // Returning excursions exercise the bug that an endpoint-only delta misses.
  for (const button of ['left', 'right']) {
    const p = await point(pick.marker);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down({ button });
    await page.mouse.move(p.x + 35, p.y + 15, { steps: 5 });
    await page.mouse.move(p.x, p.y, { steps: 5 });
    await page.mouse.up({ button });
    assert.equal(await selected(), before, `${button} returning drag does not select`);
    assert.equal(await menu.count(), 0, `${button} returning drag does not open menu`);
  }

  if (!demo) {
    await reset();
    await page.evaluate(() => window.cameraProbe.scaleDistance(2));
    await settle();
    // Separate neighbouring markers can each be selected through their centres.
    for (const marker of [6, 7]) {
      const p = await point(marker);
      await page.mouse.click(p.x, p.y);
      assert.equal(await selected(), marker, 'nearby markers remain individually selectable');
    }
    const p = await point(6),
      q = await point(7);
    await page.evaluate(() => window.cameraProbe.selectMarker(0));
    const middle = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    assert(Math.hypot(p.x - q.x, p.y - q.y) < 24, 'test markers are within overlapping tolerance');
    assert.deepEqual(
      await page.evaluate(({ x, y }) => window.cameraProbe.markerHits(x, y), middle),
      [],
    );
    await page.mouse.click(middle.x, middle.y);
    assert.equal(await selected(), 0, 'ambiguous miss preserves selection');
    await page.mouse.click(middle.x, middle.y, { button: 'right' });
    assert.equal(await menu.count(), 0, 'ambiguous right miss has no menu');

    // A true overlapping direct hit still chooses the frontmost marker.
    await page.evaluate(() => {
      const s = window.cameraProbe.useSession.getState();
      const camera = window.cameraProbe.snapshot().position.map((v) => v * 1000);
      const origin = Array.from(s.data.markers.positions.slice(0, 3));
      const offset = camera.map((v, i) => v - origin[i]);
      const length = Math.hypot(...offset);
      window.pickingSavedPosition = Array.from(s.data.markers.positions.slice(3, 6));
      s.data.markers.positions.set(
        origin.map((v, i) => v + (offset[i] / length) * 100),
        3,
      );
    });
    await settle();
    const overlap = await point(0);
    const front = await page.evaluate(
      ({ x, y }) => window.cameraProbe.markerHits(x, y)[0],
      overlap,
    );
    await page.mouse.click(overlap.x, overlap.y);
    assert.equal(await selected(), front, 'direct overlap retains raycast depth ordering');
    assert.equal(front, 1, 'the nearer marker wins even when later in label order');
    await page.evaluate(() => {
      const s = window.cameraProbe.useSession.getState();
      s.data.markers.positions.set(s.data.markers.positions.slice(0, 3), 3);
      window.cameraProbe.selectMarker(2);
    });
    await settle();
    await page.mouse.click(overlap.x, overlap.y);
    assert.equal(await selected(), 2, 'coincident direct surfaces are ambiguous');
    await page.evaluate(() => {
      window.cameraProbe.useSession
        .getState()
        .data.markers.positions.set(window.pickingSavedPosition, 3);
      delete window.pickingSavedPosition;
    });
  }
  await page.screenshot({ path: `.local/marker-picking-${demo ? 'demo' : 'synthetic'}.png` });
  await page.setViewportSize(initialSize);
  await reset();
  console.log(
    `Marker picking browser checks passed (${demo ? 'demo H5' : 'synthetic H5'}): ${JSON.stringify(cases)}`,
  );
}
