import { render } from "solid-js/web";
import App from "./App";
import TaxCalculator from "./tax/TaxCalculator";
import "./app.css";

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
  render(() => <Route />, root);
}
