// Brand registry. Keep each brand's settings in its own JSON file under ./brands/.
// Add active brands to this map so invitations can be selected by flow slug
// and invite-mailer hostname. The example brand is intentionally not registered.

import fagmob from "./brands/fagmob.json";
import dreamnet from "./brands/dreamnet.json";

export const BRANDS = {
  fagmob,
  dreamnet,
};

const BY_FLOW = new Map();
const BY_MAILER_HOST = new Map();
for (const [key, brand] of Object.entries(BRANDS)) {
  const host = brand.mailerHost.toLowerCase();
  if (BY_MAILER_HOST.has(host)) {
    throw new Error(`mailer host "${host}" is mapped to both ${BY_MAILER_HOST.get(host).key} and ${key}`);
  }
  BY_MAILER_HOST.set(host, { key, ...brand });

  for (const slug of brand.flows) {
    if (BY_FLOW.has(slug)) {
      throw new Error(`flow "${slug}" is mapped to both ${BY_FLOW.get(slug).key} and ${key}`);
    }
    BY_FLOW.set(slug, { key, ...brand });
  }
}

export function brandForFlow(slug) {
  return BY_FLOW.get(slug) ?? null;
}

export function brandForMailerHost(host) {
  return BY_MAILER_HOST.get(String(host ?? "").toLowerCase()) ?? null;
}
