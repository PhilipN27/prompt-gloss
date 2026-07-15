import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./app.css";
import "@prompt-gloss/panel-ui/card-panel.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Gloss: #root element not found");
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>
);
