# BarMaid Architecture & Agent Continuity Guide

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.
<!-- END:nextjs-agent-rules -->

---

## Project Identity & Architectural Contract
- **Entity**: BarMaid is an independent B2B POS optimization utility operated under D6 Digital LLC.
- **Scope Boundary**: BarMaid strictly handles POS catalog hygiene, modifier deduplication, menu OCR, vendor invoice parsing, and register button ergonomics directly for coffee shop registers (Square / Clover).
- **Isolation from SipPass**: BarMaid NEVER handles consumer mobile ordering, digital wallets, or customer payment arbitration. Its primary output to SipPass is a clean, normalized, canonical catalog pushed to the shared Supabase database, strictly scoped by `merchant_slug`.

---

## Session History & Milestones

### Milestone 1: Square Cloud Integration & Foundation (Sept 2026)
- Verified Square Cloud catalog queries and batch updates against Square Production API using the legacy client endpoint.
- Enforced clean Next.js App Router structure housing `/api/catalog` and `/api/ocr`.
- Verified scoping under initial test tenant `konnowac-coffee`.

### Milestone 2: Menu Vision Pipeline & Ergonomics Studio (Sept 27–29, 2026)
- **Vision Pipeline**: Operational `@google/genai` vision pipeline (`app/api/ocr/route.ts`) supporting automatic fallback. Successfully extracted menu structures from Old Town Cafe walk-up boards (Classics, Big Train, Boba, Kiddie Corner, and Energy Drinks flavor matrices).
- **Regional Heuristics Established**: Café drive-thru baseline sizing:
  - Hot: 12 oz, 16 oz, 20 oz (with 8 oz short / 32 oz optional).
  - Cold / Energy: 16 oz, 24 oz, 32 oz.
  - Energy drink additives (Lotus, Red Bull) established strictly as modifiers.
- **5×4 Ergonomics Studio**: Built mock register layout solving grid population across 53 items within an 80-item capacity limit with grid layout synchronization.

### Milestone 3: 8-Step Client Onboarding Pipeline (Oct 19, 2026)
- Replaced visual POS screen comparison (Dropzone B) with direct Cloud POS OAuth.
- Expanded intake from simple chalkboards to an 8-step end-to-end client setup pipeline:
  1. **Business License Intake**: OCR extraction of legal name, DBA, address, and slug creation.
  2. **Menu & Sign Board Intake**: Multi-image OCR parsing drink categories, base sizes, and board pricing.
  3. **Vendor Invoice Intake**: OCR ingestion of distributor delivery slips (Dillanos, Torani, Big Train) to isolate retail SKUs, flavor modifiers, and filter backroom disposables.
  4. **Guided Rule Verification**: Quick prompt confirming cup size defaults, espresso shot recipes, and upcharge thresholds.
  5. **POS OAuth Handshake**: Merchant connects Square/Clover; BarMaid pulls existing catalog snapshot.
  6. **Ergonomic Layout Selection**: Merchant selects register interface (5×4 High-Velocity Drive-Thru Grid, Category Drawer, or Perimeter Rail).
  7. **Automated Catalog Push**: BarMaid runs batch API upsert to POS cloud and exports canonical catalog to Supabase for SipPass.
  8. **Field Deployment**: On-site iPad/register grid arrangement and test charge.

---

## Active Architecture & Routing

### App Router Structure
```text
app/
├── api/
│   ├── catalog/        # Square / Clover catalog read/write & batch upsert
│   ├── ocr/            # @google/genai vision parser for boards, licenses & invoices
│   └── oauth/          # Square / Clover merchant authorization callbacks
├── onboard/            # 8-step merchant intake wizard
├── studio/             # 5×4 Register Ergonomics Layout Studio
└── page.tsx            # Intake sandbox & multi-source upload dropzones