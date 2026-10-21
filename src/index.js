// fagmob-invite-mailer
// Receives authentik's "model_created" notification webhook for Invitations,
// looks the invitation up via the authentik API, and sends the themed invite
// email through Resend. Idempotent per invitation (Resend Idempotency-Key).

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FONT = "'Avenir Next','Segoe UI',Helvetica,Arial,sans-serif";

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

function renderInvite({ link, email, name, expires, env }) {
  const greeting = name ? `Hi ${escapeHtml(name)},` : "Hi,";
  const expiryHtml = expires
    ? ` The invitation expires on ${escapeHtml(expires)}.`
    : "";
  const expiryText = expires ? ` The invitation expires on ${expires}.` : "";
  const safeLink = escapeHtml(link);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>You're invited to fagmob</title>
</head>
<body style="margin:0;padding:0;background-color:#0d0612;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">Set up your fagmob account. Pick a password or sign in with email links.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0d0612;">
  <tr>
    <td align="center" style="padding:40px 16px 48px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
        <tr>
          <td style="padding:0 4px 24px;">
            <a href="${escapeHtml(env.BRAND_URL)}" style="text-decoration:none;">
              <img src="${escapeHtml(env.LOGO_URL)}" width="148" alt="fagmob" style="display:block;border:0;outline:none;color:#ff2bd6;font-family:${FONT};font-size:22px;font-weight:600;letter-spacing:0.5px;">
            </a>
          </td>
        </tr>
        <tr>
          <td style="background-color:#170b1f;border:1px solid #3a1846;border-radius:16px;padding:36px 32px 32px;font-family:${FONT};color:#efe3f5;">
            <h1 style="margin:0 0 16px;font-size:26px;line-height:32px;font-weight:600;color:#ff6ae3;text-shadow:0 0 12px rgba(255,43,214,0.55);">You're invited to fagmob</h1>
            <div style="font-size:16px;line-height:25px;color:#efe3f5;">
              <p style="margin:0 0 14px;">${greeting}</p>
              <p style="margin:0;">You've been invited to an account on fagmob.lol. Open the link to pick your username and choose how you sign in: a password, or a one-time link sent to this address.${expiryHtml}</p>
            </div>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 24px;">
              <tr>
                <td style="border-radius:999px;background-color:#ff2bd6;box-shadow:0 0 20px rgba(255,43,214,0.55);">
                  <a href="${safeLink}" style="display:inline-block;padding:15px 30px;font-family:${FONT};font-size:16px;line-height:16px;font-weight:600;color:#1a0214;text-decoration:none;border-radius:999px;">Set up my account</a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 6px;font-size:13px;line-height:20px;color:#9d86a8;">If the button doesn't work, paste this into your browser:</p>
            <p style="margin:0;font-size:13px;line-height:20px;word-break:break-all;"><a href="${safeLink}" style="color:#29e6ff;text-decoration:underline;">${safeLink}</a></p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 4px 0;font-family:${FONT};font-size:12px;line-height:19px;color:#9d86a8;">
            The link works once. If you weren't expecting this, ignore it and no account is created.<br><br>
            Sent by auth.fagmob.lol to ${escapeHtml(email)}.
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
    "You've been invited to an account on fagmob.lol. Open the link below to pick your username and choose how you sign in: a password, or a one-time link sent to this address." + expiryText,
    "",
    link,
    "",
    "The link works once. If you weren't expecting this, ignore it and no account is created.",
  ].join("\n");

  return { subject: "You're invited to fagmob", html, text };
}

async function getInvitation(env, pk) {
  const base = env.AUTHENTIK_URL.replace(/\/+$/, "");
  const res = await fetch(`${base}/api/v3/stages/invitation/invitations/${encodeURIComponent(pk)}/`, {
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

async function sendEmail(env, { to, subject, html, text, idempotencyKey }) {
  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [to],
      subject,
      html,
      text,
      tags: [{ name: "category", value: "invitation" }],
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

      const slug = invite.flow_obj?.slug || env.ENROLLMENT_FLOW_SLUG;
      const base = env.AUTHENTIK_URL.replace(/\/+$/, "");
      const link = `${base}/if/flow/${encodeURIComponent(slug)}/?itoken=${encodeURIComponent(invite.pk)}`;

      const message = renderInvite({
        link,
        email,
        name: fixed.name || null,
        expires: formatExpiry(invite.expires),
        env,
      });

      const id = await sendEmail(env, {
        to: email,
        ...message,
        idempotencyKey: `fagmob-invite-${invite.pk}`,
      });
      console.log(`invitation ${invite.pk} sent to ${email} (resend ${id})`);
      return json({ sent: id });
    } catch (err) {
      console.error(err);
      // Non-2xx so authentik records a failed notification delivery.
      return json({ error: String(err.message ?? err) }, 502);
    }
  },
};