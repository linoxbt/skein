/** The Skein mark: three threads and the gold knot. */
export function Mark({ size = 22 }: { size?: number }) {
  const s = "M6 7c0-3 3-4 7-4s7 1.5 7 4.5S16 12 12.5 13 5 15.5 5 19s3.5 4.5 7.5 4.5c2.5 0 4.5-.6 5.5-1.6";
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden>
      <g fill="none" stroke="var(--color-thread)" strokeLinecap="round" strokeWidth="1.6">
        <path d={s} transform="translate(-1.6 0)" opacity="0.45" />
        <path d={s} opacity="0.7" />
        <path d={s} transform="translate(1.6 0)" />
      </g>
      <circle cx="20.5" cy="22.3" r="2.6" fill="var(--color-knot)" />
    </svg>
  );
}
