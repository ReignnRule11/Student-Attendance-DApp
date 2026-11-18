# GitHub Pages deployment

The Next.js frontend is deployed to GitHub Pages as a static export. Vercel remains the primary Next.js hosting target.

## Published URL

After the first successful Pages workflow, the site is available at:

`https://reignnrule11.github.io/Student-Attendance-DApp/`

## Deployment

A push to `main` that changes `apps/web/**` or this workflow triggers the GitHub Pages build and deployment. The workflow builds with `GITHUB_PAGES=true`, which enables Next.js static export and the repository subpath.

The static site runs wallet connection, EIP-712 signing, QR scanning, and Sepolia RPC interactions in the visitor browser. It does not include a server runtime or server-side API routes. Camera access requires HTTPS and browser permission.

## Repository settings

In GitHub, open **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**. The workflow requires the repository Pages feature to be enabled.

## Verification

Check the **Deploy GitHub Pages** workflow in Actions. A successful deployment job publishes the `page_url` as the environment URL. The GitHub Pages deployment is separate from Vercel production deployment.
