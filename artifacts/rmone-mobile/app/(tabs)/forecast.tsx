import React from "react";

import VisualForecasting from "@/components/VisualForecasting";
import { useScreenBeacon } from "@/lib/usageBeacon";

export default function ForecastTab() {
  useScreenBeacon("Forecast");
  return <VisualForecasting />;
}
