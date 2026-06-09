import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@tileborne/game-client/styles/menu.css";
import "./index.css";

import { App } from "./app.js";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("missing #root element");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
