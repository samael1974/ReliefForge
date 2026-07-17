// src/App.tsx
import { lazy, Suspense } from "react";
import { BrowserRouter, HashRouter, Routes, Route } from "react-router-dom";
import Home from "./pages/Index";
import NotFound from "./pages/NotFound";

// Desktop (Electron impacchettato, file://) richiede HashRouter; il web usa BrowserRouter.
// VITE_ELECTRON viene impostato solo dalla build desktop (script electron:build).
const Router = import.meta.env.VITE_ELECTRON ? HashRouter : BrowserRouter;

// Code-splitting: le pagine pesanti (three.js, transformers/onnx)
// vengono caricate solo quando l'utente apre la rotta corrispondente.
const Relief = lazy(() => import("./pages/Relief"));
const Depth = lazy(() => import("./pages/Depth"));
const Studio = lazy(() => import("./pages/Studio"));

const App = () => {
  return (
    <Router>
      <Suspense
        fallback={
          <div className="flex min-h-screen items-center justify-center text-slate-500">
            Caricamento…
          </div>
        }
      >
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/relief" element={<Relief />} />
          <Route path="/depth" element={<Depth />} />
          <Route path="/studio" element={<Studio />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </Router>
  );
};

export default App;
