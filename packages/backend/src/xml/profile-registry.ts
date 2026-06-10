import type { XmlProfile } from "./base-profile";

const profiles = new Map<string, XmlProfile>();

export function registerProfile(profile: XmlProfile): void {
  profiles.set(profile.getProfileId(), profile);
}

export function getProfile(id: string): XmlProfile | undefined {
  return profiles.get(id);
}

export function listProfiles(): { id: string; name: string }[] {
  return Array.from(profiles.values()).map((p) => ({
    id: p.getProfileId(),
    name: p.getProfileName(),
  }));
}
