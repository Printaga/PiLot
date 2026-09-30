import "./styles/global.css";
import App from "./App.svelte";
import { mount, unmount } from "svelte";

const target = document.getElementById("app");
// A bare non-null assertion would throw an obscure error inside mount();
// fail with a diagnosable message instead — and put it on screen too: a throw
// in a packaged webview only reaches devtools, leaving the user a blank panel.
if (!target) {
  document.body.textContent = "PiLot Studio failed to start: the #app mount point is missing.";
  throw new Error("PiLot Studio: #app mount point not found (see index.html).");
}

const app = mount(App, { target });

// Vite re-executes this module on a hot update (dev server); unmount the
// previous tree so reloads don't leave a second app mounted inside #app.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    void unmount(app);
  });
}
