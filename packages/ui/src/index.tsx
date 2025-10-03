import * as React from "react";
export const Card: React.FC<{ className?: string, children?: React.ReactNode }> =
  ({ className="", children }) => (<div className={`rounded-2xl shadow p-4 ${className}`}>{children}</div>);
