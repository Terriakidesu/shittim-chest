import { useSyncExternalStore } from "react";
import { getTheme, parseTheme, setTheme, subscribeTheme } from "../theme";

export function ThemeSwitch() {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getTheme);
  return <label className="theme-switch">Theme <select aria-label="Theme" value={theme} onChange={(event) => setTheme(parseTheme(event.target.value))}>
    <option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option>
  </select></label>;
}
