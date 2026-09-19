import Image from "next/image";

export function MediverseLogo({ small = false }: { small?: boolean }) {
  return (
    <Image
      src="/mediverse-logo.svg"
      alt=""
      aria-hidden="true"
      width={small ? 32 : 48}
      height={small ? 32 : 48}
      className={`brand-mark${small ? " small" : ""}`}
      style={{ flexShrink: 0 }}
      loading="eager"
      unoptimized
    />
  );
}
