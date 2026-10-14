import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { Home } from "./Home";
import { Simulator } from "./Simulator";
import { About } from "./About";
import { SiteFooter } from "./components/SiteFooter";
import { currentRoute, type Route } from "./route";
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
  const [route, setRoute] = useState<Route>(currentRoute);
  useEffect(() => {
    const onHash = () => {
      setRoute(currentRoute());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
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
        <Simulator key={window.location.hash} />
      ) : (
        <App />
      )}
      {!isHome && <SiteFooter />}
    </React.StrictMode>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<Shell />);
