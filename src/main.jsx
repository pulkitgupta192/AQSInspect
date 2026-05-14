console.log("✅✅✅ React main.jsx executed ✅✅✅");

import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

const container = document.getElementById("root");

// ✅ Reuse the root if it already exists (important for Vite + Electron)
let root = container._reactRoot;

if (!root) {
  root = ReactDOM.createRoot(container);
  container._reactRoot = root;
}

root.render(<App />);