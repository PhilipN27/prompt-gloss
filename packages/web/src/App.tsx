import type { JSX } from "react";

// Bare shell. The chat pane, highlight affordance, card panel, and injection
// indicator are built in the web/UI track (see AGENTS.md) against the stable
// server API. This scaffold only proves the workspace compiles and renders.
export function App(): JSX.Element {
  return (
    <main>
      <h1>Gloss</h1>
      <p>The span-anchored context loop UI lands here.</p>
    </main>
  );
}
