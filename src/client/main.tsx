import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { Home } from "./Home";
import { Simulator } from "./Simulator";
import { About } from "./About";
import { SiteFooter } from "./components/SiteFooter";
import "./styles.css";
import { initializeTheme } from "./theme";

initializeTheme();
const pathname = window.location.pathname.replace(/\/$/, "") || "/";
if (pathname === "/about") document.title = "About & credits — Shittim Chest";
if (pathname === "/calendar") document.title = "Calendar — Shittim Chest";
if (pathname === "/simulator") document.title = "Recruitment simulator — Shittim Chest";
const isHome = pathname === "/";
if (isHome) document.title = "Shittim Chest — Lobby";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isHome ? <Home /> : pathname === "/about" ? <About /> : pathname === "/simulator" ? <Simulator /> : <App />}
    {!isHome && <SiteFooter />}
  </React.StrictMode>,
);
