import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Timeline } from '../src/components/Timeline';
import { EventControls, TimelineEvents } from '../src/components/EventEditor';
import { parseC3D } from '../src/importers/c3d/importer';
import { physicalFixture } from './helpers/c3d';

const fixture = () => parseC3D(physicalFixture(), 'timeline.c3d');

it('describes the crop operation and reserves a non-interactive secondary action slot', () => {
  const view = renderToStaticMarkup(createElement(Timeline, { data: fixture() }));
  expect(view).toContain('disabled="" title="Crop selected range"');
  expect(view).toContain('Apply crop');
  expect(view).toContain('Selection:');
  expect(view).toContain('class="crop-secondary"></div>');
  expect(view).not.toContain('Cancel crop');
  expect(view).not.toContain('Restore original');
  expect(view).not.toContain('visibility:hidden');
  expect(view).toContain('class="sr-only">Speed</span>');
  expect(view).toContain('title="Jump to first frame (Home)"');
  expect(view).toContain('title="Jump to last frame (End)"');
  expect(view).toContain('title="Drag to scrub (← / →, Home / End)"');
  expect(view).toContain('Frame 37, 0.000 seconds');
  expect(view).not.toContain('class="event-editor"');
});

it('keeps empty event selection in place and renders the time axis independently of the form', () => {
  const data = fixture();
  const empty = { ...data, events: [] };
  const controls = renderToStaticMarkup(createElement(EventControls, { data: empty }));
  expect(controls).toContain('aria-label="Select event" title="Select event to edit" disabled=""');
  expect(controls).toContain('Events (0)');
  const axis = renderToStaticMarkup(createElement(TimelineEvents, { data }));
  expect(axis).toContain('class="timeline-slider"');
  expect(axis).toContain('aria-label="Edit event A"');
  expect(axis).not.toContain('<form');
});
