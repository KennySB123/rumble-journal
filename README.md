# Vulcanic's RUMBLE journal

A static site: blog, BP-versus-hours tracker, and a book of sayings. No framework, one dependency (`marked` for Markdown), builds in well under a second, deploys to GitHub Pages on every push to `main`.

## Everyday editing

You only ever touch the `content/` folder.

| Want to... | Edit |
|---|---|
| Write a post | Copy `content/posts/_TEMPLATE.md` to `content/posts/YYYY-MM-DD-some-slug.md` |
| Log progress | `npm run log -- <hours> <bp> [tier]`, or add a row to `content/stats.json` |
| Add a saying | Edit `content/tips.md` |
| Change the About page | Edit `content/about.md` |
| Change name, tagline, intro, YouTube/Twitch links | Edit `content/site.json` |
| Add an image | Drop it in `content/media/` and reference it as `../../media/name.jpg` from a post |

Commit and push to `main`. GitHub Actions rebuilds and publishes within a minute or two.

### Posts

```markdown
---
title: The wall is not a shield
date: 2026-10-02
summary: One sentence for the blog list and RSS.
tags: structures, defence
---

Markdown body.
```

Every post is **stamped** with hours played, BP, and PORC rank. The stamp is taken from the latest checkpoint in `stats.json` dated on or before the post. If you want a precise stamp, add `hours:`, `bp:`, and `porc:` to the front matter and they override. `draft: true` hides a post. Files starting with `_` are ignored.

### Checkpoints (`stats.json`)

Log one whenever you feel like it: after a session, once a week, at milestones. The quickest way is from a terminal in this folder:

```bash
npm run log -- 12.5 340
```

That appends today's date with 12.5 hours and 340 BP. Add a PORC tier and a note if you like, and `--date` to backfill:

```bash
npm run log -- --date 2026-09-01 40 900 "gold ii" "first gold placement"
```

Or edit the file by hand. Each row looks like this, and `porc` can be `null` until you have a placement:

```json
{ "date": "2026-09-17", "hours": 90, "bp": 1610, "porc": "gold", "note": "optional" }
```

PORC tiers, top to bottom: meteorite, diamond, mithril, adamantium, platinum, gold, silver, bronze, iron, stone. Tiers with divisions can be written `gold ii` or `gold 2` (shown as "Gold II"). The ladder is listed in `site.json` if it ever changes. BP is drawn as a line from zero; PORC is drawn as steps up the ladder.

### Sayings (`tips.md`)

```markdown
## On the stance

1. The saying itself, one or two lines.
2. Another saying.

   An indented paragraph under a saying becomes its commentary.
```

Each `##` heading is a chapter (numbered I, II, III...). Each list item is a saying, referenced as `II.3` and linkable as `/tips/#ii-3`. A random saying appears on the home page.

## Running locally

```bash
npm install
npm run dev
```

Opens a server at <http://localhost:4321> and rebuilds when anything in `content/` or `src/` changes. `npm run build` writes the site to `dist/`.

## How it is put together

- `build.js` reads `content/`, renders every page with template strings, draws the charts as inline SVG, and writes `dist/`.
- `src/css/style.css` holds the whole design as CSS variables. Light and dark palettes are at the top.
- `src/js/main.js` handles the theme toggle, chart hover tooltips, and the rotating saying.
- `src/img/wordmark.svg` is the site name drawn in Chinese Rocks as outlines. To change the text, re-run the fontTools snippet in the git history or replace the file with any SVG that uses `fill="currentColor"`.
- `.github/workflows/deploy.yml` builds and publishes to GitHub Pages. The workflow passes the Pages base URL into the build, so links work whether the site lives at `user.github.io/repo` or a custom domain.

## Fonts and licences

- Body and headings: [ET Book](https://github.com/edwardtufte/et-book), MIT licence, self-hosted in `src/fonts/et-book/`.
- Wordmark: Chinese Rocks by Typodermic Fonts. The free desktop licence allows static images of text but not web embedding, so the OTF is **not** shipped with the site and must not be added to it. If you buy Typodermic's webfont licence later, add the `@font-face` to `style.css` and set `--font-display` on headings.

## Custom domain (optional)

Set the custom domain in the repository's **Settings → Pages** and point your DNS at GitHub as it instructs. The deploy workflow picks up the new base URL automatically on the next push, so the RSS feed and canonical links follow the domain.
