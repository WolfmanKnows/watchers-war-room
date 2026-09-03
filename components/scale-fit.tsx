"use client";

import { useEffect, useState, type ReactNode } from "react";

export function ScaleFit({
  width,
  height,
  children,
}: {
  width: number;
  height: number;
  children: ReactNode;
}) {
  const [scale, setScale] = useState(0.2);

  useEffect(() => {
    const fit = () => {
      const next = Math.min(window.innerWidth / width, window.innerHeight / height);
      setScale(Number.isFinite(next) && next > 0 ? next : 1);
    };
    fit();
    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", fit);
    return () => {
      window.removeEventListener("resize", fit);
      window.removeEventListener("orientationchange", fit);
    };
  }, [width, height]);

  return (
    <div className="scale-letterbox">
      <div
        className="scale-stage"
        style={{
          width,
          height,
          transform: `scale(${scale})`,
          transformOrigin: "center center",
        }}
      >
        {children}
      </div>
    </div>
  );
}
