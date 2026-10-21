// Brand registry. An invitation is matched to a brand by its enrollment flow
// slug, so every flow listed here must belong to exactly one brand.
//
// authUrl is the brand's authentik domain. authentik picks the brand from the
// request host, so the invite link has to use it rather than AUTHENTIK_URL.
// The domain in `from` must be verified in Resend.

export const BRANDS = {
  fagmob: {
    name: "fagmob",
    flows: ["fagmob-enrollment"],
    authUrl: "https://auth.fagmob.lol",
    from: "fagmob <auth@fagmob.lol>",
    siteUrl: "https://fagmob.lol/",
    siteLabel: "fagmob.lol",
    logo: { url: "https://fagmob.lol/brand/email-wordmark.png", width: 148 },
    copy: {
      subject: "You're invited to fagmob",
      preheader: "Set up your fagmob account. Pick a password or sign in with email links.",
    },
    theme: {
      colorScheme: "dark",
      font: "'Avenir Next','Segoe UI',Helvetica,Arial,sans-serif",
      background: "#0d0612",
      card: "#170b1f",
      cardBorder: "#3a1846",
      text: "#efe3f5",
      muted: "#9d86a8",
      heading: "#ff6ae3",
      headingGlow: "rgba(255,43,214,0.55)",
      button: "#ff2bd6",
      buttonText: "#1a0214",
      buttonGlow: "rgba(255,43,214,0.55)",
      link: "#29e6ff",
      logoFallback: "#ff2bd6",
    },
  },
};

const BY_FLOW = new Map();
for (const [key, brand] of Object.entries(BRANDS)) {
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

export function brandByKey(key) {
  return key && BRANDS[key] ? { key, ...BRANDS[key] } : null;
}
