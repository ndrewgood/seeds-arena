# Seeds

A quiet, Mac-app-style skin over [Are.na](https://www.are.na), optimized for browsing and sorting images, GIFs and video.

- **Inbox** for new blocks that need sorting, with an unsorted-count badge in the sidebar
- **Folders**: nestable, drag-to-nest channels that follow Seeds' naming convention
- Collapsible **Channels** section (collapsed by default) for everything else
- Drag blocks from the grid or viewer onto any Inbox / folder / channel in the sidebar to move them
- Drop images, GIFs, files, text or links onto the grid to create a block there
- Justified, aspect-ratio-preserving grid with infinite scroll; folder tiles show thumbnails of what's inside
- Tile-size slider, sort order, hover-to-play video, full-screen viewer (←/→, Esc)

## Run

```sh
npm install
npm run dev
```

Requires Node ≥ 20.19 / 22.12.

## Deploy to Vercel

The app uses `adapter-static` and writes its production files to `build/`, not `public/`.
The included `vercel.json` sets the build command to `npm run build`, the output directory
to `build`, and an SPA fallback to `index.html` for direct links such as `/c/<slug>` and
`/auth/callback`. Existing static assets are served normally.

Set Vercel's **Root Directory** to the directory containing `package.json` and `vercel.json`,
then redeploy. If configuring the project manually, use **Build Command** `npm run build`
and **Output Directory** `build`.

## Signing in

Seeds asks for an Are.na **personal access token** with the **`write`** scope (read *and* write)
([create one here](https://www.are.na/settings/personal-access-tokens)). It's kept in
`localStorage` and only ever sent to `api.are.na`. A read-only token can still browse, but every
write (creating the Inbox/folders, moving or adding blocks) is rejected with a 403.

To also offer OAuth sign-in, register an app at <https://www.are.na/oauth/applications>
with redirect URI `http://localhost:5173/auth/callback`, then copy `.env.example` to `.env`
and set `VITE_ARENA_CLIENT_ID`. Seeds requests the `write` scope.

## How Seeds maps onto Are.na

Everything is an ordinary channel with a naming convention, so it all stays visible and editable on Are.na:

| Seeds    | Are.na title             | Are.na description                |
| -------- | ------------------------ | --------------------------------- |
| Inbox    | `📨 Inbox`               | `Inbox - Seeds for Are.na`        |
| Folder   | `🌱 Design`              | `Design folder - Seeds for Are.na`|
| Nested   | `🌱 Design > Type`       | `Type folder - Seeds for Are.na`  |

Nesting a folder just rewrites its title (and its sub-folders' titles). Channels Seeds creates are **private**
(see `DEFAULT_VISIBILITY` in `src/lib/seeds.ts`).

On first sign-in, Seeds offers to create the Inbox. For existing accounts, use **Initialize Inbox** in the
account menu at the bottom of the sidebar (or the button on the Inbox page).

## Renaming folders

Hover over a folder's title in the grid header and click the pencil, or right-click its sidebar row
and choose **Rename**. Enter or clicking away saves; Escape cancels. Blank names leave the folder
unchanged. Names cannot contain `>` (reserved for folder paths) or conflict with an existing path.

Renaming updates the corresponding Are.na channel and every descendant folder path. Blocks,
visibility, descriptions and custom icons stay unchanged. Renaming a subtree takes multiple API
writes; if a write fails, Seeds attempts to restore completed changes and reports any partial failure.

## Folder icons

Right-click a folder in the sidebar and choose **Edit icon**. Browse the full [Iconoir](https://iconoir.com/)
catalog (1,671 icons in version 7.12.1), search by name, or filter by Outline/Solid. **Show more** reveals
additional results; search always covers the entire catalog. **Use default** resets the icon.
SVGs are local app assets, so no third-party icon service is contacted at runtime.
Changes require write access and sync through Are.na, not just this browser.

Seeds preserves the existing channel description and stores the selection as a Markdown reference line:

```md
[seeds-folder-icon]: {"kind":"icon","library":"iconoir","value":"regular/camera"}
```

Emoji selection is no longer supported. Previously saved Lucide icons map to Iconoir equivalents;
previously saved emoji display the default folder icon until replaced. No existing descriptions are
rewritten automatically. The `🌱` channel-title prefix still identifies the folder; changing an icon
doesn't rename or move it.

## Notes

- Fully client-side (`adapter-static`, SPA fallback); no server holds your token.
- Channel contents are fetched 50 at a time as you scroll. The sidebar needs every channel title to find your
  Inbox and folders, so it pages through your channel list (100 per request) once per session.
- Moving a block is "connect to the destination, then remove the old connection" (two writes).
