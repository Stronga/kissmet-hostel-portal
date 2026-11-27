import logo from "../assets/kissmet-logo-ident.png";

/** Official Kissmet ident. 791×541. Height is set; width follows so the artwork is not stretched. */
const LOGO_WIDTH = 791;
const LOGO_HEIGHT = 541;

export function BrandMark({
  height = 48,
  alt = "Kissmet",
  className
}: {
  height?: number;
  alt?: string;
  className?: string;
}) {
  const width = Math.round((height * LOGO_WIDTH) / LOGO_HEIGHT);
  return (
    <img
      className={className ? `km-brand-mark ${className}` : "km-brand-mark"}
      src={logo}
      alt={alt}
      width={width}
      height={height}
      style={{ height, width: "auto" }}
      decoding="async"
    />
  );
}
