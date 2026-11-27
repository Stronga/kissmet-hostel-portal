import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Showcase } from "./design-system/react/Showcase";
import "./design-system/tokens.css";
import "./design-system/components.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Showcase />
  </StrictMode>
);
