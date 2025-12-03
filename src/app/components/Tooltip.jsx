"use client";

import { useState } from "react";

export default function Tooltip({ content, children, position = "bottom" }) {
  const [isVisible, setIsVisible] = useState(false);

  // Position classes based on prop
  const positionClasses = {
    bottom: "top-full mt-2 -left-36",
    top: "bottom-full mb-2 -left-36"
  };

  const arrowClasses = {
    bottom: "-top-2 left-1/2 transform -translate-x-1/2 rotate-45",
    top: "-bottom-2 left-1/2 transform -translate-x-1/2 rotate-45"
  };

  return (
    <div className="relative inline-block">
      <div
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
        onClick={() => setIsVisible(!isVisible)}
        className="cursor-help"
      >
        {children}
      </div>

      {isVisible && (
        <div className={`absolute z-50 w-80 p-4 ${positionClasses[position]} bg-slate-900 border border-slate-700 rounded-xl shadow-2xl text-xs text-slate-200 leading-relaxed whitespace-pre-line`}>
          <div className={`absolute w-4 h-4 bg-slate-900 border-l border-t border-slate-700 ${arrowClasses[position]}`}></div>
          {content}
        </div>
      )}
    </div>
  );
}
