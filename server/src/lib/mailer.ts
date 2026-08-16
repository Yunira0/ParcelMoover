import nodemailer from "nodemailer";

// Defer reading env vars until first use so dotenv has time to load.
function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function getLoginUrl() {
  const base = (process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "");
  return `${base}/login`;
}

function getFrom() {
  // Gmail requires the from address to match the authenticated SMTP_USER.
  // If SMTP_FROM is not set, fall back to SMTP_USER so Gmail doesn't reject the message.
  return process.env.SMTP_FROM || `ParcelMoover <${process.env.SMTP_USER}>`;
}

/** Call once on server startup to catch bad credentials early. */
export async function verifyMailer(): Promise<void> {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS ||
      process.env.SMTP_PASS === "your-16-char-app-password") {
    console.warn("[mailer] SMTP credentials not configured — welcome emails will not be sent.");
    return;
  }
  try {
    await getTransporter().verify();
    console.log("[mailer] SMTP connection verified ✓");
  } catch (err: any) {
    console.error("[mailer] SMTP connection FAILED:", err.message);
    console.error("[mailer] Check SMTP_HOST / SMTP_USER / SMTP_PASS in .env");
  }
}

export async function sendWelcomeEmail(opts: {
  to: string;
  name: string;
  password: string;
}) {
  const loginUrl = getLoginUrl();

  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a2e">
      <h2 style="margin-bottom:4px">Welcome to ParcelMoover, ${opts.name}!</h2>
      <p style="color:#4b5563;margin-top:0">
        An account has been created for you. Use the credentials below to log in.
      </p>

      <div style="background:#f8f9fb;border:1px solid #e5e7eb;border-radius:8px;padding:20px;margin:24px 0">
        <table style="border-collapse:collapse;width:100%">
          <tr>
            <td style="padding:8px 0;font-weight:600;width:44%;color:#374151">Login URL</td>
            <td style="padding:8px 0">
              <a href="${loginUrl}" style="color:#4f46e5;word-break:break-all">${loginUrl}</a>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;font-weight:600;color:#374151;border-top:1px solid #e5e7eb">Email</td>
            <td style="padding:8px 0;border-top:1px solid #e5e7eb">${opts.to}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;font-weight:600;color:#374151;border-top:1px solid #e5e7eb">Temporary Password</td>
            <td style="padding:8px 0;border-top:1px solid #e5e7eb;font-family:monospace;font-size:15px;letter-spacing:0.05em">${opts.password}</td>
          </tr>
        </table>
      </div>

      <div style="background:#fffbeb;border-left:4px solid #f59e0b;border-radius:4px;padding:14px 16px;margin-bottom:24px">
        <strong style="color:#92400e">Action required:</strong>
        <span style="color:#78350f">
          You will be asked to set a permanent password immediately after your first login.
          Your temporary password will stop working once you've changed it.
        </span>
      </div>

      <a href="${loginUrl}"
         style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:13px 28px;border-radius:7px;font-weight:600;font-size:15px">
        Log in to ParcelMoover →
      </a>

      <p style="margin-top:16px;font-size:13px;color:#6b7280">
        Or copy this link into your browser:<br>
        <a href="${loginUrl}" style="color:#4f46e5;word-break:break-all">${loginUrl}</a>
      </p>

      <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0">
      <p style="font-size:12px;color:#9ca3af">
        If you did not expect this email, contact your account administrator.
        Do not share your password with anyone.
      </p>
    </div>
  `;

  const text = `
Welcome to ParcelMoover, ${opts.name}!

An account has been created for you. Use the details below to log in.

  Login URL:          ${loginUrl}
  Email:              ${opts.to}
  Temporary Password: ${opts.password}

ACTION REQUIRED: You will be asked to set a permanent password immediately
after your first login. Your temporary password will stop working once changed.

If you did not expect this email, contact your account administrator.
  `.trim();

  await getTransporter().sendMail({
    from: getFrom(),
    to: opts.to,
    subject: "Your ParcelMoover account credentials",
    text,
    html,
  });
}

function getWebhooksUrl() {
  const base = (process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "");
  return `${base}/developer/webhooks`;
}

/**
 * Sent once, at the moment the delivery engine's circuit breaker trips an
 * endpoint - after 5 separate events each exhausted all 12 retry attempts
 * over ~24h without a single success in between (so, on the order of days
 * of continuous failure). Until this existed, the only signal was a server
 * log line and the dashboard's own `disabled_at` field, so a vendor whose
 * receiving server crashed had no way to learn their order-status sync had
 * silently stopped short of noticing on their own.
 */
export async function sendWebhookDisabledEmail(opts: {
  to: string;
  vendorName: string;
  endpointName: string;
  endpointUrl: string;
}) {
  const webhooksUrl = getWebhooksUrl();

  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a2e">
      <h2 style="margin-bottom:4px">A webhook endpoint has been disabled</h2>
      <p style="color:#4b5563;margin-top:0">
        Hi ${opts.vendorName}, ParcelMoover stopped delivering order-status events to one of your
        webhook endpoints after it failed every delivery attempt for several days in a row.
        You will not receive further events on this endpoint until you re-enable it.
      </p>

      <div style="background:#f8f9fb;border:1px solid #e5e7eb;border-radius:8px;padding:20px;margin:24px 0">
        <table style="border-collapse:collapse;width:100%">
          <tr>
            <td style="padding:8px 0;font-weight:600;width:34%;color:#374151">Endpoint</td>
            <td style="padding:8px 0">${opts.endpointName}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;font-weight:600;color:#374151;border-top:1px solid #e5e7eb">URL</td>
            <td style="padding:8px 0;border-top:1px solid #e5e7eb;word-break:break-all">${opts.endpointUrl}</td>
          </tr>
        </table>
      </div>

      <div style="background:#fffbeb;border-left:4px solid #f59e0b;border-radius:4px;padding:14px 16px;margin-bottom:24px">
        <strong style="color:#92400e">Action required:</strong>
        <span style="color:#78350f">
          Fix whatever is rejecting or timing out these requests, then re-enable the endpoint from
          your dashboard. Re-enabling clears the failure count and resumes delivery of new events -
          it does not replay what was missed while disabled; use <code>GET /orders/statuses</code>
          to reconcile anything you may have missed.
        </span>
      </div>

      <a href="${webhooksUrl}"
         style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:13px 28px;border-radius:7px;font-weight:600;font-size:15px">
        Open Webhooks settings &rarr;
      </a>
    </div>
  `;

  const text = `
A webhook endpoint has been disabled

Hi ${opts.vendorName}, ParcelMoover stopped delivering order-status events to one of your webhook
endpoints after it failed every delivery attempt for several days in a row. You will not receive
further events on this endpoint until you re-enable it.

  Endpoint: ${opts.endpointName}
  URL:      ${opts.endpointUrl}

ACTION REQUIRED: Fix whatever is rejecting or timing out these requests, then re-enable the
endpoint at ${webhooksUrl}. Re-enabling clears the failure count and resumes delivery of new
events - it does not replay what was missed while disabled; use GET /orders/statuses to
reconcile anything you may have missed.
  `.trim();

  await getTransporter().sendMail({
    from: getFrom(),
    to: opts.to,
    subject: `ParcelMoover webhook disabled: ${opts.endpointName}`,
    text,
    html,
  });
}
