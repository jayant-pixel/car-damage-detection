import React from "react";

export interface EvidenceImageProps {
  imageUrl: string;
  altText: string;
  box1000?: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
  highlighted?: boolean;
}

export function EvidenceImage({
  imageUrl,
  altText,
  box1000,
  highlighted = true
}: EvidenceImageProps) {
  if (!imageUrl) return null;

  return (
    <div className="evidence-image-container">
      <img src={imageUrl} alt={altText} className="evidence-img" />
      {highlighted && box1000 && (
        <span
          className="damage-box-overlay"
          style={{
            left: `${box1000.left / 10}%`,
            top: `${box1000.top / 10}%`,
            width: `${(box1000.right - box1000.left) / 10}%`,
            height: `${(box1000.bottom - box1000.top) / 10}%`,
            minWidth: "8px",
            minHeight: "8px"
          }}
        />
      )}
    </div>
  );
}
