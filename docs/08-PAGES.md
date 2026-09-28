# 08-PAGES

## Major app routes

This section summarizes the primary page responsibilities in the app.

### / (home)

Acts as a landing page and hub for match updates, editorial promos, and community features.

### /matches

Lists current and recent matches, often sourced from cricket data provider wrappers.

### /matches/[id]

Shows the detailed match experience, including tabs for scorecard, commentary, squads, and analysis.

### /blog

Displays the community feed for cricket expressions and blog articles.

### /blog/[slug]

Displays a single blog article with score breakdown, author profile, reactions, comments, and fact-check visualization.

### /blog/write

Primary writing workflow page. Supports:

- draft composition
- AI editing and tag generation
- quality scoring
- publishing and tracking

### /commentary

Provides a commentary experience and list of available sessions.

### /commentary/[sessionId]

The feature page for a single live commentary session.

### /leaderboard

Displays writer rankings and top blog/performance information.

### /writer/[id]

Writer identity and profile page showing:

- DNA
- badges
- achievements
- recent expressions
- score metrics

### /admin

Admin dashboard for moderation and contest management.

### /auth/login

Login screen and auth UI.

### /auth/register

Registration flow for new accounts.

## Additional route groups

These pages include legal, marketing, and support content:

- /contact
- /legal/terms
- /legal/privacy
- /help and support pages

## Page implementation notes

Several pages are implemented as client components when they need interactive experiences for:

- scoring status
- editing drafts
- live dashboards
- social actions

This means page behavior is often distributed between server components and client components depending on interactivity needs.

## Page-level dependencies

Key dependencies include:

- Prisma data access
- NextAuth session checks
- SportMonks or legacy match wrappers
- scoring service and AI endpoints
- Python insights service endpoints

## Status summary

The page map is broad and feature-rich. The most central user journeys are the writing, match, profile, and admin experiences—these are the highest-signal parts of the product.
