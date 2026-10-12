# SatGold Cloud

SatGold Cloud is a multi-school management platform built with HTML, CSS, browser JavaScript, Vercel serverless APIs, and Supabase Auth/PostgreSQL/Storage. Supabase PostgreSQL is the only application database, as specified in the project brief.

## Implemented foundation

- Responsive public marketing site, registration, login, password recovery, contact, pricing, privacy and terms pages.
- Vercel API functions for school registration, email verification, current user/workspace, class and subject setup, academic sessions, staff invitation, teacher assignments, and student/guardian provisioning.
- First CBT server routes for student eligibility, timed attempts, answer saving, objective marking and attempt submission. Answer keys remain server-only.
- Supabase migrations for school membership and tenant RLS; academic records, submissions, scores and report drafts; notification, complaint, payroll and subscription structures; CBT; school landing pages; private/public storage policies; account provisioning; atomic payment activation; AI request limits; public contact rate limiting.
- Subscription checkout and server verification routes for Paystack and Flutterwave, plus signature-checked webhook handlers.
- Gemini assistant API with staff-role checks and plan-based monthly request limits.
- Platform tools for school status and plan/entitlement configuration.
- Attendance capture and family attendance notifications; timetable viewing and conflict-checked period creation; school page editing/publication; in-app notifications; complaint threads and response status; and payroll draft calculation/approval/status records.
- Protected teacher-to-class assignment API and migration constraint, separated from homework creation.
- Secret placeholders in `.env.example`; `.env.local` and credentials are excluded by `.gitignore`.

## Local setup

1. Install Node.js 20 or later.
2. Copy `.env.example` to `.env.local`, change `NODE_ENV` to `development` for local Vercel work, and provide the local credentials listed below. Never place server secrets in browser JavaScript. Keep production secrets in Vercel's Production Environment, not in a local file or source control.
3. In the Supabase SQL Editor, apply every file in `supabase/migrations/` in filename order.
4. In Supabase Auth settings, set the site URL to the local or production URL and allow the login, dashboard and password recovery redirect URLs.
5. Install dependencies and start the Vercel development server:

   ```sh
   npm install
   npm run dev
   ```

All static HTML pages use project-relative CSS, JavaScript and logo paths, so the public pages render from a local web server rooted at `public/` as well as on Vercel. To preview styling only, run a static server from `public/` (for example, `npx serve public`). For working API routes and auth, use `npm run dev` from the repository root with `.env.local`, then open the localhost URL Vercel prints. Opening authenticated pages with `file://` cannot provide API routes, Supabase Auth or form submissions.

## Production mode

Vercel runs production deployments with `NODE_ENV=production`. Configure the production environment variables in the Vercel project settings, set `APP_URL` and `FRONTEND_URL` to the verified production domain, apply the Supabase migrations, and configure Auth redirect URLs and provider webhooks. Deploy from the linked repository with `npm run deploy:production` when the production configuration and credentials are ready. Local `npm run dev` remains development mode and uses local credentials.

## Environment values

- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`: Supabase project settings. The anon key is public; the service role key is server-only.
- `APP_URL`: local or production origin used for account links and checkout callbacks.
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_FROM_NAME`: Resend credentials and a verified sender. `CONTACT_TO_EMAIL` receives public enquiries.
- `CONTACT_RATE_LIMIT_SALT`: a random server secret used to hash source IPs for contact form throttling.
- `STUDENT_AUTH_DOMAIN`: an email-shaped Auth identifier domain for student logins. It does not need to receive mail because student credentials are delivered to the verified guardian.
- `PAYSTACK_SECRET_KEY`: server-side Paystack checkout and webhook verification. Paystack signs webhooks with this key; a separate webhook secret and public key are not used by the hosted checkout implementation.
- `FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_SECRET_HASH`: server-side checkout/verification and the configured webhook secret hash.
- `GEMINI_API_KEY`, `GEMINI_MODEL`: server-side Gemini access and the selected model.
- `ERROR_MONITORING_DSN`: optional monitoring provider configuration.

Use separate development/sandbox and production keys. Configure production values in Vercel project settings, not in the repository. Payment callbacks use `/billing.html`; webhooks use `/api/webhooks/paystack` and `/api/webhooks/flutterwave`.

## Platform administrator

Platform roles are never assignable from a browser account. After verifying the intended account in Supabase Auth, a trusted project owner can set its profile role in the Supabase SQL Editor:

```sql
update public.profiles
set platform_role = 'super_admin'
where id = '<verified-auth-user-uuid>';
```

The account can then open Platform controls from its workspace.

## Deployment

Import the repository into Vercel with the repository root as the project root. The static output is `public/`; functions are under `api/`. Add the production environment values in Vercel and configure the Supabase Auth redirect allowlist. Add `satgoldcloud.name.ng` in Vercel, then follow the exact DNS records Vercel displays after checking the current DNS provider. Do not guess records or change nameservers without confirming domain ownership and existing DNS.

Set both payment provider webhook URLs in their dashboards and use sandbox transactions before enabling live keys. Configure Resend with a verified sender domain. Review the draft Terms and Privacy pages and confirm the data-controller, contact, retention and jurisdiction details before public launch.

## Scope still requiring implementation or external setup

This is an active build, not a completed production SaaS. Provider credentials and accounts are not present in this workspace, so email delivery, live AI, checkout, webhooks and deployment cannot be activated or verified here. The current operational pages do not yet replace full dedicated student/parent/teacher portals. Further work remains for CBT question/exam authoring and manual marking, assignment attachment upload and student submission UX, full timetable editing and publication notices, landing-page gallery/image upload and FAQ/news editor, complete payroll approval/payslip workflow, subscription cancellation/expiry/grace-period jobs and receipts, notification preferences and realtime delivery, report PDF generation, contact/legal review, and end-to-end security/production verification. Migrations and API foundations exist for some of these areas, but a schema or endpoint alone is not a completed feature.

The initial public school page is available at `/schools/{slug}` after an administrator publishes it from `/school-page.html`. Operational tabs are available from the signed-in workspace under **School tools**. Payroll status changes record school-side status only and do not transfer funds.
