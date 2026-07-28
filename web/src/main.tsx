import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import App from "./App.tsx";
import Login from "./components/Login.tsx";
import LandingPage from "./components/LandingPage.tsx";
import { AuthProvider, useAuth } from "./lib/AuthContext.tsx";
import "./index.css";

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return null;
  if (!session)
    return <Navigate to="/login" replace state={{ from: location }} />;
  return <>{children}</>;
}

function LoginRoute() {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return null;
  if (session) {
    const state = location.state as { from?: { pathname?: string } } | null;
    const to = state?.from?.pathname ?? "/app";
    return <Navigate to={to} replace />;
  }
  return <Login />;
}

function LandingRoute() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  return (
    <LandingPage
      onLaunch={() => {
        if (loading) return;
        navigate(session ? "/app" : "/login");
      }}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<LandingRoute />} />
          <Route path="/login" element={<LoginRoute />} />
          <Route
            path="/app/*"
            element={
              <RequireAuth>
                <App />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
