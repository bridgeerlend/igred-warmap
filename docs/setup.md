# One-time setup

Everything here needs a human. Collect it in one sitting; after this the system runs on its
own. Items 1 and 2 unblock the current step — the rest can wait until the step that needs
them.

## 1. Public GitHub repository

The repository must be **public**, otherwise scheduled Actions are metered and the project
stops being free.

1. Go to https://github.com/new
2. Owner: your account. Repository name: `igred-warmap`
3. Select **Public**
4. Do **not** tick "Add a README" — the project already has one
5. Click **Create repository**
6. Copy the repository URL it shows you

## 2. UCDP API token — needed now

This one is load-bearing: without it the register is empty and almost nothing shows on the
map. See the display-gate section in the README for why.

1. Go to https://ucdp.uu.se/apidocs/
2. Request a free access token (5000 requests per day)
3. In the repository: **Settings → Secrets and variables → Actions → New repository secret**
4. Name: `UCDP_ACCESS_TOKEN`. Value: the token
5. Click **Add secret**

## 3. NASA FIRMS MAP_KEY — not needed after all

You can skip this. The documented FIRMS API does require a free MAP_KEY, but FIRMS also
publishes the same global 24-hour detections as plain CSV with no key at all, and that is
what the heat layer reads. Nothing to request, nothing to store.

The keyed API is only worth having if we later want custom areas or windows longer than a
day. We do not.

## 4. Free key for the AI text step — optional, adds prose to the Brief

Used only to draft a paragraph for the Brief's few lead stories, and later for background
prose on a new conflict. Both go through your approval before anyone sees them.

Everything works without this key. The Brief publishes each morning either way; it simply
carries sourced records and no prose. Nothing here can cost money: no key, an exhausted
quota, a timeout or a rejected draft all end the same way.

1. Go to https://aistudio.google.com/apikey
2. Create an API key — that page also shows which Google Cloud project each key belongs to
3. Add it as a repository secret named `GEMINI_API_KEY`

**Check it before relying on it:** `npm run gemini:check` asks the service what the key can
actually do and names a working model. The API's own errors are not self-explanatory — a
retired model returns a helpful message, a model outside your tier returns an empty 404, and
a project with no allowance returns `limit: 0` whether you have used anything or not.

The key currently on file is valid and the Generative Language API is enabled on its
project, but every Gemini model reports `limit: 0` — the project has no allowance to spend.
That is a tier or billing setting on the project, not a missing API.

## 5. Publish the map and the Brief to map.igred.org

Both live in `site/` and deploy together as one GitHub Pages site.

**5a. Point the page at the repository.** Open `site/config.js` and replace
`REPLACE_WITH/igred-warmap` with your actual repository, for example
`bridgeerlend/igred-warmap`. The map fetches its data straight from the repository at view
time, which is what keeps hourly data commits from rebuilding the site. The deploy fails on
purpose if this is still a placeholder.

**5b. Turn on GitHub Pages.** In the repository: **Settings → Pages → Build and deployment
→ Source**, choose **GitHub Actions**.

**5c. DNS for map.igred.org.** With your domain provider, add a `CNAME` record:

- Host / name: `map`
- Value / target: `<your-github-username>.github.io`

**5d. Deploy.** Open the **Actions** tab, pick **Deploy map**, click **Run workflow**. When
it finishes, go to **Settings → Pages → Custom domain**, enter `map.igred.org`, and tick
**Enforce HTTPS** once the certificate is issued. The repository already contains the
matching `site/CNAME` file.

The map is at `map.igred.org` and the Brief at `map.igred.org/brief/`.

## 6. Publish the institute page to Netlify

`igred.org` already points at Netlify, so the safe sequence is to build the new site
alongside the old one and move the domain only once you have seen it working.

**6a. Create the site.** In Netlify: **Add new site → Import an existing project → GitHub**,
choose `igred-warmap`. Netlify reads `netlify.toml`, so leave the build command empty and
the publish directory as `www`. Click **Deploy**.

**6b. Look at it.** Netlify gives the new site a `something.netlify.app` address. Open it and
check the page before touching the domain.

**6c. Move the domain.** On the **old** igred.org site: **Site configuration → Domain
management**, remove `igred.org`. Then on the **new** site: **Domain management → Add a
domain**, enter `igred.org`, and add `www.igred.org` as a redirect to it. Netlify reissues
the certificate automatically.

**6d. Nothing else to do.** `netlify.toml` tells Netlify to skip a build when nothing in
`www/` changed, so the hourly data commits will not rebuild the page.

## 7. Archive service key — optional

Used to store an archive link alongside each source so it stays checkable if the original
disappears. The Internet Archive's save endpoint works without a key at low volume, so this
is optional and can be skipped for now.

## Verifying the setup

Open the **Actions** tab, choose the **Ingest** workflow and click **Run workflow**. A
successful run commits to `data/` and leaves no open issue labelled `pipeline-alert`.

Until `UCDP_ACCESS_TOKEN` is added, that run will report `ucdp: not_configured` and carry on
— which is the source isolation working, not a failure. The map will say so in a banner and
show almost nothing, because the register is what decides which incidents are displayed.

## What you will need to do routinely

Only one thing: when the system detects a possible new conflict, it opens a pull request
containing a background draft. Read it on the GitHub mobile app and merge to publish, or
close to reject. Data, news and figures skip this and publish directly, because they point
at their sources.
