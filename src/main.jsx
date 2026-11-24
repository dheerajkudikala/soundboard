import React from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.jsx";
import "./index.css";

registerSW({
  immediate: true,
  onNeedRefresh(update) {
    update?.(true);
  },
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    window.setInterval(() => registration.update(), 20_000);
    registration.update();
  },
});

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
