/* Private images use an authenticated same-origin redirect with expiring S3 URLs. */
/* eslint-disable @next/next/no-img-element */
export function ProductImage({
  imageId,
  alt,
  className,
}: {
  imageId: string;
  alt: string;
  className?: string;
}) {
  return (
    <img
      src={`/api/inventory/images/${encodeURIComponent(imageId)}`}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
    />
  );
}
