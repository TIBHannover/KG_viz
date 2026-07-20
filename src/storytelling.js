// Storytelling Explorer — identical to Sensemaking (same matrix/chord/bundle
// left pane and dataset tiles), except selecting a dataset opens straight into
// the Storyline trail instead of the Egonet tree. See src/sensemaking.js for
// the shared implementation and src/storyline.js for the trail itself.

import { renderSensemaking } from './sensemaking.js';

export function renderStorytelling(container) {
  renderSensemaking(container, { title: 'Storytelling Explorer', directStoryline: true });
}
