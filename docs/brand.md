# Toolkien brand

The brand in one page: who we talk to, how we sound, what things look like, and where the edges are. The code is the source of truth for values: tokens in `src/routes/layout.css`, geometry and hex in `src/lib/components/brand/paths.ts`, name and taglines in `src/lib/brand.ts`.

## Positioning

**Toolkien is one MCP server for all of yours.** Add your tools once and every AI client (Claude, ChatGPT, Codex, Cursor, VS Code…) can use them. The agent works in code mode: it searches, reads compact TypeScript types and runs one sandboxed script, so it spends far fewer tokens and finishes much faster, under permissions, approvals and an audit trail you control.

- Tagline: _One MCP to rule them all._ (the pun is the hook; never explain it)
- Alternates: _Connect once. Call them all._ · _One tool to find them, one sandbox to run them._
- Storyline, in order: fewer tokens and faster runs → connect once, use everywhere → share with your team → security → managed (first) or self-hosted (open source, AGPL-3.0).
- Audience: developers first, then the team lead or platform engineer who has to say yes.

## Voice

Witty in the headline, precise in the sentence under it. The joke opens the door; the facts close the deal.

| Do                                                     | Don't                                                 |
| ------------------------------------------------------ | ----------------------------------------------------- |
| "Nothing on the anvil yet." + what to do next          | Jokes inside errors that hide what went wrong         |
| Concrete nouns: tokens, tool calls, sandbox, approvals | "Supercharge", "unleash", "magic", "AI-powered"       |
| Numbers with their source, or labelled "illustrative"  | Benchmarks we did not run, logos we do not have       |
| One flourish per screen (a kicker, a title)            | Fantasy role-play, archaic English, quotes from books |
| Short sentences, active voice, second person           | Exclamation marks                                     |

Microcopy kit: _forged_ (made, added), _anvil_ (where work happens), _spark_ (a first result), _seal_ / _hallmark_ (approved, verified), _gate_ (the one connection). Use at most one per screen, and never in table cells, form labels or status values: those stay literal.

## Directions explored

1. **Guild ledger**: heraldic crest, wax seals for approvals, ledger for audit. Strong metaphors for enterprise trust, but crests drift into medieval cliché and read slow and ornamental for a developer tool.
2. **Arcane terminal**: glowing glyphs on black, spell-like code. Memorable, but runes are exactly what we must avoid and it reads as hacker kitsch, not trustworthy infrastructure.
3. **The forge (chosen)**: a toolsmith's workshop. Iron-ink neutrals on warm paper, one ember accent, an editorial serif for headlines, and a mark made of two interlocking rings (the double o of the name). It carries the pun and a crafted fantasy flavour without borrowing anything, maps cleanly onto the product (tools are forged once, then linked to every client), and stays calm in the app: ember is a single accent, the rest is ink and paper. It is unlike the blue/purple default of developer tools and unlike PostHog's beige-and-bold-sans look, while keeping its confidence.

## Logo

- **Wordmark**: `Toolkien` set in Fraunces (opsz 32, weight 600), converted to outlines; the `oo` is redrawn as two interlocking rings, the right one in ember. It is the default logo (site header, sidebar, auth, footer, OG).
- **Mark**: the two rings alone, a chain link (the left ring passes over at the top crossing, the right one at the bottom). Used for the favicon, app icons, collapsed sidebar and illustrations. On the ink tile: paper + ember.
- Files: `static/brand/toolkien-wordmark.svg` (+ `-dark`), `toolkien-mark.svg` (+ `-dark`), `toolkien-icon.svg`; in the app use `Logo` from `#lib/components/brand` (`variant="wordmark" | "mark"`, `tile`, sizes `sm`–`xl`).
- Clear space: the height of one ring around the wordmark. Minimum size: wordmark 14px tall, mark 16px.
- Never: recolour the left ring, separate the rings, add a third ring, set the name in another font, add an inscription inside or around the rings, outline or shadow the logo.

## Palette

| Token                                 | Light                             | Dark                            | Use                                        |
| ------------------------------------- | --------------------------------- | ------------------------------- | ------------------------------------------ |
| `background` / paper                  | `oklch(0.99 0.003 80)` `#fdfcf9`  | `oklch(0.175 0.011 255)`        | Page                                       |
| `foreground` / ink                    | `oklch(0.21 0.014 255)`           | `oklch(0.95 0.006 80)`          | Text                                       |
| `primary` (ember)                     | `oklch(0.555 0.178 42)` `#c34200` | `oklch(0.72 0.16 50)` `#f2823b` | Buttons, links, focus ring, the right ring |
| `muted-foreground`                    | `oklch(0.47 0.012 255)`           | `oklch(0.72 0.01 255)`          | Secondary text                             |
| `success` / `warning` / `destructive` | green 155 / amber 70 / crimson 20 | lighter variants                | States only                                |
| `ember` (brand)                       | `oklch(0.67 0.19 45)` `#ef6a1a`   | `oklch(0.72 0.17 50)`           | Art, icon, sparks                          |
| `brass` (brand)                       | `oklch(0.8 0.13 85)` `#e4b750`    | `oklch(0.82 0.12 85)`           | Rare highlight in art                      |
| `ink` (brand)                         | `oklch(0.19 0.014 255)` `#11151b` | `oklch(0.14 0.011 255)`         | Icon tile, dark bands                      |

Every text pair passes WCAG AA (ember on paper 4.98:1, paper on ember 4.98:1, dark ember on dark card 6.85:1). Destructive is crimson (hue 20), far enough from ember (hue 42) to be told apart; states always come with a label or icon too.

## Type

- **Display: Fraunces** (variable, opsz + weight, self-hosted latin subset, SIL OFL 1.1, `src/lib/assets/fonts/`). Landing and section headlines, auth titles, docs titles, empty and error titles, step numerals. Optical sizing on, weight 600, slight negative tracking. Never in tables, forms, buttons or app page titles.
- **UI: Inter Variable** (already bundled). Everything else.
- **Mono: system stack**. Ids, tool paths, code, and the brand's small caps labels (hallmarks, footer headings), uppercase with wide tracking.

## Shape, depth, focus

- Radius 6px in the app; cards on the site use the same radius with the `shadow-plate` elevation (soft drop + hairline edge, a struck plate).
- **Hallmark**: the chamfered (cut-corner) plate (`chamfer` utility, `Hallmark` component) for eyebrows and badges on the site. Decorative only: the clip-path would cut a focus ring.
- **Forge floor**: a faint dot grid (`bg-forge-grid`) behind the hero, auth and focus pages.
- Focus: the ember ring (`--ring`), never removed.
- Density: app tables stay 36px rows, `text-sm`; personality never enters data views.

## Iconography and illustration

- Icons: lucide, 16px in the app, in a `primary/10` square on the site. Client icons are our generic marks (`CLIENT_ICONS`), never vendor logos.
- Spot illustrations (`BrandArt`): line art in `currentColor` with one ember accent, built from the logo's parts. `converge` (tools → Toolkien → clients), `forge` (anvil + sparks: empty lists), `ledger` (empty activity), `seal` (nothing to approve), `trail` (404), `gate` (connect, onboarding), `offline`, `crack` (5xx). Theme-aware, decorative (`aria-hidden`).
- Where personality lives: landing, auth, empty states (`EmptyState art`, `DataTable` / `Timeline` `empty.art`), error pages (kicker line + art), onboarding checklist, docs titles, OG cards. Where it does not: tables, forms, settings, status values, approval dialogs.
- Diagrams that carry an argument (token before/after, connect once) are HTML (`Compare`), so they stay accessible, themeable and exact.

## Open Graph and icons

`node scripts/brand-images.ts` renders `static/og.png` (brand card), `static/og/docs/<slug>.png` (one per docs page; a spec checks they exist), the PNG icons (192, 512, maskable 512, apple-touch 180) and the `static/brand/*.svg` files. `/icon.svg` is served from the same geometry. Re-run after changing the brand or the docs nav.

## Motion

Raster illustrations were tried and dropped: generated images read as generic and could not follow the theme. The brand draws with SVG and animates it, in the spirit of Supabase's landing: subtle, precise, technical.

- **Hero (`ConvergeFlow`)**: real directory logos on the left, the rings hub, generic client marks on the right. Ember packets run along the wires on an 11 s CSS cycle: tools flow to the hub and fan out to every client, then one script goes in and fans out into a call per tool (code mode), and one answer comes back. Hover or focus a chip to trace its paths and see a sample call; chips are links.
- **Before / after (`Compare`)**: plays once when scrolled into view. The slow side accumulates its round trips or setups while the counters climb; the fast side settles in under a second. A new tool is added: one setup per client without Toolkien, lit in every client at once with it. Numbers stay labelled "illustrative" until measured.
- **Logo**: the rings draw themselves in on load in the site header (`Logo draw`); the closing band's `gate` art (`BrandArt animated`) draws its rings on first view under a slow ember glow.
- Rules: CSS transforms, opacity and `stroke-dashoffset` only, no per-frame JavaScript except the two counters; loops pause off screen and in hidden tabs (`InView`); `prefers-reduced-motion` shows the final, static frame; no layout shift (SSR renders the final state). Motion stays on the site: the app gets none.

## IP and trademark guardrails

Allowed: the name (a pun on _tool_), the tagline pun, an original two-ring mark, forge and workshop imagery, and our own wording.

Never: characters, places, names or quotes from Tolkien's works or the films; maps; the Ring inscription or any text on or around a ring; Tengwar/Cirth or other "elvish" or runic fonts; a single gold ring as a hero object; volcano/eye imagery; film stills, posters or their typography; the films' logos.

Residual risk for the author to weigh before launch:

- **The name** is a deliberate echo of _Tolkien_. The Tolkien Estate and Middle-earth Enterprises actively enforce their marks (including against names that merely evoke them). Software is a different class from books and films, but a challenge on the name itself cannot be ruled out; this is the largest risk and is independent of the visual identity.
- **The tagline** echoes a famous line. Short phrases are rarely protected by copyright, but in combination with the name it strengthens the association a rights holder might object to.
- **The rings motif**, added at the author's request, increases the association further. Mitigations in place: two interlocking rings (a chain link), not one gold ring; steel and ember, not gold; no inscription; no fantasy lettering. Two interlocked rings are also a common generic symbol (links, unions), which keeps confusion with other marks low, but run a design-mark search before registering it.
- Fraunces is SIL OFL 1.1: using its outlines in a logo is permitted; the font files ship with their license.
- Before launch: a trademark clearance search (EUIPO, USPTO, WIPO) on the word mark and the figurative mark in classes 9 and 42, and a domain check, as the spec already notes.

_This section is a design-side risk note, not legal advice: have the name and logo cleared by a qualified trademark lawyer before registering or launching._
