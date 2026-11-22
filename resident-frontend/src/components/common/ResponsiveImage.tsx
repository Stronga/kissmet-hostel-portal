type ResponsiveImageProps = {
  avif: string;
  webp: string;
  png: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  imgClassName?: string;
  loading?: "lazy" | "eager";
  fetchPriority?: "high" | "low" | "auto";
  decorative?: boolean;
};

export function ResponsiveImage({
  avif,
  webp,
  png,
  alt,
  width,
  height,
  className,
  imgClassName,
  loading = "lazy",
  fetchPriority,
  decorative = false
}: ResponsiveImageProps) {
  return (
    <picture className={className}>
      <source type="image/avif" srcSet={avif} />
      <source type="image/webp" srcSet={webp} />
      <img
        src={png}
        alt={decorative ? "" : alt}
        width={width}
        height={height}
        loading={loading}
        fetchPriority={fetchPriority}
        className={imgClassName}
        aria-hidden={decorative || undefined}
      />
    </picture>
  );
}
