import React, { useState } from "react";
import { ConvexProvider, ConvexReactClient, useQuery, useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import { Sidebar } from "./components/Sidebar";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { NewInspectionForm } from "./pages/NewInspectionForm";
import { InspectionPage } from "./pages/InspectionPage";
import { ReportsPage } from "./pages/ReportsPage";
import { ReportPrintPage } from "./pages/ReportPrintPage";

const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
const convexClient = convexUrl ? new ConvexReactClient(convexUrl) : null;

const AUTH_KEY = "damagelens_session_auth";
const LOGIN_EMAIL = import.meta.env.VITE_APP_LOGIN_EMAIL || "jayanth@surensinfotek.com";
const LOGIN_PASSWORD = import.meta.env.VITE_APP_LOGIN_PASSWORD || "suresninfotek123456";
const PROFILE_NAME = import.meta.env.VITE_APP_PROFILE_NAME || "Jayanth";

type Page = "dashboard" | "new_inspection" | "analysis" | "reports" | "print_report";

function AppContent({ onLogout }: { onLogout: () => void }) {
  const dashboardData = useQuery(api.inspections.listDashboardInspections);
  const createInspection = useMutation(api.inspections.createInspection);
  const deleteInspection = useMutation(api.inspections.deleteInspection);

  const [page, setPage] = useState<Page>("dashboard");
  const [activeInspectionId, setActiveInspectionId] = useState<string | null>(null);

  const handleStartSession = async (values: {
    customerName: string;
    vehicleNumber: string;
    carModel: string;
  }) => {
    const inspectionId = await createInspection(values);
    setActiveInspectionId(inspectionId);
    setPage("analysis");
  };

  const handleDeleteSession = async (inspectionId: string, event: React.MouseEvent) => {
    event.stopPropagation(); // prevent opening the session
    if (confirm("Are you sure you want to delete this inspection session and all its uploaded files?")) {
      await deleteInspection({ inspectionId: inspectionId as any });
      if (activeInspectionId === inspectionId) {
        setActiveInspectionId(null);
        setPage("dashboard");
      }
    }
  };

  return (
    <div className="app-shell">
      <Sidebar
        currentPage={page}
        onPageChange={(nextPage) => {
          setPage(nextPage);
          if (nextPage === "dashboard") {
            setActiveInspectionId(null);
          }
        }}
        onNewInspection={() => {
          setActiveInspectionId(null);
          setPage("new_inspection");
        }}
        profileName={PROFILE_NAME}
        onLogout={onLogout}
      />

      <section className="workspace">
        {page === "dashboard" && (
          <DashboardPage
            dashboardData={dashboardData}
            onNew={() => setPage("new_inspection")}
            onOpen={(id) => {
              setActiveInspectionId(id);
              setPage("analysis");
            }}
            onDelete={handleDeleteSession}
          />
        )}

        {page === "new_inspection" && (
          <NewInspectionForm
            onStartSession={handleStartSession}
            onCancel={() => setPage("dashboard")}
          />
        )}

        {page === "analysis" && activeInspectionId && (
          <InspectionPage
            inspectionId={activeInspectionId}
            onBackToDashboard={() => {
              setActiveInspectionId(null);
              setPage("dashboard");
            }}
            onOpenPrintReport={() => setPage("print_report")}
          />
        )}

        {page === "print_report" && activeInspectionId && (
          <ReportPrintPage
            inspectionId={activeInspectionId}
            onBack={() => setPage("analysis")}
          />
        )}

        {page === "reports" && (
          <ReportsPage
            inspections={dashboardData?.inspections || []}
            onOpenSession={(id) => {
              setActiveInspectionId(id);
              setPage("analysis");
            }}
          />
        )}
      </section>
    </div>
  );
}

export function App() {
  const [isAuthed, setIsAuthed] = useState(() => localStorage.getItem(AUTH_KEY) === "true");
  const [authScreen, setAuthScreen] = useState<"landing" | "login">("landing");

  const handleLogout = () => {
    localStorage.removeItem(AUTH_KEY);
    setIsAuthed(false);
    setAuthScreen("landing");
  };

  if (!convexClient) {
    return (
      <main className="setup-shell">
        <div className="setup-panel">
          <h2>Convex Configuration Required</h2>
          <p>Please define <code>VITE_CONVEX_URL</code> in your environment variables.</p>
        </div>
      </main>
    );
  }

  if (!isAuthed) {
    return authScreen === "landing" ? (
      <LandingPage onSignIn={() => setAuthScreen("login")} />
    ) : (
      <LoginPage
        onBack={() => setAuthScreen("landing")}
        onSuccess={() => {
          localStorage.setItem(AUTH_KEY, "true");
          setIsAuthed(true);
        }}
        loginEmail={LOGIN_EMAIL}
        loginPass={LOGIN_PASSWORD}
      />
    );
  }

  return (
    <ConvexProvider client={convexClient}>
      <AppContent onLogout={handleLogout} />
    </ConvexProvider>
  );
}
export default App;
