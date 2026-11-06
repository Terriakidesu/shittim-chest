import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { Home } from "./Home";
import { Simulator } from "./Simulator";
import { About } from "./About";
import { SiteFooter } from "./components/SiteFooter";
import { currentRoute, redirectLegacyHash } from "./route";
import { applySeo } from "./seo";
import "./styles.css";
import "./recruitment.css";
import "./recruitmentResults.css";
import { initializeTheme } from "./theme";
import { initializeLanguage, useLanguage } from "./i18n";

initializeTheme();
initializeLanguage();
// Before first paint, so an old shared #/simulator link lands on the simulator
// rather than silently rendering the lobby.
redirectLegacyHash();

/**
 * Each route is its own HTML document, so the route is fixed for the lifetime
 * of this component: there is nothing to listen for. Changing routes is a real
 * page load, which is what lets the server return route-specific metadata to a
 * crawler. Deep-link query parameters are read-only, so changing one is also a
 * page load, and the query-driven views mount without needing a remount key.
 */
function Shell() {
  const route = currentRoute();
  // Subscribing here (rather than inside each page) re-runs `applySeo` when
  // the language changes without remounting the page or its session state.
  useLanguage();
  applySeo(route);
  const isHome = route === "/";
  return (
    <React.StrictMode>
      {isHome ? (
        <Home />
      ) : route === "/about" ? (
        <About />
      ) : route === "/simulator" ? (
        <Simulator />
      ) : (
        <App />
      )}
      {!isHome && <SiteFooter />}
    </React.StrictMode>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<Shell />);
