import { Navigate, Route, Routes } from "react-router-dom";
import TrainPage from "./pages/TrainPage";
import ProjectsPage from "./pages/ProjectsPage";
import NewProjectPage from "./pages/NewProjectPage";
import ProjectDetailPage from "./pages/ProjectDetailPage";
import AuthPage from "./pages/AuthPage";

export default function App() {
  return (
    <div className="min-h-screen text-white">
      <main className="mx-auto max-w-6xl px-4 py-10">
        <Routes>
          <Route path="/" element={<Navigate to="/auth" replace />} />
          <Route path="/auth" element={<AuthPage />} />
      
          <Route path="/train" element={<TrainPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
          <Route path="/projects/new" element={<NewProjectPage />} />
          <Route path="*" element={<Navigate to="/auth" replace />} />
        </Routes>
      </main>
    </div>
  );
}
