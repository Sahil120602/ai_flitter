const fs = require("fs/promises");
const path = require("path");
const { extractFiltersFromQuery } = require("./azureClient");
const { runQuery } = require("./db");

function sanitizeQuery(input) {
  return String(input || "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

function detectCourseAliasesFromQuery(query) {
  const text = String(query || "").toLowerCase();
  const aliases = [];

  if (/\bb\.?\s*sc\b/.test(text)) {
    aliases.push("B.Sc");
  }
  if (/\bb\.?\s*a\b/.test(text)) {
    aliases.push("B.A");
  }
  if (/\bb\.?\s*com\b/.test(text)) {
    aliases.push("B.Com");
  }
  if (/\bb\.?\s*tech\b|\bbtech\b/.test(text)) {
    aliases.push("B.Tech");
  }
  if (/\bm\.?\s*ba\b|\bmba\b/.test(text)) {
    aliases.push("MBA");
  }

  return aliases;
}

function toTitleCase(value) {
  return String(value || "")
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function detectCityFromQuery(query) {
  const text = String(query || "").toLowerCase();
  const match = text.match(/\bin\s+([a-z][a-z\s.-]{1,40})/i);
  if (!match) {
    return null;
  }

  const stopWords = new Set(["with", "for", "of", "and", "or", "where", "near"]);
  const parts = match[1]
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !stopWords.has(token));

  if (parts.length === 0) {
    return null;
  }

  return toTitleCase(parts[0]);
}

function detectCityAliasesFromQuery(query) {
  const text = String(query || "").toLowerCase();
  const cities = [];

  if (/\bnavi\s*mumbai\b/.test(text) || /\bnavimumbai\b/.test(text)) {
    cities.push("Navi Mumbai");
  }
  if (/\bmumbai\b/.test(text)) {
    cities.push("Mumbai");
  }

  return Array.from(new Set(cities));
}

function detectNirfRangeFromQuery(query) {
  const text = String(query || "").toLowerCase();

  const explicitRange = text.match(/\b(\d{1,4})\s*(?:to|-|through|till|until)\s*(\d{1,4})\b/i);
  if (explicitRange) {
    const first = Number(explicitRange[1]);
    const second = Number(explicitRange[2]);
    if (!Number.isNaN(first) && !Number.isNaN(second)) {
      return {
        min: Math.min(first, second),
        max: Math.max(first, second),
      };
    }
  }

  const betweenRange = text.match(/\bbetween\s+(\d{1,4})\s+and\s+(\d{1,4})\b/i);
  if (betweenRange) {
    const first = Number(betweenRange[1]);
    const second = Number(betweenRange[2]);
    if (!Number.isNaN(first) && !Number.isNaN(second)) {
      return {
        min: Math.min(first, second),
        max: Math.max(first, second),
      };
    }
  }

  return null;
}

function detectMinPackageFromQuery(query) {
  const text = String(query || "").toLowerCase();

  const lpaMatch = text.match(/(?:min(?:imum)?\s*)?(\d+(?:\.\d+)?)\s*(?:lpa|l\.p\.a|lakh\s*per\s*annum|lakhs?)/i);
  if (lpaMatch) {
    const value = Number(lpaMatch[1]);
    if (!Number.isNaN(value)) {
      return value;
    }
  }

  const ctcMatch = text.match(/(?:ctc\s*)?(?:min(?:imum)?\s*)?(\d+(?:\.\d+)?)\s*(?:package|salary)/i);
  if (ctcMatch) {
    const value = Number(ctcMatch[1]);
    if (!Number.isNaN(value)) {
      return value;
    }
  }

  return null;
}

function normalizeExtractedFilters(filters, originalQuery) {
  const normalized = { ...filters };
  const queryText = String(originalQuery || "").toLowerCase();
  const keyword = String(normalized.keyword || "").trim().toLowerCase();

  const genericRankingTerms = new Set([
    "top",
    "best",
    "nirf",
    "ranking",
    "rank",
    "college",
    "colleges",
    "india",
  ]);

  const keywordTerms = keyword.split(/\s+/).filter(Boolean);
  const isGenericRankingKeyword =
    keywordTerms.length > 0 &&
    keywordTerms.every((term) => genericRankingTerms.has(term));

  const courseTokenTerms = new Set([
    "b.a",
    "ba",
    "b.sc",
    "bsc",
    "b.com",
    "bcom",
    "b.tech",
    "btech",
    "mba",
    "mca",
    "m.tech",
    "mtech",
    "and",
    "or",
    "course",
    "courses",
  ]);
  const isCourseLikeKeyword =
    keywordTerms.length > 0 &&
    keywordTerms.every((term) => courseTokenTerms.has(term));

  // Prevent generic phrases from becoming strict college_name filters.
  if (
    keyword &&
    ((keyword.includes("top") || keyword.includes("best")) &&
      (keyword.includes("college") || keyword.includes("colleges")))
  ) {
    normalized.keyword = null;
  }

  // If ranking intent is already captured, ignore generic keyword fragments like "top".
  if (normalized.nirf_ranking_max != null && isGenericRankingKeyword) {
    normalized.keyword = null;
  }

  // Don't treat course tokens as college_name keywords.
  if (isCourseLikeKeyword) {
    normalized.keyword = null;
  }

  const detectedCourses = detectCourseAliasesFromQuery(originalQuery);
  const mergedCourses = [];
  if (normalized.course) {
    mergedCourses.push(String(normalized.course).trim());
  }
  mergedCourses.push(...detectedCourses);

  const uniqueCourses = Array.from(
    new Set(mergedCourses.filter(Boolean).map((v) => v.toLowerCase()))
  ).map((v) => mergedCourses.find((m) => m.toLowerCase() === v));

  if (uniqueCourses.length > 0) {
    normalized.courses = uniqueCourses;
  }

  // For course-focused queries, avoid sending the full sentence as college_name keyword.
  if (
    normalized.keyword &&
    detectedCourses.length > 0 &&
    normalized.keyword.toLowerCase().includes("college")
  ) {
    normalized.keyword = null;
  }

  if (!normalized.city) {
    const detectedCity = detectCityFromQuery(originalQuery);
    if (detectedCity) {
      normalized.city = detectedCity;
    }
  }

  const detectedCities = detectCityAliasesFromQuery(originalQuery);
  const cityCandidates = [];
  if (normalized.city) {
    cityCandidates.push(String(normalized.city).trim());
  }
  cityCandidates.push(...detectedCities);

  const uniqueCities = Array.from(
    new Set(cityCandidates.filter(Boolean).map((v) => v.toLowerCase()))
  ).map((v) => cityCandidates.find((m) => m.toLowerCase() === v));

  if (uniqueCities.length > 0) {
    normalized.cities = uniqueCities;
    if (!normalized.city) {
      normalized.city = uniqueCities[0];
    }
  }

  if (normalized.keyword && uniqueCities.length > 0) {
    const normalizedKeyword = String(normalized.keyword).toLowerCase().replace(/[^a-z0-9]/g, "");
    const matchesDetectedCity = uniqueCities.some((cityName) => {
      const cityToken = String(cityName).toLowerCase().replace(/[^a-z0-9]/g, "");
      return cityToken === normalizedKeyword;
    });

    if (matchesDetectedCity) {
      normalized.keyword = null;
    }
  }

  const parsedRange = detectNirfRangeFromQuery(originalQuery);
  if (parsedRange) {
    normalized.nirf_ranking_min = parsedRange.min;
    normalized.nirf_ranking_max = parsedRange.max;
  }

  const hasRankingIntent = /\bnirf\b|\brank\b|\branking\b|\btop\b/.test(queryText);
  if (
    hasRankingIntent &&
    normalized.nirf_ranking_max != null &&
    !Number.isNaN(Number(normalized.nirf_ranking_max)) &&
    (normalized.nirf_ranking_min == null || Number.isNaN(Number(normalized.nirf_ranking_min)))
  ) {
    normalized.nirf_ranking_min = 1;
  }

  if (
    (normalized.min_package_lpa == null || Number.isNaN(Number(normalized.min_package_lpa)))
  ) {
    const minPackage = detectMinPackageFromQuery(originalQuery);
    if (minPackage != null) {
      normalized.min_package_lpa = minPackage;
    }
  }

  // Generic single-term queries (e.g. "social") should search across all entities,
  // not get locked to one specialization record.
  if (
    normalized.specialization &&
    !normalized.keyword &&
    !hasAnyStructuredFilter({ ...normalized, specialization: null }) &&
    !hasExplicitSpecializationIntent(originalQuery)
  ) {
    normalized.keyword = String(normalized.specialization).trim();
    normalized.specialization = null;
  }

  if (normalized.keyword) {
    normalized.keyword_scope = hasInstitutionNameIntent(originalQuery) ? "college" : "global";
  }

  return normalized;
}

function isWeakKeywordOnlyQuery(filters) {
  const hasStructuredFilter = hasAnyStructuredFilter(filters);

  if (hasStructuredFilter) {
    return false;
  }

  const keyword = String(filters.keyword || "").trim();
  if (!keyword) {
    return true;
  }

  const compact = keyword.replace(/[^a-zA-Z0-9]/g, "");
  return compact.length < 3;
}

function hasAnyStructuredFilter(filters) {
  return Boolean(
    filters.city ||
      filters.state ||
      (Array.isArray(filters.cities) && filters.cities.length > 0) ||
      filters.course ||
      (Array.isArray(filters.courses) && filters.courses.length > 0) ||
      filters.specialization ||
      filters.naac_grade ||
      filters.ownership ||
      filters.institute_type ||
      (filters.nirf_ranking_max != null && !Number.isNaN(Number(filters.nirf_ranking_max))) ||
      (filters.min_package_lpa != null && !Number.isNaN(Number(filters.min_package_lpa)))
  );
}

function hasInstitutionNameIntent(text) {
  const value = String(text || "").toLowerCase();
  return /\b(college|university|institute|school|academy|campus)\b/.test(value);
}

function hasExplicitSpecializationIntent(text) {
  const value = String(text || "").toLowerCase();
  return /\b(speciali[sz]ation|specialization|spec|branch|stream)\b/.test(value);
}

async function logSearch(payload) {
  try {
    const logsDir = path.join(process.cwd(), "logs");
    await fs.mkdir(logsDir, { recursive: true });
    const logPath = path.join(logsDir, "ai-search.log");
    await fs.appendFile(logPath, `${JSON.stringify(payload)}\n`, "utf8");
  } catch (err) {
    // Logging failures should never break search execution.
  }
}

function pickBestMatch(input, rows, nameField) {
  if (!input || !rows || rows.length === 0) {
    return null;
  }

  const normalizedInput = String(input).trim().toLowerCase();
  const exact = rows.find((row) =>
    String(row[nameField] || "").trim().toLowerCase() === normalizedInput
  );

  return exact || rows[0];
}

function getCourseAliasRegex(courseName) {
  const normalized = String(courseName || "").trim().toLowerCase();
  const regexByAlias = {
    "b.a": /(^|[^a-z])b\.?\s*a([^a-z]|$)/i,
    "b.sc": /(^|[^a-z])b\.?\s*sc([^a-z]|$)/i,
    "b.com": /(^|[^a-z])b\.?\s*com([^a-z]|$)/i,
    "b.tech": /(^|[^a-z])b\.?\s*tech([^a-z]|$)|(^|[^a-z])btech([^a-z]|$)|(^|[^a-z])be([^a-z]|$)/i,
    mba: /(^|[^a-z])m\.?\s*ba([^a-z]|$)/i,
  };

  return regexByAlias[normalized] || null;
}

function selectBestCourseCandidate(courseName, rows) {
  if (!rows || rows.length === 0) {
    return null;
  }

  const normalized = String(courseName || "").trim().toLowerCase();

  function score(name) {
    const n = String(name || "").toLowerCase();

    if (normalized === "mba") {
      if (/mba\s*\/\s*pgdm\s*\/\s*mms/.test(n)) return 150;
      if (/^mba\b/.test(n) && !/integrated/.test(n)) return 120;
      if (/^mba\b/.test(n) && /integrated/.test(n)) return 90;
      if (/\bmba\b/.test(n) && !/integrated/.test(n)) return 70;
      if (/\bmba\b/.test(n)) return 50;
      return 0;
    }

    if (normalized === "b.com") {
      if (/b\.com\s*\([^)]*\)\s*\/\s*bcom/.test(n) || /b\.com\s*\/\s*bcom/.test(n)) return 100;
      if (/\bb\.?\s*com\b/.test(n) && !/hons/.test(n)) return 70;
      if (/\bb\.?\s*com\b/.test(n)) return 40;
      return 0;
    }

    if (normalized === "b.sc") {
      if (/b\.sc\s*\([^)]*\)\s*\/\s*bsc/.test(n) || /b\.sc\s*\/\s*bsc/.test(n)) return 100;
      if (/\bb\.?\s*sc\b/.test(n)) return 60;
      return 0;
    }

    if (normalized === "b.a") {
      if (/b\.a\.\s*\/\s*ba/.test(n)) return 100;
      if (/\bb\.?\s*a\b/.test(n) && !/hons/.test(n)) return 70;
      if (/\bb\.?\s*a\b/.test(n)) return 50;
      return 0;
    }

    if (normalized === "b.tech") {
      if (/be\s*\/\s*b\.tech\s*\/\s*btech/.test(n) || /^b\.tech\b/.test(n) || /^btech\b/.test(n)) return 100;
      if (/\bb\.tech\b|\bbtech\b|\bbe\b/.test(n)) return 60;
      return 0;
    }

    return 0;
  }

  const scored = rows
    .map((row) => ({ row, score: score(row.course_name) }))
    .sort((a, b) => b.score - a.score);

  if (scored[0] && scored[0].score > 0) {
    return scored[0].row;
  }

  const aliasRegex = getCourseAliasRegex(courseName);
  if (aliasRegex) {
    const aliasMatch = rows.find((row) => aliasRegex.test(String(row.course_name || "")));
    if (aliasMatch) {
      return aliasMatch;
    }
  }

  return pickBestMatch(courseName, rows, "course_name");
}

async function resolveStateFilter(pool, stateName) {
  if (!stateName) {
    return { name: null, id: null, matched_name: null, candidates: [] };
  }

  const sql = `
    SELECT id, name
    FROM ups_states
    WHERE name LIKE ?
    ORDER BY
      CASE WHEN LOWER(name) = LOWER(?) THEN 0 ELSE 1 END,
      name ASC
    LIMIT 10;
  `;
  const params = [`%${String(stateName).trim()}%`, String(stateName).trim()];
  const rows = await runQuery(pool, sql, params);
  const best = pickBestMatch(stateName, rows, "name");

  return {
    name: stateName,
    id: best ? best.id : null,
    matched_name: best ? best.name : null,
    candidates: rows,
  };
}

async function resolveCityFilter(pool, cityName, stateId) {
  if (!cityName) {
    return { name: null, id: null, matched_name: null, candidates: [] };
  }

  const clauses = ["ci.name LIKE ?"];
  const params = [`%${String(cityName).trim()}%`];

  if (stateId) {
    clauses.push("ci.state_id = ?");
    params.push(stateId);
  }

  const sql = `
    SELECT ci.id, ci.name, ci.state_id, s.name AS state_name
    FROM ups_cities ci
    LEFT JOIN ups_states s ON s.id = ci.state_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY
      CASE WHEN LOWER(ci.name) = LOWER(?) THEN 0 ELSE 1 END,
      ci.name ASC
    LIMIT 15;
  `;
  params.push(String(cityName).trim());

  const rows = await runQuery(pool, sql, params);
  const best = pickBestMatch(cityName, rows, "name");

  return {
    name: cityName,
    id: best ? best.id : null,
    matched_name: best ? best.name : null,
    state_id: best ? best.state_id : null,
    state_name: best ? best.state_name : null,
    candidates: rows,
  };
}

async function resolveCourseFilters(pool, coursesInput) {
  if (!Array.isArray(coursesInput) || coursesInput.length === 0) {
    return [];
  }

  const resolved = [];
  for (const courseName of coursesInput) {
    const trimmed = String(courseName || "").trim();
    if (!trimmed) {
      continue;
    }

    const sql = `
      SELECT id, course_name
      FROM ups_courses
      WHERE course_name LIKE ?
      ORDER BY
        CASE WHEN LOWER(course_name) = LOWER(?) THEN 0 ELSE 1 END,
        course_name ASC
      LIMIT 25;
    `;
    const rows = await runQuery(pool, sql, [`%${trimmed}%`, trimmed]);

    let best = selectBestCourseCandidate(trimmed, rows);

    resolved.push({
      name: trimmed,
      id: best ? best.id : null,
      matched_name: best ? best.course_name : null,
      candidates: rows,
    });
  }

  return resolved;
}

async function resolveSpecializationFilter(pool, specializationName) {
  if (!specializationName) {
    return { name: null, id: null, matched_name: null, course_id: null, candidates: [] };
  }

  const trimmed = String(specializationName).trim();
  const sql = `
    SELECT id, specilization_name, course_id
    FROM ups_courses_specialization
    WHERE specilization_name LIKE ?
    ORDER BY
      CASE WHEN LOWER(specilization_name) = LOWER(?) THEN 0 ELSE 1 END,
      specilization_name ASC
    LIMIT 10;
  `;
  const rows = await runQuery(pool, sql, [`%${trimmed}%`, trimmed]);
  const best = pickBestMatch(trimmed, rows, "specilization_name");

  return {
    name: specializationName,
    id: best ? best.id : null,
    matched_name: best ? best.specilization_name : null,
    course_id: best ? best.course_id : null,
    candidates: rows,
  };
}

async function resolveCollegeNameFilter(pool, keyword, cityIds, forceInstitutionSearch) {
  const trimmed = String(keyword || "").trim();
  if (!trimmed || (!forceInstitutionSearch && !hasInstitutionNameIntent(trimmed))) {
    return { name: null, id: null, matched_name: null, candidates: [], exact_match: false };
  }

  const clauses = ["c.status = 'Active'", "c.is_deleted = 'No'"];
  const params = [];

  const tokens = trimmed
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

  if (tokens.length > 0) {
    for (const token of tokens) {
      clauses.push("LOWER(c.college_name) LIKE ?");
      params.push(`%${token.toLowerCase()}%`);
    }
  } else {
    clauses.push("LOWER(c.college_name) LIKE ?");
    params.push(`%${trimmed.toLowerCase()}%`);
  }

  if (Array.isArray(cityIds) && cityIds.length > 0) {
    const placeholders = cityIds.map(() => "?").join(", ");
    clauses.push(`c.city_id IN (${placeholders})`);
    params.push(...cityIds);
  }

  const sql = `
    SELECT
      c.id,
      c.college_name,
      c.city_id,
      c.state_id,
      ci.name AS city,
      s.name AS state,
      c.institute_type
    FROM ups_colleges c
    LEFT JOIN ups_cities ci ON ci.id = c.city_id
    LEFT JOIN ups_states s ON s.id = c.state_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY
      CASE WHEN LOWER(c.college_name) = LOWER(?) THEN 0 ELSE 1 END,
      c.college_name ASC
    LIMIT 20;
  `;

  const rows = await runQuery(pool, sql, [...params, trimmed]);
  const best = pickBestMatch(trimmed, rows, "college_name");

  const normalizeName = (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

  const normalizedInput = normalizeName(trimmed);
  const exact = rows.find((row) => normalizeName(row.college_name) === normalizedInput);

  return {
    name: trimmed,
    id: exact ? exact.id : best ? best.id : null,
    matched_name: exact ? exact.college_name : best ? best.college_name : null,
    candidates: rows,
    exact_match: Boolean(exact),
  };
}

async function resolveFilterIds(pool, filters) {
  const state = await resolveStateFilter(pool, filters.state);

  const cityInputs = Array.isArray(filters.cities) && filters.cities.length > 0
    ? filters.cities
    : filters.city
      ? [filters.city]
      : [];

  const resolvedCities = [];
  for (const cityInput of cityInputs) {
    const resolvedCity = await resolveCityFilter(pool, cityInput, state.id);
    resolvedCities.push(resolvedCity);
  }

  const city = resolvedCities[0] || {
    name: null,
    id: null,
    matched_name: null,
    state_id: null,
    state_name: null,
    candidates: [],
  };

  const coursesInput = Array.isArray(filters.courses) && filters.courses.length > 0
    ? filters.courses
    : filters.course
      ? [filters.course]
      : [];

  const courses = await resolveCourseFilters(pool, coursesInput);
  const specialization = await resolveSpecializationFilter(pool, filters.specialization);
  const cityIds = resolvedCities.map((cityInfo) => cityInfo.id).filter((id) => id != null);
  const college_name_filter = await resolveCollegeNameFilter(
    pool,
    filters.keyword,
    cityIds,
    filters.keyword_scope === "college"
  );

  return {
    city,
    cities: resolvedCities,
    state,
    courses,
    specialization,
    naac_grade: filters.naac_grade || null,
    ownership: filters.ownership || null,
    institute_type: filters.institute_type || null,
    min_package_lpa:
      filters.min_package_lpa != null && !Number.isNaN(Number(filters.min_package_lpa))
        ? Number(filters.min_package_lpa)
        : null,
    college_name_filter,
    keyword_scope: filters.keyword_scope || null,
    keyword_analysis: null,
    nirf_ranking_range:
      filters.nirf_ranking_max != null
        ? {
            min:
              filters.nirf_ranking_min != null &&
              !Number.isNaN(Number(filters.nirf_ranking_min))
                ? Number(filters.nirf_ranking_min)
                : 1,
            max: Number(filters.nirf_ranking_max),
          }
        : null,
    nirf_ranking_max: filters.nirf_ranking_max ?? null,
    keyword: filters.keyword || null,
  };
}

async function analyzeKeywordAcrossTables(pool, keyword, keywordScope) {
  const value = String(keyword || "").trim();
  if (!value) {
    return null;
  }

  const likeValue = `%${value}%`;

  const colleges = await runQuery(
    pool,
    `
      SELECT id, college_name
      FROM ups_colleges
      WHERE status = 'Active' AND is_deleted = 'No' AND college_name LIKE ?
      ORDER BY college_name ASC
      LIMIT 10;
    `,
    [likeValue]
  );

  if (keywordScope === "college") {
    return {
      keyword: value,
      scope: "college",
      colleges,
      courses: [],
      specializations: [],
      cities: [],
      states: [],
    };
  }

  const courses = await runQuery(
    pool,
    `
      SELECT id, course_name
      FROM ups_courses
      WHERE course_name LIKE ?
      ORDER BY course_name ASC
      LIMIT 10;
    `,
    [likeValue]
  );

  const specializations = await runQuery(
    pool,
    `
      SELECT id, specilization_name
      FROM ups_courses_specialization
      WHERE specilization_name LIKE ?
      ORDER BY specilization_name ASC
      LIMIT 10;
    `,
    [likeValue]
  );

  const cities = await runQuery(
    pool,
    `
      SELECT id, name
      FROM ups_cities
      WHERE name LIKE ?
      ORDER BY name ASC
      LIMIT 10;
    `,
    [likeValue]
  );

  const states = await runQuery(
    pool,
    `
      SELECT id, name
      FROM ups_states
      WHERE name LIKE ?
      ORDER BY name ASC
      LIMIT 10;
    `,
    [likeValue]
  );

  return {
    keyword: value,
    scope: "global",
    colleges,
    courses,
    specializations,
    cities,
    states,
  };
}

async function findCollegesByMinPackage(pool, filters, resolved) {
  if (filters.min_package_lpa == null || Number.isNaN(Number(filters.min_package_lpa))) {
    return [];
  }

  const clauses = [
    "c.status = 'Active'",
    "c.is_deleted = 'No'",
    "cc.status = 'Active'",
    "cc.is_deleted = 'No'",
    "cc.minpackage IS NOT NULL",
    "cc.minpackage <> ''",
    "CAST(cc.minpackage AS DECIMAL(10,2)) >= ?",
  ];
  const params = [Number(filters.min_package_lpa)];

  const cityIds = (Array.isArray(resolved.cities) ? resolved.cities : [resolved.city])
    .map((city) => city && city.id)
    .filter((id) => id != null);
  if (cityIds.length > 0) {
    const placeholders = cityIds.map(() => "?").join(", ");
    clauses.push(`c.city_id IN (${placeholders})`);
    params.push(...cityIds);
  }

  if (resolved.state.id) {
    clauses.push("c.state_id = ?");
    params.push(resolved.state.id);
  }

  const courseIds = resolved.courses
    .map((course) => course.id)
    .filter((id) => id != null);
  if (courseIds.length > 0) {
    const placeholders = courseIds.map(() => "?").join(", ");
    clauses.push(`cc.course_id IN (${placeholders})`);
    params.push(...courseIds);
  }

  if (filters.ownership) {
    clauses.push("c.Ownership = ?");
    params.push(filters.ownership);
  }

  if (filters.institute_type) {
    clauses.push("c.institute_type = ?");
    params.push(filters.institute_type);
  }

  if (filters.nirf_ranking_max != null && !Number.isNaN(Number(filters.nirf_ranking_max))) {
    clauses.push("CAST(NULLIF(c.nirf_ranking, '') AS UNSIGNED) <= ?");
    params.push(Number(filters.nirf_ranking_max));
  }

  if (filters.nirf_ranking_min != null && !Number.isNaN(Number(filters.nirf_ranking_min))) {
    clauses.push("CAST(NULLIF(c.nirf_ranking, '') AS UNSIGNED) >= ?");
    params.push(Number(filters.nirf_ranking_min));
  }

  const sql = `
    SELECT DISTINCT
      c.id,
      c.college_name,
      ci.name AS city,
      s.name AS state,
      cc.minpackage,
      cr.course_name
    FROM ups_colleges c
    INNER JOIN ups_cities ci ON ci.id = c.city_id
    INNER JOIN ups_states s ON s.id = c.state_id
    INNER JOIN ups_colleges_courses cc ON cc.master_college_id = c.id
    LEFT JOIN ups_courses cr ON cr.id = cc.course_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY CAST(cc.minpackage AS DECIMAL(10,2)) DESC, c.college_name ASC
    LIMIT 100;
  `;

  return runQuery(pool, sql, params);
}

async function findCollegeData(pool, filters, resolved) {
  if (resolved.college_name_filter && resolved.college_name_filter.id) {
    const candidateIds = (resolved.college_name_filter.candidates || [])
      .map((candidate) => candidate.id)
      .filter((id) => id != null);

    const useIds = resolved.college_name_filter.exact_match
      ? [resolved.college_name_filter.id]
      : candidateIds.length > 0
        ? candidateIds
        : [resolved.college_name_filter.id];

    const placeholders = useIds.map(() => "?").join(", ");

    const sql = `
      SELECT
        c.id,
        c.college_name,
        ci.name AS city,
        s.name AS state,
        c.naac,
        c.Ownership AS ownership,
        c.institute_type,
        c.nirf_ranking,
        MAX(cc.minpackage) AS max_minpackage,
        MIN(cr.course_name) AS matched_course,
        MIN(sp.specilization_name) AS matched_specialization
      FROM ups_colleges c
      INNER JOIN ups_cities ci ON ci.id = c.city_id
      INNER JOIN ups_states s ON s.id = c.state_id
      LEFT JOIN ups_colleges_courses cc ON cc.master_college_id = c.id
      LEFT JOIN ups_courses cr ON cr.id = cc.course_id
      LEFT JOIN ups_courses_specialization sp ON sp.id = cc.specilization_id
      WHERE c.status = 'Active' AND c.is_deleted = 'No' AND c.id IN (${placeholders})
      GROUP BY c.id, c.college_name, ci.name, s.name, c.naac, c.Ownership, c.institute_type, c.nirf_ranking
      ORDER BY c.college_name ASC
      LIMIT 20;
    `;

    return runQuery(pool, sql, useIds);
  }

  const clauses = [
    "c.status = 'Active'",
    "c.is_deleted = 'No'",
    "(cc.id IS NULL OR (cc.status = 'Active' AND cc.is_deleted = 'No'))",
  ];
  const params = [];

  const cityIds = (Array.isArray(resolved.cities) ? resolved.cities : [resolved.city])
    .map((city) => city && city.id)
    .filter((id) => id != null);
  if (cityIds.length > 0) {
    const placeholders = cityIds.map(() => "?").join(", ");
    clauses.push(`c.city_id IN (${placeholders})`);
    params.push(...cityIds);
  }

  if (resolved.state.id) {
    clauses.push("c.state_id = ?");
    params.push(resolved.state.id);
  }

  const courseIds = resolved.courses
    .map((course) => course.id)
    .filter((id) => id != null);
  if (courseIds.length > 0) {
    const placeholders = courseIds.map(() => "?").join(", ");
    clauses.push(`cc.course_id IN (${placeholders})`);
    params.push(...courseIds);
  }

  if (resolved.specialization.id) {
    clauses.push("cc.specilization_id = ?");
    params.push(resolved.specialization.id);
  }

  if (filters.naac_grade) {
    clauses.push("c.naac = ?");
    params.push(filters.naac_grade);
  }

  if (filters.ownership) {
    clauses.push("c.Ownership = ?");
    params.push(filters.ownership);
  }

  if (filters.institute_type) {
    clauses.push("c.institute_type = ?");
    params.push(filters.institute_type);
  }

  if (filters.keyword) {
    const likeValue = `%${String(filters.keyword).trim()}%`;
    if (filters.keyword_scope === "college") {
      clauses.push("c.college_name LIKE ?");
      params.push(likeValue);
    } else {
      clauses.push(`(
        c.college_name LIKE ? OR
        ci.name LIKE ? OR
        s.name LIKE ? OR
        cr.course_name LIKE ? OR
        sp.specilization_name LIKE ? OR
        c.institute_type LIKE ? OR
        c.naac LIKE ? OR
        c.Ownership LIKE ?
      )`);
      params.push(likeValue, likeValue, likeValue, likeValue, likeValue, likeValue, likeValue, likeValue);
    }
  }

  if (filters.nirf_ranking_max != null && !Number.isNaN(Number(filters.nirf_ranking_max))) {
    clauses.push("CAST(NULLIF(c.nirf_ranking, '') AS UNSIGNED) <= ?");
    params.push(Number(filters.nirf_ranking_max));
  }

  if (filters.nirf_ranking_min != null && !Number.isNaN(Number(filters.nirf_ranking_min))) {
    clauses.push("CAST(NULLIF(c.nirf_ranking, '') AS UNSIGNED) >= ?");
    params.push(Number(filters.nirf_ranking_min));
  }

  if (filters.min_package_lpa != null && !Number.isNaN(Number(filters.min_package_lpa))) {
    clauses.push("cc.minpackage IS NOT NULL");
    clauses.push("cc.minpackage <> ''");
    clauses.push("CAST(cc.minpackage AS DECIMAL(10,2)) >= ?");
    params.push(Number(filters.min_package_lpa));
  }

  const sql = `
    SELECT
      c.id,
      c.college_name,
      ci.name AS city,
      s.name AS state,
      c.naac,
      c.Ownership AS ownership,
      c.institute_type,
      c.nirf_ranking,
      MAX(cc.minpackage) AS max_minpackage,
      MIN(cr.course_name) AS matched_course,
      MIN(sp.specilization_name) AS matched_specialization
    FROM ups_colleges c
    INNER JOIN ups_cities ci ON ci.id = c.city_id
    INNER JOIN ups_states s ON s.id = c.state_id
    LEFT JOIN ups_colleges_courses cc ON cc.master_college_id = c.id
    LEFT JOIN ups_courses cr ON cr.id = cc.course_id
    LEFT JOIN ups_courses_specialization sp ON sp.id = cc.specilization_id
    WHERE ${clauses.join(" AND ")}
    GROUP BY c.id, c.college_name, ci.name, s.name, c.naac, c.Ownership, c.institute_type, c.nirf_ranking
    ORDER BY
      CASE WHEN c.nirf_ranking IS NULL OR c.nirf_ranking = '' THEN 1 ELSE 0 END ASC,
      CAST(NULLIF(c.nirf_ranking, '') AS UNSIGNED) ASC,
      c.college_name ASC
    LIMIT 200;
  `;

  return runQuery(pool, sql, params);
}

async function getFilterSuggestion(rawQuery, pool, config) {
  const query = sanitizeQuery(rawQuery);
  if (!query) {
    throw new Error("Search query is required.");
  }

  const aiResult = await extractFiltersFromQuery(query, config.azure);
  const filters = normalizeExtractedFilters(aiResult.filters, query);

  if (isWeakKeywordOnlyQuery(filters)) {
    const inputWarning =
      "Query is too broad. Please type at least 3 letters or add a filter like city, course, NIRF, or min package.";

    await logSearch({
      timestamp: new Date().toISOString(),
      query,
      ai_error: aiResult.aiError,
      mode: "filter_suggestion",
      filters,
      input_warning: inputWarning,
    });

    return {
      query,
      filters_applied: filters,
      resolved_filters: {
        city: { name: null, id: null, matched_name: null, state_id: null, state_name: null, candidates: [] },
        cities: [],
        state: { name: null, id: null, matched_name: null, candidates: [] },
        courses: [],
        specialization: { name: null, id: null, matched_name: null, course_id: null, candidates: [] },
        naac_grade: null,
        ownership: null,
        institute_type: null,
        min_package_lpa: filters.min_package_lpa ?? null,
        nirf_ranking_range: null,
        keyword: filters.keyword || null,
      },
      matching_colleges: [],
      college_data: [],
      ai_error: aiResult.aiError,
      input_warning: inputWarning,
    };
  }

  const resolved = await resolveFilterIds(pool, filters);
  if (filters.keyword && !hasAnyStructuredFilter(filters)) {
    resolved.keyword_analysis = await analyzeKeywordAcrossTables(
      pool,
      filters.keyword,
      filters.keyword_scope || "global"
    );
  }
  const matchingColleges = await findCollegesByMinPackage(pool, filters, resolved);
  const collegeData = await findCollegeData(pool, filters, resolved);

  await logSearch({
    timestamp: new Date().toISOString(),
    query,
    ai_error: aiResult.aiError,
    mode: "filter_suggestion",
    filters,
    resolved,
    matching_colleges_count: matchingColleges.length,
    college_data_count: collegeData.length,
  });

  return {
    query,
    filters_applied: filters,
    resolved_filters: resolved,
    matching_colleges: matchingColleges,
    college_data: collegeData,
    ai_error: aiResult.aiError,
  };
}

module.exports = {
  getFilterSuggestion,
};
