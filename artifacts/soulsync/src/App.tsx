import { AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";
import { Landing } from "@/pages/Landing";
import { Onboarding } from "@/pages/Onboarding";
import { StudentApp } from "@/pages/StudentApp";
import { PsychLogin } from "@/pages/PsychLogin";
import { PsychDashboard } from "@/pages/PsychDashboard";
import { useStore } from "@/lib/store";
import type { UserProfile, Companion } from "@/lib/store";
import { useDbLoad, useDbSync } from "@/hooks/useDbSync";

type Screen =
  | "landing"
  | "onboarding"
  | "student"
  | "psych-login"
  | "psych-dashboard";

function AppInner() {
  const { user, companion, setUser, setCompanion, settings } = useStore();
  const [screen, setScreen] = useState<Screen>(() => {
    if (user && companion) return "student";
    return "landing";
  });
  const [psychLicenseId, setPsychLicenseId] = useState("");

  useDbLoad();
  useDbSync();

  // Apply theme class to root element
  useEffect(() => {
    const root = document.documentElement;
    const themes = ["theme-forest", "theme-midnight", "theme-ocean", "theme-sakura", "theme-amber", "dark"];
    root.classList.remove(...themes);
    if (settings.theme === "midnight") {
      root.classList.add("dark", "theme-midnight");
    } else {
      root.classList.add(`theme-${settings.theme}`);
    }
  }, [settings.theme]);

  const handleSelectRole = (role: "student" | "psych") => {
    if (role === "student") {
      if (user && companion) setScreen("student");
      else setScreen("onboarding");
    } else {
      setScreen("psych-login");
    }
  };

  const handleOnboardingComplete = (u: UserProfile, c: Companion) => {
    setUser(u);
    setCompanion(c);
    setScreen("student");
  };

  const handlePsychLogin = (id: string) => {
    setPsychLicenseId(id);
    setScreen("psych-dashboard");
  };

  const handleStudentLogout = () => {
    setUser(null as any);
    setCompanion(null as any);
    setScreen("landing");
  };

  return (
    <AnimatePresence mode="wait">
      {screen === "landing" && (
        <Landing key="landing" onSelectRole={handleSelectRole} />
      )}
      {screen === "onboarding" && (
        <Onboarding key="onboarding" onComplete={handleOnboardingComplete} />
      )}
      {screen === "student" && user && companion && (
        <StudentApp key="student" onLogout={handleStudentLogout} />
      )}
      {screen === "psych-login" && (
        <PsychLogin
          key="psych-login"
          onLogin={handlePsychLogin}
          onBack={() => setScreen("landing")}
        />
      )}
      {screen === "psych-dashboard" && (
        <PsychDashboard
          key="psych-dashboard"
          licenseId={psychLicenseId}
          onLogout={() => setScreen("landing")}
        />
      )}
    </AnimatePresence>
  );
}

export default function App() {
  return <AppInner />;
}
