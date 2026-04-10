# 🎓 AI College Search — Complete Prompt Guide
> For GitHub Copilot (Codex 5.3) + Azure OpenAI | VS Code

---

## 📌 Project Overview

Build a **natural language college search engine** that lets users type queries like:
- `"MBA college in Nagpur"`
- `"Engineering colleges in Mumbai with NAAC A grade"`
- `"Private B.Tech colleges in Pune"`

The AI will parse the query, map it to the correct database tables, and return matching colleges — exactly like a Google-style search.

---

## 🗺️ Database Schema (Your Tables)

```
ups_states        → id, name, zone_id, country_id, status
ups_cities        → id, name, state_id, status
ups_colleges      → id, college_name, state_id, city_id, institute_type, naac,
                    Ownership, year_of_establishment, nirf_ranking, status, is_deleted
ups_courses       → id, course_name, degree_id, status
ups_courses_specialization → id, specilization_name, course_id, status
ups_colleges_courses → id, master_college_id, college_id, course_id,
                       specilization_id, minpackage, seat_offered, status, is_deleted
```

### Join Logic (from your diagram):
```
colleges.state_id        → states.id
colleges.city_id         → cities.id
colleges_courses.master_college_id → colleges.id
colleges_courses.course_id          → courses.id
colleges_courses.specilization_id   → courses_specialization.id
```

---

## 🤖 PROMPT 1 — System Prompt for Azure OpenAI (NLU Parser)

> Use this as the **system message** when calling Azure OpenAI.  
> This prompt makes the AI extract structured filters from the user's natural language query.

```
You are an intelligent college search assistant for an Indian college discovery platform.

Your job is to extract structured search filters from a user's natural language query and return ONLY a valid JSON object — no explanation, no markdown, no extra text.

### DATABASE TABLES AVAILABLE:
- ups_colleges: college_name, institute_type, naac, Ownership (Public/Private), year_of_establishment, nirf_ranking, status, is_deleted
- ups_cities: name (city name)
- ups_states: name (state name)
- ups_courses: course_name (e.g., "MBA / PGDM / MMS", "B.Tech", "B.Com")
- ups_courses_specialization: specilization_name (e.g., "Finance", "Marketing", "Computer Science")

### OUTPUT FORMAT:
Return ONLY this JSON structure:
{
  "city": "<city name or null>",
  "state": "<state name or null>",
  "course": "<course name keyword or null>",
  "specialization": "<specialization keyword or null>",
  "naac_grade": "<A++ | A+ | A | B++ | B+ | B | C | null>",
  "ownership": "<Public | Private | null>",
  "institute_type": "<College | University | null>",
  "nirf_ranking_max": <number or null>,
  "keyword": "<any remaining college name keyword or null>"
}

### RULES:
1. Always return valid JSON only — no markdown fences, no explanation.
2. If the user mentions "MBA", set course to "MBA".
3. If the user mentions a city like "Nagpur", "Mumbai", "Pune" — set city.
4. If the user mentions a state like "Maharashtra", "Delhi" — set state.
5. Partial matches are fine — backend will use LIKE/ILIKE queries.
6. If a field is not mentioned, set it to null.
7. "government" or "govt" maps to ownership: "Public".
8. "private" maps to ownership: "Private".
9. NAAC grades: "A plus plus" → "A++", "A plus" → "A+", etc.

### EXAMPLES:
Query: "MBA college in Nagpur"
Output: {"city": "Nagpur", "state": null, "course": "MBA", "specialization": null, "naac_grade": null, "ownership": null, "institute_type": null, "nirf_ranking_max": null, "keyword": null}

Query: "government engineering colleges in Pune with NAAC A grade"
Output: {"city": "Pune", "state": null, "course": "Engineering", "specialization": null, "naac_grade": "A", "ownership": "Public", "institute_type": "College", "nirf_ranking_max": null, "keyword": null}

Query: "top 50 private MBA colleges in Maharashtra with Finance specialization"
Output: {"city": null, "state": "Maharashtra", "course": "MBA", "specialization": "Finance", "naac_grade": null, "ownership": "Private", "institute_type": null, "nirf_ranking_max": 50, "keyword": null}
```

---

## 🔧 PROMPT 2 — GitHub Copilot Chat Prompt (Full Feature Build)

> Paste this into **GitHub Copilot Chat** in VS Code to generate the full backend + frontend.

```
I am building an AI-powered college search feature for my platform using:
- Backend: Node.js / Express (or Python FastAPI — pick the best)
- Database: MySQL (tables already exist, described below)
- AI: Azure OpenAI (GPT-4o deployment) for natural language understanding
- Frontend: React.js with Tailwind CSS

## TASK:
Build a complete AI college search system where the user types a natural language query
like "MBA college in Nagpur" and gets back matching colleges from the database.

## DATABASE SCHEMA:
Table: ups_states (id, name, zone_id, country_id, status)
Table: ups_cities (id, name, state_id, status)
Table: ups_colleges (id, college_name, state_id, city_id, institute_type, naac,
       Ownership, year_of_establishment, nirf_ranking, status, is_deleted)
Table: ups_courses (id, course_name, degree_id, status)
Table: ups_courses_specialization (id, specilization_name, course_id, status)
Table: ups_colleges_courses (id, master_college_id, college_id, course_id,
       specilization_id, minpackage, seat_offered, status, is_deleted)

## JOIN LOGIC:
- colleges.state_id → states.id
- colleges.city_id → cities.id
- colleges_courses.master_college_id → colleges.id
- colleges_courses.course_id → courses.id
- colleges_courses.specilization_id → courses_specialization.id

## WHAT TO BUILD:

### 1. API Endpoint: POST /api/ai-search
- Accepts: { "query": "MBA college in Nagpur" }
- Step 1: Call Azure OpenAI with this system prompt to extract filters as JSON:
  [PASTE PROMPT 1 FROM ABOVE HERE]
- Step 2: Use extracted filters to build a dynamic SQL query joining all 6 tables
- Step 3: Return: { colleges: [...], total: N, filters_applied: {...} }

### 2. Dynamic SQL Builder function:
Build a function buildCollegeSearchQuery(filters) that:
- Starts with base query joining: colleges → cities → states → colleges_courses → courses → specializations
- Adds WHERE clauses dynamically based on non-null filters
- Uses LIKE '%keyword%' for text fields (city name, course name, specialization name)
- Filters: colleges.status = 'Active' AND colleges.is_deleted = 'No' always
- Filters: colleges_courses.status = 'Active' AND colleges_courses.is_deleted = 'No' always
- Returns DISTINCT colleges (no duplicates if college has multiple courses)
- If nirf_ranking_max is set, adds: colleges.nirf_ranking <= nirf_ranking_max
- Orders by: nirf_ranking ASC NULLS LAST, college_name ASC
- Limit 50 results

### 3. React Frontend Component: <AICollegeSearch />
- A prominent search bar with placeholder: "Search colleges... e.g. MBA college in Nagpur"
- As user types and presses Enter or clicks Search button:
  - Show loading spinner
  - Call POST /api/ai-search
  - Display results as college cards showing: college name, city, state, NAAC grade, course matched, ownership type
- Show "X colleges found for: [query]" count above results
- Show applied filters as chips/tags below the search bar
- Handle empty results gracefully: "No colleges found. Try a different search."

### 4. Error Handling:
- If Azure OpenAI fails: fall back to simple keyword search on college_name
- If SQL returns 0 results: try relaxing filters (remove specialization, then city→state)
- Log all queries for analytics

## CODE REQUIREMENTS:
- Clean, production-ready code with comments
- Use environment variables for DB credentials and Azure OpenAI key
- Azure OpenAI config: endpoint, api-key, deployment-name, api-version all from .env
- Use parameterized queries (no SQL injection)
- Add input sanitization on the query string
```

---

## 🔧 PROMPT 3 — Copilot Inline Prompt (SQL Query Builder Only)

> Use this as an **inline comment** in your code file for Copilot autocomplete:

```javascript
// Build dynamic SQL query for college search based on AI-extracted filters
// Tables: ups_colleges (c), ups_cities (ci), ups_states (s),
//         ups_colleges_courses (cc), ups_courses (cr), ups_courses_specialization (sp)
// Joins:  c.city_id = ci.id, c.state_id = s.id,
//         cc.master_college_id = c.id, cc.course_id = cr.id,
//         cc.specilization_id = sp.id
// Always filter: c.status='Active', c.is_deleted='No', cc.status='Active', cc.is_deleted='No'
// Dynamic filters: city LIKE, state LIKE, course LIKE, specialization LIKE,
//                  naac_grade =, ownership =, nirf_ranking <=
// Return DISTINCT c.id, c.college_name, ci.name as city, s.name as state,
//         c.naac, c.Ownership, c.nirf_ranking, cr.course_name, sp.specilization_name
// Order by nirf_ranking ASC NULLS LAST, college_name ASC LIMIT 50
function buildCollegeSearchQuery(filters) {
```

---

## 🔧 PROMPT 4 — Azure OpenAI Config (.env setup)

```
# .env file
AZURE_OPENAI_ENDPOINT=https://YOUR_RESOURCE.openai.azure.com/
AZURE_OPENAI_API_KEY=your_api_key_here
AZURE_OPENAI_DEPLOYMENT=gpt-4o          # your deployment name
AZURE_OPENAI_API_VERSION=2024-02-01

DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=your_database_name
DB_PORT=3306
```

---

## 🔧 PROMPT 5 — Copilot Prompt for Azure OpenAI Call

> Use this as an inline comment before the Azure OpenAI API call function:

```javascript
// Call Azure OpenAI to extract structured search filters from natural language query
// Use fetch() with POST to: ${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT}/chat/completions?api-version=${process.env.AZURE_OPENAI_API_VERSION}
// Headers: { 'Content-Type': 'application/json', 'api-key': process.env.AZURE_OPENAI_API_KEY }
// Body: { model, max_tokens: 500, temperature: 0, messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: query }] }
// Parse response.choices[0].message.content as JSON
// If JSON.parse fails, return all-null filters object
async function extractFiltersFromQuery(query) {
```

---

## 📋 Implementation Checklist

### Backend
- [ ] `POST /api/ai-search` endpoint created
- [ ] Azure OpenAI integration with system prompt (Prompt 1)
- [ ] `buildCollegeSearchQuery(filters)` dynamic SQL function
- [ ] Fallback to keyword search if AI call fails
- [ ] Parameterized queries (prevent SQL injection)
- [ ] DISTINCT results (no duplicate colleges)
- [ ] Always filter Active + not deleted records

### Frontend
- [ ] Search bar with Google-like UX
- [ ] Loading state while AI processes
- [ ] College cards with: name, city, state, NAAC, course, ownership
- [ ] Filter chips showing what was detected
- [ ] Result count display
- [ ] Empty state handling
- [ ] Error state handling

### Testing Queries to Verify
- `MBA college in Nagpur` → should return ~42 colleges
- `Government engineering college in Pune` → should filter by ownership=Public + course=Engineering + city=Pune
- `NAAC A+ college in Maharashtra` → should filter by naac=A+ + state=Maharashtra
- `B.Tech colleges in Mumbai with Computer Science` → course + specialization + city

---

## 💡 Pro Tips for Copilot Usage

1. **Open all 3 relevant files** in VS Code tabs before asking Copilot — it uses open files as context
2. **Use `// @workspace` in Copilot Chat** to include your full project context
3. **Paste the DB schema as a comment** at the top of your route file — Copilot will autocomplete smarter
4. **Ask Copilot**: `"Add result caching so same queries don't hit Azure OpenAI twice"` after basic build works
5. **Ask Copilot**: `"Add query suggestions as the user types using debounce"` for better UX
