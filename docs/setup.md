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

## 3. NASA FIRMS MAP_KEY — needed at step 4

1. Go to https://firms.modaps.eosdis.nasa.gov/api/area/
2. Request a MAP_KEY (free, arrives by email)
3. Add it as a repository secret named `FIRMS_MAP_KEY`

## 4. Free key for the AI text step — needed at step 5

Used only to draft background prose for a new conflict, which you then approve. The step is
built to fall back to no text when the quota runs out, so it can never cost money.

1. Go to https://aistudio.google.com/apikey
2. Create a free API key
3. Add it as a repository secret named `GEMINI_API_KEY`

## 5. DNS for map.igred.org — needed at step 3

Exact values depend on where the map is hosted; this will be confirmed when the map is
built. For GitHub Pages it is a `CNAME` record for `map` pointing at
`<your-github-username>.github.io`.

The existing `igred.org` site on Netlify is not touched.

## 6. Archive service key — optional

Used to store an archive link alongside each source so it stays checkable if the original
disappears. The Internet Archive's save endpoint works without a key at low volume, so this
is optional and can be skipped for now.

## Verifying the setup

After adding `UCDP_ACCESS_TOKEN`, open the **Actions** tab, choose the **Ingest** workflow
and click **Run workflow**. A successful run commits to `data/` and leaves no open issue
labelled `pipeline-alert`.

## What you will need to do routinely

Only one thing: when the system detects a possible new conflict, it opens a pull request
containing a background draft. Read it on the GitHub mobile app and merge to publish, or
close to reject. Data, news and figures skip this and publish directly, because they point
at their sources.
