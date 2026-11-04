/**
 * The giant footer wordmark. Drawn as SVG so it stays decoration: it is not
 * text a reader needs, and an SVG shape is not held to text contrast.
 */
export function Wordmark({ word, className = "" }: { word: string; className?: string }) {
  return (
    <svg className={className} viewBox={`0 0 ${word.length * 60} 80`} aria-hidden focusable="false" role="presentation">
      <text x="-4" y="74" fill="var(--color-panel-2)" fontFamily="var(--font-brand)" fontWeight={500} fontSize="100" letterSpacing="-6">
        {word}
      </text>
    </svg>
  );
}
