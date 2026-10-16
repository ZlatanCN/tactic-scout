import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const RecordedRunShowcase = lazy(() => import("./RecordedRunShowcase").then((module) => ({ default: module.RecordedRunShowcase })));
const ShortlistReviewWorkbench = lazy(() => import("./ShortlistReviewWorkbench").then((module) => ({ default: module.ShortlistReviewWorkbench })));
const ShortlistAdjudicationWorkbench = lazy(() => import("./ShortlistAdjudicationWorkbench").then((module) => ({ default: module.ShortlistAdjudicationWorkbench })));

const PositionSelectionLab = import.meta.env.DEV ? lazy(() => import("./PositionSelectionLab").then((module) => ({ default: module.PositionSelectionLab }))) : null;

const path = window.location.pathname.replace(/\/+$/, "");
const isReviewPage = path === "/review";
const isAdjudicationPage = path === "/adjudicate";
const isShowcasePage = path === "/showcase";

if (isShowcasePage) document.title = "TactiScout — 录制运行展示";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Suspense fallback={<main className="route-loading" role="status">正在打开工作台…</main>}>
      {PositionSelectionLab && path === "/dev/position-selection" ? <PositionSelectionLab /> : isShowcasePage
        ? <RecordedRunShowcase />
        : isReviewPage
          ? <ShortlistReviewWorkbench />
          : isAdjudicationPage ? <ShortlistAdjudicationWorkbench /> : <App />}
    </Suspense>
  </React.StrictMode>,
);
