import React, { useEffect, useRef, useState } from "react";

type Box1000 = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type Severity = "minor" | "moderate" | "severe";

export type EvidenceBox1000 = Box1000 & {
  severity?: Severity;
};

export interface EvidenceImageProps {
  imageUrl: string;
  altText: string;
  box1000?: Box1000;
  boxes1000?: EvidenceBox1000[];
  highlighted?: boolean;
  objectFit?: "cover" | "contain";
}

export function EvidenceImage({
  imageUrl,
  altText,
  box1000,
  boxes1000,
  highlighted = true,
  objectFit = "cover"
}: EvidenceImageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setContainerSize({ width: rect.width, height: rect.height });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  if (!imageUrl) return null;

  const boxes: EvidenceBox1000[] = boxes1000 || (box1000 ? [box1000] : []);

  return (
    <div className="evidence-image-container" ref={containerRef}>
      <img
        src={imageUrl}
        alt={altText}
        className="evidence-img"
        style={{ objectFit }}
        onLoad={(event) => {
          setNaturalSize({
            width: event.currentTarget.naturalWidth,
            height: event.currentTarget.naturalHeight
          });
        }}
      />
      {highlighted && boxes.map((box, index) => (
        <span
          key={`${box.left}-${box.top}-${box.right}-${box.bottom}-${index}`}
          className="damage-box-overlay"
          style={{
            ...getOverlayStyle(box, objectFit, naturalSize, containerSize),
            ...getSeverityOverlayStyle(box.severity),
            minWidth: "8px",
            minHeight: "8px"
          }}
        />
      ))}
    </div>
  );
}

function getOverlayStyle(
  box: Box1000,
  objectFit: "cover" | "contain",
  naturalSize: { width: number; height: number },
  containerSize: { width: number; height: number }
): React.CSSProperties {
  if (
    objectFit !== "contain" ||
    naturalSize.width <= 0 ||
    naturalSize.height <= 0 ||
    containerSize.width <= 0 ||
    containerSize.height <= 0
  ) {
    return {
      left: `${box.left / 10}%`,
      top: `${box.top / 10}%`,
      width: `${(box.right - box.left) / 10}%`,
      height: `${(box.bottom - box.top) / 10}%`
    };
  }

  const imageRatio = naturalSize.width / naturalSize.height;
  const containerRatio = containerSize.width / containerSize.height;
  let renderedWidth = containerSize.width;
  let renderedHeight = containerSize.height;
  let offsetLeft = 0;
  let offsetTop = 0;

  if (imageRatio > containerRatio) {
    renderedHeight = containerSize.width / imageRatio;
    offsetTop = (containerSize.height - renderedHeight) / 2;
  } else {
    renderedWidth = containerSize.height * imageRatio;
    offsetLeft = (containerSize.width - renderedWidth) / 2;
  }

  return {
    left: `${offsetLeft + (box.left / 1000) * renderedWidth}px`,
    top: `${offsetTop + (box.top / 1000) * renderedHeight}px`,
    width: `${((box.right - box.left) / 1000) * renderedWidth}px`,
    height: `${((box.bottom - box.top) / 1000) * renderedHeight}px`
  };
}

function getSeverityOverlayStyle(severity?: Severity): React.CSSProperties {
  const color = severity === "severe"
    ? "229, 62, 62"
    : severity === "moderate"
      ? "221, 107, 32"
      : "49, 151, 149";

  return {
    borderColor: `rgb(${color})`,
    boxShadow: `0 0 8px rgba(${color}, 0.45)`,
    backgroundColor: `rgba(${color}, 0.15)`
  };
}
