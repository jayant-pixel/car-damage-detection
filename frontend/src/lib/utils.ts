export function formatDate(value: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric"
  }).format(value);
}

export function labelize(value: string): string {
  if (!value) return "";
  return value.replaceAll("_", " ");
}

export function vehicleName(session: {
  carModel?: string;
  vehicleNumber?: string;
}): string {
  return session.carModel || "Vehicle not specified";
}

export function getViewDisplayName(viewLabel?: string, fileName?: string): string {
  if (viewLabel) return viewLabel;
  return "Pending Analysis";
}
