export interface GhostfolioNgBuildInfo {
  buildNumber?: string;
  upstreamVersion: string;
}

export function parseGhostfolioNgBuildInfo(
  value: unknown
): GhostfolioNgBuildInfo | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const { buildNumber, upstreamVersion } = value as GhostfolioNgBuildInfo;

  if (
    typeof upstreamVersion !== 'string' ||
    upstreamVersion.trim() !== upstreamVersion ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(upstreamVersion)
  ) {
    return undefined;
  }

  return {
    ...(typeof buildNumber === 'string' &&
    buildNumber.trim() === buildNumber &&
    /^[1-9]\d*$/.test(buildNumber)
      ? { buildNumber }
      : {}),
    upstreamVersion
  };
}
