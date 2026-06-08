import React, { useState } from "react";
import { PageHeader } from "../components/common";

export interface NewInspectionFormProps {
  onStartSession: (values: {
    customerName: string;
    vehicleNumber: string;
    carModel: string;
  }) => Promise<void>;
  onCancel: () => void;
}

export function NewInspectionForm({
  onStartSession,
  onCancel
}: NewInspectionFormProps) {
  const [customerName, setCustomerName] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [carModel, setCarModel] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const isValid =
    customerName.trim().length > 1 &&
    vehicleNumber.trim().length > 2 &&
    carModel.trim().length > 1;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) {
      setError("Please fill in all fields correctly.");
      return;
    }

    setError("");
    setLoading(true);
    try {
      await onStartSession({
        customerName: customerName.trim(),
        vehicleNumber: vehicleNumber.trim().toUpperCase(),
        carModel: carModel.trim()
      });
    } catch (err: any) {
      setError(err.message || "Failed to create session. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="new-inspection-wrapper">
      <form className="surface form-card" onSubmit={handleSubmit}>
        <span className="eyebrow">Audit Setup</span>
        <h1>Initialize Audit Session</h1>
        <p className="form-description">
          Enter the customer information and vehicle identifiers below. A unique audit ledger session will be created to securely link all uploaded evidence.
        </p>

        <div className="field-grid">
          <label>
            <span>Customer Full Name</span>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="e.g. John Doe"
              autoFocus
              required
            />
          </label>

          <label>
            <span>Vehicle Registration / Plate</span>
            <input
              type="text"
              value={vehicleNumber}
              onChange={(e) => setVehicleNumber(e.target.value)}
              placeholder="e.g. KA01AB1234"
              required
            />
          </label>

          <label>
            <span>Car Model & Trim</span>
            <input
              type="text"
              value={carModel}
              onChange={(e) => setCarModel(e.target.value)}
              placeholder="e.g. White Hyundai Creta SX"
              required
            />
          </label>
        </div>

        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="form-actions">
          <button
            className="secondary-action"
            type="button"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            className="primary-action"
            type="submit"
            disabled={!isValid || loading}
          >
            {loading ? "Creating..." : "Initialize Session"}
          </button>
        </div>
      </form>
    </div>
  );
}
