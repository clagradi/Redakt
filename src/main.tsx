import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import EpsteinerApp from "../redakt-v7";
import { ErrorBoundary } from "./ErrorBoundary";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element not found");
}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <EpsteinerApp />
    </ErrorBoundary>
  </StrictMode>,
);
