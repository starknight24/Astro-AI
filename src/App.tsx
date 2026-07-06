import { useState } from "react";
import LandingPage from "./components/LandingPage";
import Dashboard from "./components/Dashboard";

export default function App() {
  const [view, setView] = useState<"landing" | "app">("landing");

  const launch = () => {
    window.scrollTo(0, 0);
    setView("app");
  };

  if (view === "landing") {
    return <LandingPage onLaunch={launch} />;
  }

  return <Dashboard />;
}
