function toSvgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function hashString(input: string): number {
  return input.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
}

export function getPlayerAccent(name: string): { bg: string; fg: string } {
  const accents = [
    { bg: "#0f766e", fg: "#ccfbf1" },
    { bg: "#166534", fg: "#dcfce7" },
    { bg: "#1d4ed8", fg: "#dbeafe" },
    { bg: "#7c2d12", fg: "#ffedd5" },
    { bg: "#4c1d95", fg: "#ede9fe" },
    { bg: "#9a3412", fg: "#ffedd5" },
  ];

  return accents[hashString(name) % accents.length];
}

export function getVectorAvatarDataUri(name: string): string {
  const initials = name
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase())
    .slice(0, 2)
    .join("");
  const accent = getPlayerAccent(name);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <rect width="64" height="64" rx="32" fill="${accent.bg}" />
      <circle cx="32" cy="24" r="12" fill="${accent.fg}" opacity="0.18" />
      <text x="32" y="38" font-size="22" text-anchor="middle" fill="${accent.fg}" font-family="Arial, sans-serif" font-weight="700">${initials}</text>
    </svg>
  `;

  return toSvgDataUri(svg);
}

export function getPlayerThumbnailSrc(playerImg: string | undefined, playerName: string): string {
  if (playerImg && /^https?:\/\//i.test(playerImg)) {
    return playerImg;
  }

  if (playerImg && playerImg.startsWith("/")) {
    return playerImg;
  }

  return getVectorAvatarDataUri(playerName);
}
