# CricGeek - Cricket Platform

## Tech Stack
- **Framework**: Next.js 14+ with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS with custom green/black/white theme
- **Auth**: NextAuth.js
- **Database**: Prisma ORM (SQLite for dev, PostgreSQL for prod)
- **Icons**: Lucide React

## Color Palette
- Primary Green: `#4CAF50` / `#22C55E`
- Dark: `#0A0A0A` / `#1A1A2E`
- White: `#FFFFFF`
- Gray accents: `#F5F5F5`, `#E0E0E0`

## Project Structure
- `src/app/` - App Router pages and layouts
- `src/components/` - Reusable UI components
- `src/lib/` - Utilities, API helpers, auth config
- `src/types/` - TypeScript type definitions
- `prisma/` - Database schema

## Conventions
- Use server components by default, 'use client' only when needed
- Mobile-first responsive design
- API routes in `src/app/api/`
- Error boundaries for API failure handling
