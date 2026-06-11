/* Minimal inline icon set (stroke = currentColor). */
type P = { className?: string };
const base = (className?: string) => ({
  className,
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export const MemoryIcon = ({ className }: P) => (
  <svg {...base(className)}><path d="M12 5a3 3 0 0 0-3 3 3 3 0 0 0-1 5.8V17a2 2 0 0 0 2 2h.5" /><path d="M12 5a3 3 0 0 1 3 3 3 3 0 0 1 1 5.8V17a2 2 0 0 1-2 2h-.5" /><path d="M12 5v14" /></svg>
);
export const KeyIcon = ({ className }: P) => (
  <svg {...base(className)}><circle cx="7.5" cy="15.5" r="3.5" /><path d="m10 13 8-8" /><path d="m15 5 2 2" /><path d="m18 8 2-2" /></svg>
);
export const ActivityIcon = ({ className }: P) => (
  <svg {...base(className)}><path d="M3 12h4l3 8 4-16 3 8h4" /></svg>
);
export const ShieldIcon = ({ className }: P) => (
  <svg {...base(className)}><path d="M12 3 5 6v5c0 4.5 3 8 7 9 4-1 7-4.5 7-9V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></svg>
);
export const EyeIcon = ({ className }: P) => (
  <svg {...base(className)}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
);
export const ClockIcon = ({ className }: P) => (
  <svg {...base(className)}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);
export const PlusIcon = ({ className }: P) => (
  <svg {...base(className)}><path d="M12 5v14M5 12h14" /></svg>
);
export const CopyIcon = ({ className }: P) => (
  <svg {...base(className)}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></svg>
);
export const CheckIcon = ({ className }: P) => (
  <svg {...base(className)}><path d="m5 12 5 5L20 7" /></svg>
);
export const ExternalIcon = ({ className }: P) => (
  <svg {...base(className)}><path d="M14 4h6v6" /><path d="M20 4 10 14" /><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></svg>
);
export const SearchIcon = ({ className }: P) => (
  <svg {...base(className)}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
);
export const LockIcon = ({ className }: P) => (
  <svg {...base(className)}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
);
export const PlugIcon = ({ className }: P) => (
  <svg {...base(className)}><path d="M9 2v6M15 2v6" /><path d="M6 8h12v3a6 6 0 0 1-12 0V8Z" /><path d="M12 17v5" /></svg>
);
