# Fact-Checking System Setup

This BQS correctness layer now uses three lanes:

1. `direct_match_stat`
   Verified against the live/current scorecard.
2. `historical_structured`
   Verified against a local historical cricket warehouse loaded from SportMonks fixtures.
3. `web_search`
   Verified via Serper or Tavily against trusted cricket/news domains.

## 1. Apply the schema

If you use Prisma directly:

```bash
npx prisma generate
npx prisma db push
```

If you prefer manual SQL, apply:

```bash
prisma/historical_warehouse_migration.sql
```

## 2. Keep web fact-checking configured

Set one search backend:

```env
SERPER_API_KEY=...
```

or

```env
TAVILY_API_KEY=...
```

Optional:

```env
FACT_CHECK_HISTORICAL_ENABLED=true
FACT_CHECK_SEARCH_DEPTH=basic
FACT_CHECK_MAX_WEB_CLAIMS=3
```

## 3. Load the historical warehouse from SportMonks

Import completed fixtures straight from SportMonks:

```bash
npx tsx scripts/import-sportmonks-history.ts --pages 10 --per-page 100
```

Filter to a match type if needed:

```bash
npx tsx scripts/import-sportmonks-history.ts --pages 10 --match-type ODI
```

Or seed it through the admin route:

```bash
POST /api/admin/seed-historical-warehouse
```

The importer uses `/fixtures` for discovery and hydrates each completed match with `/fixtures/{id}` plus `runs`, `batting`, `bowling`, `lineup`, `league`, `venue`, `season`, and `manofmatch` includes before writing to the warehouse.

## 4. Rescore blogs

Once the warehouse is loaded, rescore blogs so BQS correctness uses the new historical lane:

```bash
npx tsx scripts/rescore-blog-scores.ts --all
```

## 5. Verify health

Check:

```bash
curl http://localhost:3000/api/health
```

Look for:
- `historicalWarehouseAvailable: true`
- `historicalWarehouseMatchesLoaded > 0`
- `searchConfigured: true`

## 6. What the app does now

- Single-match claims stay on live scorecards.
- Career/history/record claims are routed into the historical warehouse when they match supported query intents.
- News/current/unstructured claims go to web retrieval.
- If the warehouse cannot answer a structured claim, the claim is rerouted to web search instead of being dropped.
- If no scorecard-backed direct check is available, BQS now falls back to the heuristic direct-stat path instead of silently zeroing it out.
