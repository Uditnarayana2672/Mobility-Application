import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Hub from "./shared/Hub";

const OwnerPage = lazy(() => import("./owner/OwnerPage"));
const MarkersPage = lazy(() => import("./markers/MarkersPage"));
const EditorPage = lazy(() => import("./editor/EditorPage"));
const NavPage = lazy(() => import("./navigator/NavPage"));
const DashboardPage = lazy(() => import("./dashboard/DashboardPage"));
const AdsPage = lazy(() => import("./ads/AdsPage"));
const PreflightPage = lazy(() => import("./preflight/PreflightPage"));
const SurveyPage = lazy(() => import("./survey/SurveyPage"));
const SpikesIndex = lazy(() => import("./spikes/SpikesIndex"));
const S1 = lazy(() => import("./spikes/S1Page"));
const S2 = lazy(() => import("./spikes/S2Page"));
const S2Markers = lazy(() => import("./spikes/S2Markers"));
const S3 = lazy(() => import("./spikes/S3Page"));
const S4 = lazy(() => import("./spikes/S4Page"));
const S5 = lazy(() => import("./spikes/S5Page"));

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Suspense fallback={<div className="p-6 text-neutral-400">Loading…</div>}>
          <Routes>
            <Route path="/" element={<Hub />} />
            <Route path="/legacy-editor" element={<Index />} />
            <Route path="/editor" element={<EditorPage />} />
            <Route path="/nav" element={<NavPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/markers" element={<MarkersPage />} />
            <Route path="/owner" element={<OwnerPage />} />
            <Route path="/ads" element={<AdsPage />} />
            <Route path="/preflight" element={<PreflightPage />} />
            <Route path="/survey" element={<SurveyPage />} />
            <Route path="/spikes" element={<SpikesIndex />} />
            <Route path="/spikes/s1" element={<S1 />} />
            <Route path="/spikes/s2" element={<S2 />} />
            <Route path="/spikes/s2/markers" element={<S2Markers />} />
            <Route path="/spikes/s3" element={<S3 />} />
            <Route path="/spikes/s4" element={<S4 />} />
            <Route path="/spikes/s5" element={<S5 />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
