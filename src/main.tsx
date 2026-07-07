import { lazy, Suspense } from "solid-js";
import { render } from "solid-js/web";
import App from "./App";
import "./app.css";

const TaxCalculator = lazy(() => import("./tax/TaxCalculator"));

const root = document.getElementById("root");

function pickRoute() {
  const path = window.location.pathname;
  if (path === "/tax" || path.startsWith("/tax/")) {
    return TaxCalculator;
  }
  return App;
}

if (root) {
  const Route = pickRoute();
  render(
    () => (
      <Suspense fallback={null}>
        <Route />
      </Suspense>
    ),
    root,
  );
}
