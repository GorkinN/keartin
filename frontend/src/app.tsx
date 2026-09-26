import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "@/components/layout";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CreatePage } from "@/pages/create";
import { HistoryDetailRoute, HistoryPage } from "@/pages/history";
import { LibraryPage } from "@/pages/library";
import { PresetsPage } from "@/pages/presets";

export function App() {
  return (
    <BrowserRouter>
      <TooltipProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<LibraryPage />} />
            <Route path="/create" element={<CreatePage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/history/:id" element={<HistoryDetailRoute />} />
            <Route path="/presets" element={<PresetsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </TooltipProvider>
    </BrowserRouter>
  );
}
