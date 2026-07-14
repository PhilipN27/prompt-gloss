import "@prompt-gloss/panel-ui/card-panel.css";

// Slice 1 only establishes the bundled webview entry. The CardPanel mount and
// host messaging protocol are added in Slice 2.
const root = document.getElementById("root");

if (root !== null) {
  root.dataset.glossWebview = "ready";
}
