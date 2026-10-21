// invite-mailer
// Receives authentik's "model_created" notification webhook for Invitations,
// looks the invitation up via the authentik API, picks the brand from the
// invitation's enrollment flow, and sends that brand's themed invite email
// through Resend. Idempotent per invitation (Resend Idempotency-Key).

import { brandByKey, brandForFlow } from "./brands.js";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

function secretMatches(provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string" || expected.length === 0) {
    return false;
  }
  const enc = new TextEncoder();
  const a = enc.encode(provided);
  const b = enc.encode(expected);
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

function formatExpiry(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return `${date.toLocaleString("en-US", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" })} UTC`;
  } catch {
    return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  }
}

function trimSlash(url) {
  return url.replace(/\/+$/, "");
}

// Picks the brand for an invitation. Invitations without a flow can be used
// with any flow, so they fall back to DEFAULT_BRAND (and its first flow).
function resolveBrand(invite, env) {
  const slug = invite.flow_obj?.slug;
  if (slug) {
    const brand = brandForFlow(slug);
    return brand ? { brand, slug } : null;
  }
  const brand = brandByKey(env.DEFAULT_BRAND);
  return brand ? { brand, slug: brand.flows[0] } : null;
}

function renderInvite({ link, email, name, expires, brand }) {
  const t = brand.theme;
  const font = t.font;
  const title = brand.copy.subject;
  const greeting = name ? `Hi ${escapeHtml(name)},` : "Hi,";
  const expiryHtml = expires
    ? ` The invitation expires on ${escapeHtml(expires)}.`
    : "";
  const expiryText = expires ? ` The invitation expires on ${expires}.` : "";
  const safeLink = escapeHtml(link);
  const authHost = new URL(brand.authUrl).host;
  const intro = `You've been invited to an account on ${brand.siteLabel}.`;
  const colorScheme = t.colorScheme ?? "light";
  const headingGlow = t.headingGlow ? `text-shadow:0 0 12px ${t.headingGlow};` : "";
  const buttonGlow = t.buttonGlow ? `box-shadow:0 0 20px ${t.buttonGlow};` : "";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="${colorScheme}">
<meta name="supported-color-schemes" content="${colorScheme}">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:${t.background};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(brand.copy.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${t.background};">
  <tr>
    <td align="center" style="padding:40px 16px 48px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
        <tr>
          <td style="padding:0 4px 24px;">
            <a href="${escapeHtml(brand.siteUrl)}" style="text-decoration:none;">
              <img src="${escapeHtml(brand.logo.url)}" width="${brand.logo.width}" alt="${escapeHtml(brand.name)}" style="display:block;border:0;outline:none;color:${t.logoFallback ?? t.heading};font-family:${font};font-size:22px;font-weight:600;letter-spacing:0.5px;">
            </a>
          </td>
        </tr>
        <tr>
          <td style="background-color:${t.card};border:1px solid ${t.cardBorder};border-radius:16px;padding:36px 32px 32px;font-family:${font};color:${t.text};">
            <h1 style="margin:0 0 16px;font-size:26px;line-height:32px;font-weight:600;color:${t.heading};${headingGlow}">${escapeHtml(title)}</h1>
            <div style="font-size:16px;line-height:25px;color:${t.text};">
              <p style="margin:0 0 14px;">${greeting}</p>
              <p style="margin:0;">${escapeHtml(intro)} Open the link to pick your username and choose how you sign in: a password, or a one-time link sent to this address.${expiryHtml}</p>
            </div>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 24px;">
              <tr>
                <td style="border-radius:999px;background-color:${t.button};${buttonGlow}">
                  <a href="${safeLink}" style="display:inline-block;padding:15px 30px;font-family:${font};font-size:16px;line-height:16px;font-weight:600;color:${t.buttonText};text-decoration:none;border-radius:999px;">Set up my account</a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 6px;font-size:13px;line-height:20px;color:${t.muted};">If the button doesn't work, paste this into your browser:</p>
            <p style="margin:0;font-size:13px;line-height:20px;word-break:break-all;"><a href="${safeLink}" style="color:${t.link};text-decoration:underline;">${safeLink}</a></p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 4px 0;font-family:${font};font-size:12px;line-height:19px;color:${t.muted};">
            The link works once. If you weren't expecting this, ignore it and no account is created.<br><br>
            Sent by ${escapeHtml(authHost)} to ${escapeHtml(email)}.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const text = [
    greeting,
    "",
    `${intro} Open the link below to pick your username and choose how you sign in: a password, or a one-time link sent to this address.` + expiryText,
    "",
    link,
    "",
    "The link works once. If you weren't expecting this, ignore it and no account is created.",
  ].join("\n");

  return { subject: title, html, text };
}

// brand.resendKey names the Worker secret holding that brand's Resend key.
// Brands without one use the shared RESEND_API_KEY.
function resendKeyFor(env, brand) {
  const name = brand.resendKey || "RESEND_API_KEY";
  const key = env[name];
  if (!key) throw new Error(`no Resend API key for brand ${brand.key}: secret ${name} is not set`);
  return key;
}

async function getInvitation(env, pk) {
  const res = await fetch(`${trimSlash(env.AUTHENTIK_URL)}/api/v3/stages/invitation/invitations/${encodeURIComponent(pk)}/`, {
    headers: {
      Authorization: `Bearer ${env.AUTHENTIK_TOKEN}`,
      Accept: "application/json",
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`authentik API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

async function sendEmail({ apiKey, from, to, subject, html, text, brandKey, idempotencyKey }) {
  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
      text,
      tags: [
        { name: "category", value: "invitation" },
        { name: "brand", value: brandKey },
      ],
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  }
  return body.id;
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname !== "/authentik") return json({ error: "not found" }, 404);
    if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "invalid json" }, 400);
    }

    if (!secretMatches(payload?.secret, env.WEBHOOK_SECRET)) {
      return json({ error: "unauthorized" }, 401);
    }

    const model = payload.model ?? {};
    if (
      payload.action !== "model_created" ||
      model.app !== "authentik_stages_invitation" ||
      model.model_name !== "invitation" ||
      !model.pk
    ) {
      return json({ skipped: "not an invitation creation" }, 202);
    }

    try {
      const invite = await getInvitation(env, model.pk);
      if (!invite) return json({ skipped: "invitation no longer exists" }, 202);

      const fixed = invite.fixed_data ?? {};
      const email = String(fixed.email ?? "").trim();
      if (!EMAIL_RE.test(email)) {
        console.warn(`invitation ${invite.pk} has no valid fixed_data.email, not sending`);
        return json({ skipped: "no fixed_data.email" }, 202);
      }

      const resolved = resolveBrand(invite, env);
      if (!resolved) {
        const flow = invite.flow_obj?.slug ?? "(none)";
        console.warn(`invitation ${invite.pk} flow ${flow} matches no brand, not sending`);
        return json({ skipped: `no brand for flow ${flow}` }, 202);
      }
      const { brand, slug } = resolved;
      const link = `${trimSlash(brand.authUrl)}/if/flow/${encodeURIComponent(slug)}/?itoken=${encodeURIComponent(invite.pk)}`;

      const message = renderInvite({
        link,
        email,
        name: fixed.name || null,
        expires: formatExpiry(invite.expires),
        brand,
      });

      const id = await sendEmail({
        apiKey: resendKeyFor(env, brand),
        from: brand.from,
        to: email,
        ...message,
        brandKey: brand.key,
        idempotencyKey: `invite-${invite.pk}`,
      });
      console.log(`invitation ${invite.pk} (${brand.key}) sent to ${email} (resend ${id})`);
      return json({ sent: id, brand: brand.key });
    } catch (err) {
      console.error(err);
      // Non-2xx so authentik records a failed notification delivery.
      return json({ error: String(err.message ?? err) }, 502);
    }
  },
};
