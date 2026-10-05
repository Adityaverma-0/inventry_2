import { useEffect, useState } from "react";
import { useApp } from "./ui";
import { Panel, Button, Empty, Input, Field, ErrorNotice } from "./ui";

export function SalesmanStockPage() {
  const { state } = useApp();
  return (
    <div className="sd-page">
       <div className="sd-header">
         <h2>My Vehicle Stock</h2>
       </div>
       <div className="sd-body">
         <Panel title="Current Inventory">
            <p>UI under construction. Connects to /api/v2/salesman/vehicle-stock</p>
         </Panel>
       </div>
    </div>
  );
}

export function AdminReportsPage() {
  const { state } = useApp();
  return (
    <div className="sd-page">
       <div className="sd-header">
         <h2>Daily Report Approvals</h2>
       </div>
       <div className="sd-body">
         <Panel title="Pending Reports">
            <p>UI under construction. Connects to /api/v2/admin/daily-reports</p>
         </Panel>
       </div>
    </div>
  );
}
