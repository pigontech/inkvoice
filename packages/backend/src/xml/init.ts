import { registerProfile } from "./profile-registry";
import { FacturxZugferdProfile } from "./profiles/facturx-zugferd";
import { FatturaPaProfile } from "./profiles/fatturapa";
import { UblPeppolProfile } from "./profiles/ubl-peppol";

export function initXmlProfiles(): void {
  registerProfile(new UblPeppolProfile());
  registerProfile(new FacturxZugferdProfile());
  registerProfile(new FatturaPaProfile());
}
