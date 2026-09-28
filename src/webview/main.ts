import "./styles/global.css";
import App from "./App.svelte";
import { mount } from "svelte";

const target = document.getElementById("app");
// A bare non-null assertion would throw an obscure error inside mount();
// fail with a diagnosable message instead.
if (!target) {
  throw new Error(
    "PiLot Studio: #app mount point not found — the webview HTML may have failed to load.",
  );
}

const app = mount(App, { target });

export default app;
