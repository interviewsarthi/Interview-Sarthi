# Interview Sarthi

InterviewSarthi brings together three apps for job seekers. The [homepage](https://interviewsarthi.com/) explains each app and its starting price:

- [Apply Sarthi](https://interviewsarthi.com/apply/): jobs from multiple portals, CV matching and application autofill.
- [Prep Sarthi](https://interviewsarthi.com/prep/): spoken AI mock interviews with follow-up questions and feedback.
- [Live Sarthi](https://interviewsarthi.com/live/): the existing Windows interview assistant, with CV-based answer suggestions during a call.

[Official website](https://interviewsarthi.com/) · [Product facts](https://interviewsarthi.com/facts.html) · [Microsoft Store](https://apps.microsoft.com/detail/9NMKQPSQ1KS8) · [Releases](https://github.com/abhishekchoudhary1710/Interview-Sarthi/releases)

## What this repository contains

The public static website, product information, interview guides, website analytics and the Prep browser app under `prep/app/`. The root page is the three-product homepage; the existing Windows product page is at `live/index.html`. This repository does not contain the desktop application's source code. Public availability of this repository does not establish an open-source license.

## Live Sarthi access

- Windows 10 version 2004 or later, or Windows 11.
- Transcription and resume-grounded suggestions for mock calls and permitted live use.
- English, Hindi and Hinglish support; bring your own Google Gemini key.
- 30 minutes free per computer, with all features and no card.
- One-time passes: ₹99 / 2 days on 1 device, ₹299 / 30 days on 2 devices ($9.99 and $29.99 outside India). No automatic renewal. Google API quotas and billing are separate.

Use assistance only where permitted by the employer, interviewer and assessment provider.

## Run locally

No frontend build or dependency installation is required:

```sh
python -m http.server 8000 --bind 127.0.0.1
```

Open `http://localhost:8000`. Website analytics are configured in `assets/analytics.js`; browser QA intercepts external requests so test events do not reach providers.

## Validate changes

The tests, build scripts and research notes are not published in this repository (since 14 October 2026); they
stay in the maintainers' working copy, and the commands below run there. Before every push, run all the checks
that used to run on GitHub:

```sh
scripts/check_site.sh
```

It runs, in order (Python 3.10+ and Node.js 18+):

```sh
python scripts/build_apply_pages.py --check
python scripts/generate_sitemap.py --check
python scripts/seo_audit.py
python -m unittest discover -s tests -p 'test_*.py'
node --test tests/*.test.cjs tests/*.test.mjs   # the ten suites the check script lists
```

Optional browser checks require Python Playwright and Microsoft Edge:

```sh
python tests/browser_smoke.py
```

This checks desktop/mobile layouts, receipt rendering, weekly checkout destinations and analytics behavior without purchasing anything. Screenshots and results go to ignored `.seo-preview/`.

`python tests/ats_checker_browser.py` (Playwright or patchright, with Chromium) builds sample CVs and runs them through the ATS resume checker at `/apply/ats-resume-checker/`. The checker's skill list comes from ApplySarthi: after the vocabulary changes there, run `python scripts/export_ats_skills.py` and commit `assets/ats-skills.json`.

Prep's normal interview screen does not display diagnostic logs or a duplicate transcript.
Support sessions can explicitly use `/prep/app/?diagnostics=1`; this setting is not persisted.
Run `python tests/prep_diagnostics_smoke.py` with Playwright and Chromium to check this behaviour
and current captions without making AI or microphone calls. `BROWSER_EXECUTABLE` can select a local browser.

## Maintain sitemap dates

After a meaningful content change, record its actual date:

```sh
python scripts/generate_sitemap.py --record facts.html --date YYYY-MM-DD
python scripts/seo_audit.py
```

The reviewed allow-list in `scripts/seo_pages.json` controls inclusion and dates. Formatting edits and builds do not advance dates. Add new canonical pages deliberately; noindex receipt/error pages are excluded. Existing IndexNow behavior remains in its separate workflow.

## ApplySarthi pages

The guide and comparison pages under `apply/` are generated from `scripts/apply_pages/`, so the shared header, footer and
schema are written once rather than thirteen times. Edit the content module, then:

```sh
python scripts/build_apply_pages.py      # rewrite the HTML, which is committed like any other page
```

`scripts/apply_pages/_shared.py` is the fact register for that content: every number an ApplySarthi page
states must exist there with a note on where it was read from.

The product homepage `apply/index.html` is maintained directly, with `assets/apply-home.css` and
`assets/apply-home.js`. Its social share image is `assets/og-apply-home.jpg`, rendered at 1200×630
from `assets/og-apply-home.source.html`. Guide share images are separate. Run
`python tests/apply_browser_smoke.py` with Python Playwright and Chromium for responsive and
interaction checks; `BROWSER_EXECUTABLE` optionally selects a locally installed Chromium binary.
External analytics and font requests are blocked during this test. Screenshots go to
`.seo-preview/apply-redesign/`.

## Contact

Built by an independent developer in India. Contact [support@interviewsarthi.com](mailto:support@interviewsarthi.com) or open a repository issue without credentials, license keys or private interview material.

[Privacy](https://interviewsarthi.com/privacy.html) · [Terms](https://interviewsarthi.com/terms.html) · [Refund policy](https://interviewsarthi.com/refunds.html)
