import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./workspace.css";
import "./popup-surfaces.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
