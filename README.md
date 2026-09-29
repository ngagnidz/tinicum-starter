<a href="https://demo-nextjs-with-supabase.vercel.app/">
  <img alt="Next.js and Supabase Starter Kit - the fastest way to build apps with Next.js and Supabase" src="https://demo-nextjs-with-supabase.vercel.app/opengraph-image.png">
  <h1 align="center">Next.js and Supabase Starter Kit</h1>
</a>

<p align="center">
 The fastest way to build apps with Next.js and Supabase
</p>

<p align="center">
  <a href="#features"><strong>Features</strong></a> ·
  <a href="#demo"><strong>Demo</strong></a> ·
  <a href="#deploy-to-vercel"><strong>Deploy to Vercel</strong></a> ·
  <a href="#clone-and-run-locally"><strong>Clone and run locally</strong></a> ·
  <a href="#feedback-and-issues"><strong>Feedback and issues</strong></a>
  <a href="#more-supabase-examples"><strong>More Examples</strong></a>
</p>
<br/>

## PO Confirmation Reconciler

This app is built on the starter below. It matches vendor order-confirmation
PDFs to open purchase orders from a CSV export.

### Env vars

In addition to the two Supabase vars described under
[Clone and run locally](#clone-and-run-locally), add:

```env
ANTHROPIC_API_KEY=[your Anthropic API key]
```

`ANTHROPIC_API_KEY` is read only in `app/api/extract/route.ts` /
`lib/anthropic/extract-confirmation.ts` (server-side route handlers), never
sent to the browser. Get a key from the
[Anthropic Console](https://console.anthropic.com/settings/keys).

No `SUPABASE_SERVICE_ROLE_KEY` is needed: the schema's RLS policies are
intentionally open (see the note in the migration below), so the existing
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is enough for both the browser and the
route handlers.

### Run the migrations

Two migrations, applied in order:

- `20260929145417_po_reconciler_schema.sql` -- `runs`, `po_lines`,
  `confirmation_files`, `confirmations`, `confirmation_lines`, plus a private
  `confirmations` Storage bucket.
- `20260929152455_lean_confirmation_schema.sql` -- replaces `confirmations` /
  `confirmation_lines` with the leaner extraction shape (one `part_number`
  instead of a beacon/vendor split, `process_code`, and `promise_date_start`
  / `promise_date_end` / `promise_basis` / `needs_review` computed by
  `lib/normalize.ts` from a verbatim `promise_text` rather than asked of the
  model). It drops and recreates those two tables, which is only safe because
  at the time it was written they held data from the schema it replaces.

Apply them with the Supabase CLI once it's linked to your project:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

Or paste the file's contents into the SQL editor in the Supabase dashboard.

This migration is written to be safe to re-run (`create table if not exists`,
`on conflict do nothing` for the bucket) except for the `create policy`
statements, which fail if a policy with the same name already exists — drop
those policies first if you need to re-apply after editing them.

RLS is enabled on every table but the policies allow `anon` and
`authenticated` to do anything. There's no per-user/tenant model yet, so this
is intentionally wide open rather than half-gated behind Supabase Auth;
tighten it before this handles real vendor data. Because of that, the
`proxy.ts`/`lib/supabase/proxy.ts` auth gate also explicitly exempts
`/api/extract` and `/runs` so the tool works without signing in.

### Tests

```bash
npm test
```

`tests/normalize.test.ts` unit-tests the deterministic date/unit/part-number
post-processing in `lib/normalize.ts` (no API calls). `tests/extraction.test.ts`
is a regression suite that calls the real Anthropic API against the six
reference PDFs in `data/samples/` (one per vendor template) and checks the
fields called out for each; it needs `ANTHROPIC_API_KEY` and is skipped
without it.

### Using it

1. Go to `/`, pick `open_pos.csv` and the `confirmations/` folder (or select
   PDFs individually), then **Upload**.
2. Click **Run extraction** — it calls `/api/extract` once per PDF and shows
   progress; failures (bad extraction, non-PDF content, model/schema
   mismatches) are listed but don't stop the run.
3. Click **View matches**, or go to `/runs/<run id>/matches`, for the
   document-level match table.

## Features

- Works across the entire [Next.js](https://nextjs.org) stack
  - App Router
  - Pages Router
  - Proxy
  - Client
  - Server
  - It just works!
- supabase-ssr. A package to configure Supabase Auth to use cookies
- Password-based authentication block installed via the [Supabase UI Library](https://supabase.com/ui/docs/nextjs/password-based-auth)
- Styling with [Tailwind CSS](https://tailwindcss.com)
- Components with [shadcn/ui](https://ui.shadcn.com/)
- Optional deployment with [Supabase Vercel Integration and Vercel deploy](#deploy-your-own)
  - Environment variables automatically assigned to Vercel project

## Demo

You can view a fully working demo at [demo-nextjs-with-supabase.vercel.app](https://demo-nextjs-with-supabase.vercel.app/).

## Deploy to Vercel

Vercel deployment will guide you through creating a Supabase account and project.

After installation of the Supabase integration, all relevant environment variables will be assigned to the project so the deployment is fully functioning.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fvercel%2Fnext.js%2Ftree%2Fcanary%2Fexamples%2Fwith-supabase&project-name=nextjs-with-supabase&repository-name=nextjs-with-supabase&demo-title=nextjs-with-supabase&demo-description=This+starter+configures+Supabase+Auth+to+use+cookies%2C+making+the+user%27s+session+available+throughout+the+entire+Next.js+app+-+Client+Components%2C+Server+Components%2C+Route+Handlers%2C+Server+Actions+and+Middleware.&demo-url=https%3A%2F%2Fdemo-nextjs-with-supabase.vercel.app%2F&external-id=https%3A%2F%2Fgithub.com%2Fvercel%2Fnext.js%2Ftree%2Fcanary%2Fexamples%2Fwith-supabase&demo-image=https%3A%2F%2Fdemo-nextjs-with-supabase.vercel.app%2Fopengraph-image.png)

The above will also clone the Starter kit to your GitHub, you can clone that locally and develop locally.

If you wish to just develop locally and not deploy to Vercel, [follow the steps below](#clone-and-run-locally).

## Clone and run locally

1. You'll first need a Supabase project which can be made [via the Supabase dashboard](https://database.new)

2. Create a Next.js app using the Supabase Starter template npx command

   ```bash
   npx create-next-app --example with-supabase with-supabase-app
   ```

   ```bash
   yarn create next-app --example with-supabase with-supabase-app
   ```

   ```bash
   pnpm create next-app --example with-supabase with-supabase-app
   ```

3. Use `cd` to change into the app's directory

   ```bash
   cd with-supabase-app
   ```

4. Rename `.env.example` to `.env.local` and update the following:

  ```env
  NEXT_PUBLIC_SUPABASE_URL=[INSERT SUPABASE PROJECT URL]
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=[INSERT SUPABASE PROJECT API PUBLISHABLE OR ANON KEY]
  ```
  > [!NOTE]
  > This example uses `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, which refers to Supabase's new **publishable** key format.
  > Both legacy **anon** keys and new **publishable** keys can be used with this variable name during the transition period. Supabase's dashboard may show `NEXT_PUBLIC_SUPABASE_ANON_KEY`; its value can be used in this example.
  > See the [full announcement](https://github.com/orgs/supabase/discussions/29260) for more information.

  Both `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` can be found in [your Supabase project's API settings](https://supabase.com/dashboard/project/_?showConnect=true)

5. You can now run the Next.js local development server:

   ```bash
   npm run dev
   ```

   The starter kit should now be running on [localhost:3000](http://localhost:3000/).

6. This template comes with the default shadcn/ui style initialized. If you instead want other ui.shadcn styles, delete `components.json` and [re-install shadcn/ui](https://ui.shadcn.com/docs/installation/next)

> Check out [the docs for Local Development](https://supabase.com/docs/guides/getting-started/local-development) to also run Supabase locally.

## Feedback and issues

Please file feedback and issues over on the [Supabase GitHub org](https://github.com/supabase/supabase/issues/new/choose).

## More Supabase examples

- [Next.js Subscription Payments Starter](https://github.com/vercel/nextjs-subscription-payments)
- [Cookie-based Auth and the Next.js 13 App Router (free course)](https://youtube.com/playlist?list=PL5S4mPUpp4OtMhpnp93EFSo42iQ40XjbF)
- [Supabase Auth and the Next.js App Router](https://github.com/supabase/supabase/tree/master/examples/auth/nextjs)
