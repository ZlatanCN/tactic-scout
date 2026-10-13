import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { RecordedRunShowcase } from "./RecordedRunShowcase";
import { ShortlistReviewWorkbench } from "./ShortlistReviewWorkbench";
import { ShortlistAdjudicationWorkbench } from "./ShortlistAdjudicationWorkbench";
import "./styles.css";

const path = window.location.pathname.replace(/\/+$/, "");
const isReviewPage = path === "/review";
const isAdjudicationPage = path === "/adjudicate";
const isShowcasePage = path === "/showcase";

if (isShowcasePage) document.title = "TactiScout — 录制运行展示";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isShowcasePage
      ? <RecordedRunShowcase />
      : isReviewPage
      ? <ShortlistReviewWorkbench />
      : isAdjudicationPage ? <ShortlistAdjudicationWorkbench /> : <App />}
  </React.StrictMode>,
);
