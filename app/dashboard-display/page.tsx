import type { Metadata } from "next";
import { DashboardDisplay } from "./dashboard-display";

export const metadata: Metadata = {
  title: "Mefford Dashboard Display",
  description: "Read-only company dashboard display.",
};

export default function DashboardDisplayPage() {
  return <DashboardDisplay />;
}
