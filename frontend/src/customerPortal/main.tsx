import React from "react";
import ReactDOM from "react-dom/client";

import { CustomerPortalApp } from "./CustomerPortalApp";
import { CustomerPortalProviders } from "./CustomerPortalProviders";
import "../styles/tailwind.css";
import "../styles/global.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <CustomerPortalProviders>
      <CustomerPortalApp onExitToAdmin={() => { window.location.assign("/admin"); }} />
    </CustomerPortalProviders>
  </React.StrictMode>
);
