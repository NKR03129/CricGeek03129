# 03-FRONTEND

## Frontend stack

The primary frontend is built with:

- Next.js 16
- React 19
- TypeScript
- Tailwind-style utility classes
- next-auth/react for session handling

The app shell is created in src/app/layout.tsx.

## App router structure

The main pages under src/app include:

- / — home landing page
- /matches — match listings and live hub
- /matches/[id] — match detail view
- /blog — expression feed
- /blog/[slug] — article detail page
- /blog/write — drafting experience and EQS scoring flow
- /commentary — live commentary sessions
- /leaderboard — writer ranking table
- /writer/[id] — writer profile page
- /admin — admin dashboard
- /auth/login and /auth/register — authentication screens
- /contact and legal pages

## Page behavior overview

### Home page

File: src/app/page.tsx

Purpose:

- expose landing page hero and feature summary
- show live matches, recent results, and upcoming fixtures
- link to blogs, insights, and calendar flows

Data source:

- getMatchHubMatches() in src/lib/cricket-api.ts

### Matches page

File: src/app/matches/page.tsx

Purpose:

- list the current match hub
- pass data to MatchesClient

### Match detail pages

Files:

- src/app/matches/[id]/page.tsx
- src/app/matches/[id]/preview/page.tsx
- src/app/matches/[id]/analysis/page.tsx
- src/app/matches/[id]/post-match/page.tsx

Purpose:

- show scorecards, previews, analysis, and post-match detail
- route to tabs such as scorecard, commentary, squads, analysis

### Blog feed and post pages

Files:

- src/app/blog/page.tsx
- src/app/blog/[slug]/page.tsx
- src/app/blog/write/page.tsx

Purpose:

- allow user-authored cricket expressions
- allow social reactions, saves, comments, and leaderboard-linked visibility
- includes a draft editor with EQS scoring flow

### Commentary pages

Files:

- src/app/commentary/page.tsx
- src/app/commentary/[sessionId]/page.tsx

Purpose:

- list commentary sessions and existing session state
- support moderator session management and display of commentary entries

### Writer pages

Files:

- src/app/writer/[id]/page.tsx
- src/app/leaderboard/route.ts (API) and leaderboard page if present under src/app/leaderboard maybe no page file in tree but likely route exists

Purpose:

- display writer profile, achievements, badging, DNA, and recent blogs

## Major reusable component groups

### Layout

- src/components/layout/Navbar.tsx
- src/components/layout/Footer.tsx

### Matches

- LiveMatchCard
- MatchLiveCommentary
- LiveScoresTicker
- MatchDetailClient and related UI blocks

### Blog

- CricketBallReactionButton
- SaveBlogButton
- BlogDiscussion
- score / breakdown display UI

### Writer

- WriterProfileCard
- WriterDNAChart
- FollowWriterButton
- ScoreRing

### Ads

- src/components/ads/AdSlot.tsx

## Frontend state patterns

The app uses a mostly server-first pattern with client-side state in pages/components for:

- blog search and feed selection
- auth session state
- live commentary sessions
- EQS publishing progress
- draft persistence to localStorage
- ad slot / UI toggles

The app provider wraps the app in SessionProvider from next-auth/react in src/app/providers.tsx.

## Data access pattern

Client components usually fetch through route handlers in src/app/api and then render normalized results in the browser.

Examples:

- fetch('/api/blogs') to load expressions
- fetch('/api/matches') or direct page server fetches for live match hub
- fetch('/api/commentary') to fetch commentary session list
- fetch('/api/writer/[id]') for writer profile data

## UI behavior and validation patterns

Several components implement client-side checks for:

- word count limits for blog posting
- status toggles and loading states
- empty-state rendering
- auth gating for session-based flows
- contest and admin UI states

## Frontend status notes

The frontend is clearly active and feature-rich, but several user flows depend on external services or backend env configuration. The strongest example is the writing flow, which requires blog creation, scoring pipeline, and AI inference to be configured.

## Notable frontend risks

- A large number of UI flows assume backend services are available without strong graceful degradation
- Some pages appear designed for local demo user flows and may not behave cleanly without seeded DB data
- The admin UI is role-based but depends on actual session role values being present in the DB and auth system
