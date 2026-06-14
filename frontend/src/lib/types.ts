export type InspectionStatus = "uploading" | "analyzing" | "done" | "failed";

export interface Inspection {
  _id: string;
  _creationTime: number;
  customerName: string;
  vehicleNumber: string;
  carModel: string;
  status: InspectionStatus;
  progress: number;
  progressMessage: string;
  totalDamageCount: number;
  totalImages: number;
  createdAt: number;
  completedAt?: number;
  reportSummary?: string;
}

export type MediaSlot =
  | "image_01" | "image_02" | "image_03" | "image_04" | "image_05"
  | "image_06" | "image_07" | "image_08" | "image_09" | "image_10"
  | "image_11" | "image_12" | "image_13" | "image_14" | "image_15"
  | "image_16" | "image_17" | "image_18" | "image_19" | "image_20";

export interface InspectionMedia {
  _id: string;
  inspectionId: string;
  slot: MediaSlot;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageId: string;
  viewLabel?: string;
  uploadedAt: number;
  url?: string | null;
  annotatedStorageId?: string;
  annotatedImageUrl?: string | null;
}

export interface PartCoverage {
  mediaId: string;
  fileName: string;
  viewLabel: string;
  imageUrl?: string | null;
  annotatedImageUrl?: string | null;
  visiblePartDescriptions: string[];
  mappedParts: Array<{
    partName: string;
    coveredParts: string[];
    box1000: {
      left: number;
      top: number;
      right: number;
      bottom: number;
    };
  }>;
}

export interface DamageResult {
  _id: string;
  inspectionId: string;
  mediaId: string;
  part: string;
  damageType: string;
  severity: "minor" | "moderate" | "severe";
  confidence: number;
  description: string;
  box1000: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
  isFromPartScan: boolean;
  partCropStorageId?: string;
  recommendation: string;
  createdAt: number;
  imageUrl?: string | null;
  annotatedImageUrl?: string | null;
  partCropUrl?: string | null;
  viewLabel?: string;
  fileName?: string;
  source?: "ml_model" | "vision_model";
  intensityScore?: number;
}

export interface RoiScan {
  _id: string;
  inspectionId: string;
  mediaId: string;
  partName: string;
  sourceBox1000: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
  expandedBox1000: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
  cropStorageId: string;
  zoomFactor: number;
  damageCount: number;
  status: "scanning" | "damage_found" | "no_damage";
  createdAt: number;
  imageUrl?: string | null;
  cropUrl?: string | null;
  viewLabel?: string;
  fileName?: string;
}

export interface IntegrityCheck {
  _id: string;
  inspectionId: string;
  checkType: "image_authenticity" | "vehicle_consistency";
  status: "pass" | "warning" | "fail";
  summary: string;
  details?: {
    brandMismatch?: boolean;
    licensePlateMismatch?: boolean;
    wheelMismatch?: boolean;
    colorMismatch?: boolean;
  };
  createdAt: number;
}

export interface InspectionLog {
  _id: string;
  inspectionId: string;
  message: string;
  createdAt: number;
}
