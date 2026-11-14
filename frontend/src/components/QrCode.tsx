import qrcode from 'qrcode-generator';
import { useMemo } from 'react';
import { cn } from '../lib/cn';

interface QrCodeProps {
  value: string;
  /** Accessible name, e.g. "QR code of the deposit address". */
  label: string;
  /** Rendered size in px (the SVG scales crisply). */
  size?: number;
  className?: string;
  testId?: string;
}

/**
 * QR code drawn locally as SVG (no network). Always dark modules on a white quiet zone, in both
 * themes, because phone cameras and exchange apps expect that contrast.
 */
export function QrCode({ value, label, size = 176, className, testId }: QrCodeProps) {
  const { path, count } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        if (qr.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`;
      }
    }
    return { path: d, count: n };
  }, [value]);
  const quiet = 4;
  const box = count + quiet * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      data-testid={testId}
      data-value={value}
      viewBox={`${-quiet} ${-quiet} ${box} ${box}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className={cn('block shrink-0 rounded-lg border border-border bg-white', className)}
    >
      <rect x={-quiet} y={-quiet} width={box} height={box} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
