# 14-DEPENDENCIES

## Node / Next.js runtime

The app is built on:

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS
- Prisma
- NextAuth

Key packages in the package manifest include:

- next
- react
- react-dom
- @prisma/client
- prisma
- next-auth
- lucide-react
- zod or validation libraries
- Playwright or testing components
- other app dependencies added during feature development

## Python service dependency notes

The Python space includes additional libraries, mostly under the separate requirements files:

- requirements.txt at repo root
- ai_service/requirements.txt
- insights_service/requirements.txt

These are needed for:

- AI model interaction
- data processing
- analytics
- fact verification
- retrieval and inference flows

## External runtime dependencies

The product depends on runtime infrastructure outside the Node project:

- SQL Server or compatible DB
- Ollama service
- optional FastAPI service endpoints
- SportMonks API token and data access
- Deepgram token
- search provider tokens

## Dependency status

The dependency model is broad and service-heavy, which is common for a product with AI and real-time sports data integration. The main challenge is not missing packages but missing runtime environment readiness.
