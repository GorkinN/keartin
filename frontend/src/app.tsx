import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "@/components/layout";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfigPage } from "@/pages/config";
import { CreatePage } from "@/pages/create";
import { HistoryDetailRoute, HistoryPage } from "@/pages/history";
import { ImageHistoryDetailRoute } from "@/pages/history-images";
import { ImagesPage } from "@/pages/images";
import { LibraryPage } from "@/pages/library";
import { PresetsPage } from "@/pages/presets";
import { TopicsPage } from "@/pages/topics";

export function App() {
  return (
    <BrowserRouter>
      <TooltipProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<LibraryPage />} />
            <Route path="/topics" element={<TopicsPage />} />
            <Route path="/create" element={<CreatePage />} />
            <Route path="/images" element={<ImagesPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/history/images/:id" element={<ImageHistoryDetailRoute />} />
            <Route path="/history/:id" element={<HistoryDetailRoute />} />
            <Route path="/presets" element={<PresetsPage />} />
            <Route path="/config" element={<ConfigPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </TooltipProvider>
    </BrowserRouter>
  );
}
