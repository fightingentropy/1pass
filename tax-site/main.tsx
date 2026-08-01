import { render } from "solid-js/web";
import TaxCalculator from "../src/tax/TaxCalculator";
import "../src/app.css";

const root = document.getElementById("root");
if (root) render(() => <TaxCalculator />, root);
