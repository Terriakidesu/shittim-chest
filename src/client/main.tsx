import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { Home } from "./Home";
import { Simulator } from "./Simulator";
import { About } from "./About";
import { SiteFooter } from "./components/SiteFooter";
import { routeFromHash, type Route } from "./route";
import "./styles.css";
import { initializeTheme } from "./theme";

initializeTheme();

const TITLES: Record<Route, string> = {
  "/": "Shittim Chest — Lobby",
  "/calendar": "Calendar — Shittim Chest",
  "/simulator": "Recruitment simulator — Shittim Chest",
  "/about": "About & credits — Shittim Chest",
};

function Shell() {
  // Track the raw hash (not just the route) so query-only changes — e.g. one
  // simulator deep link to another — remount the query-driven views.
  // Bare `#fragment` links (about-page sections) are in-page anchors and
  // must not change the route.
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onHash = () => {
      const next = window.location.hash;
      if (next === "" || next === "#" || next.startsWith("#/")) {
        setHash(next);
        window.scrollTo(0, 0);
      }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const route = routeFromHash(hash);
  useEffect(() => {
    document.title = TITLES[route];
  }, [route]);
  const isHome = route === "/";
  return (
    <React.StrictMode>
      {isHome ? (
        <Home />
      ) : route === "/about" ? (
        <About />
      ) : route === "/simulator" ? (
        <Simulator key={hash} />
      ) : (
        <App />
      )}
      {!isHome && <SiteFooter />}
    </React.StrictMode>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<Shell />);
