function addLikeClause(clauses, params, column, value) {
  if (!value) {
    return;
  }
  clauses.push(`${column} LIKE ?`);
  params.push(`%${String(value).trim()}%`);
}

function buildCourseCondition(course) {
  const normalized = String(course || "").trim().toLowerCase();
  const regexByAlias = {
    "b.a": "(^|[^a-z])b\\.?\\s*a([^a-z]|$)",
    "b.sc": "(^|[^a-z])b\\.?\\s*sc([^a-z]|$)",
    "b.com": "(^|[^a-z])b\\.?\\s*com([^a-z]|$)",
    "b.tech": "(^|[^a-z])b\\.?\\s*tech([^a-z]|$)|(^|[^a-z])btech([^a-z]|$)|(^|[^a-z])be([^a-z]|$)",
    mba: "(^|[^a-z])m\\.?\\s*ba([^a-z]|$)",
  };

  if (regexByAlias[normalized]) {
    return {
      clause: "LOWER(cr.course_name) REGEXP ?",
      param: regexByAlias[normalized],
    };
  }

  return {
    clause: "cr.course_name LIKE ?",
    param: `%${String(course).trim()}%`,
  };
}

function buildCollegeSearchQuery(filters) {
  const clauses = [
    "c.status = 'Active'",
    "c.is_deleted = 'No'",
  ];
  const params = [];

  addLikeClause(clauses, params, "ci.name", filters.city);
  addLikeClause(clauses, params, "s.name", filters.state);

  if (Array.isArray(filters.courses) && filters.courses.length > 0) {
    const courseClauses = [];
    for (const course of filters.courses) {
      if (!course) {
        continue;
      }
      const condition = buildCourseCondition(course);
      courseClauses.push(condition.clause);
      params.push(condition.param);
    }
    if (courseClauses.length > 0) {
      clauses.push(`(${courseClauses.join(" OR ")})`);
    }
  } else {
    if (filters.course) {
      const condition = buildCourseCondition(filters.course);
      clauses.push(condition.clause);
      params.push(condition.param);
    }
  }

  addLikeClause(clauses, params, "sp.specilization_name", filters.specialization);
  addLikeClause(clauses, params, "c.college_name", filters.keyword);

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

  if (filters.nirf_ranking_max != null && !Number.isNaN(filters.nirf_ranking_max)) {
    clauses.push("CAST(NULLIF(c.nirf_ranking, '') AS UNSIGNED) <= ?");
    params.push(Number(filters.nirf_ranking_max));
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
      c.year_of_establishment,
      c.nirf_ranking,
      MIN(cr.course_name) AS matched_course,
      MIN(sp.specilization_name) AS matched_specialization
    FROM ups_colleges c
    INNER JOIN ups_cities ci ON c.city_id = ci.id
    INNER JOIN ups_states s ON c.state_id = s.id
    LEFT JOIN ups_colleges_courses cc
      ON cc.master_college_id = c.id
      AND cc.status = 'Active'
      AND cc.is_deleted = 'No'
    LEFT JOIN ups_courses cr ON cc.course_id = cr.id
    LEFT JOIN ups_courses_specialization sp ON cc.specilization_id = sp.id
    WHERE ${clauses.join(" AND ")}
    GROUP BY c.id, c.college_name, ci.name, s.name, c.naac, c.Ownership, c.institute_type, c.year_of_establishment, c.nirf_ranking
    ORDER BY
      CASE WHEN c.nirf_ranking IS NULL OR c.nirf_ranking = '' THEN 1 ELSE 0 END ASC,
      CAST(NULLIF(c.nirf_ranking, '') AS UNSIGNED) ASC,
      c.college_name ASC;
  `;

  return { sql, params };
}

module.exports = {
  buildCollegeSearchQuery,
};
