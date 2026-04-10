const readline = require("readline");
const { getConfig, validateConfig } = require("./config");
const { createDbPool } = require("./db");
const { getFilterSuggestion } = require("./searchService");

function readQueryFromTerminal() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question("Enter your search query: ", (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function printResult(result) {
  if (result.input_warning) {
    console.log(`\nInput warning: ${result.input_warning}`);
  }

  console.log("\nDetected filters from query:");
  console.table(result.filters_applied);

  const resolved = result.resolved_filters;
  const keywordAnalysis = resolved.keyword_analysis || null;

  console.log("\nResolved filter IDs:");
  console.log(
    JSON.stringify(
      {
        state: {
          name: resolved.state.name,
          id: resolved.state.id,
          matched_name: resolved.state.matched_name,
        },
        city: {
          name: resolved.city.name,
          id: resolved.city.id,
          matched_name: resolved.city.matched_name,
          state_id: resolved.city.state_id,
        },
        cities: (resolved.cities || []).map((city) => ({
          name: city.name,
          id: city.id,
          matched_name: city.matched_name,
          state_id: city.state_id,
        })),
        courses: resolved.courses.map((course) => ({
          name: course.name,
          id: course.id,
          matched_name: course.matched_name,
        })),
        specialization: {
          name: resolved.specialization.name,
          id: resolved.specialization.id,
          matched_name: resolved.specialization.matched_name,
          course_id: resolved.specialization.course_id,
        },
        college_name_filter: {
          name: resolved.college_name_filter?.name || null,
          id: resolved.college_name_filter?.id || null,
          matched_name: resolved.college_name_filter?.matched_name || null,
        },
        naac_grade: resolved.naac_grade,
        ownership: resolved.ownership,
        institute_type: resolved.institute_type,
        min_package_lpa: resolved.min_package_lpa,
        nirf_ranking_range: resolved.nirf_ranking_range,
        keyword: resolved.keyword,
        keyword_analysis: keywordAnalysis,
        filter_options_from_keyword: keywordAnalysis
          ? {
              states: keywordAnalysis.states.map((item) => ({
                id: item.id,
                name: item.name,
              })),
              cities: keywordAnalysis.cities.map((item) => ({
                id: item.id,
                name: item.name,
              })),
              courses: keywordAnalysis.courses.map((item) => ({
                id: item.id,
                name: item.course_name,
              })),
              specializations: keywordAnalysis.specializations.map((item) => ({
                id: item.id,
                name: item.specilization_name,
              })),
              colleges: keywordAnalysis.colleges.map((item) => ({
                id: item.id,
                name: item.college_name,
              })),
            }
          : null,
      },
      null,
      2
    )
  );

  if (resolved.state.candidates.length > 0) {
    console.log("\nState candidates:");
    console.table(resolved.state.candidates);
  }

  if (Array.isArray(resolved.cities) && resolved.cities.length > 0) {
    for (const city of resolved.cities) {
      if (city.candidates.length > 0) {
        console.log(`\nCity candidates for \"${city.name}\":`);
        console.table(city.candidates);
      }
    }
  } else if (resolved.city.candidates.length > 0) {
    console.log("\nCity candidates:");
    console.table(resolved.city.candidates);
  }

  if (resolved.courses.length > 0) {
    for (const course of resolved.courses) {
      if (course.candidates.length > 0) {
        console.log(`\nCourse candidates for \"${course.name}\":`);
        console.table(course.candidates);
      }
    }
  }

  if (resolved.specialization.candidates.length > 0) {
    console.log("\nSpecialization candidates:");
    console.table(resolved.specialization.candidates);
  }

  if (resolved.college_name_filter && resolved.college_name_filter.candidates.length > 0) {
    console.log("\nCollege name candidates:");
    console.table(resolved.college_name_filter.candidates);
  }

  if (resolved.keyword_analysis) {
    console.log("\nKeyword analysis across tables:");
    if (resolved.keyword_analysis.colleges.length > 0) {
      console.log("\nCollege-name matches:");
      console.table(resolved.keyword_analysis.colleges);
    }
    if (resolved.keyword_analysis.courses.length > 0) {
      console.log("\nCourse-name matches:");
      console.table(resolved.keyword_analysis.courses);
    }
    if (resolved.keyword_analysis.specializations.length > 0) {
      console.log("\nSpecialization matches:");
      console.table(resolved.keyword_analysis.specializations);
    }
    if (resolved.keyword_analysis.cities.length > 0) {
      console.log("\nCity-name matches:");
      console.table(resolved.keyword_analysis.cities);
    }
    if (resolved.keyword_analysis.states.length > 0) {
      console.log("\nState-name matches:");
      console.table(resolved.keyword_analysis.states);
    }
  }

  if (Array.isArray(result.matching_colleges) && result.matching_colleges.length > 0) {
    console.log(`\nColleges matching min package filter (${result.matching_colleges.length}):`);
    console.table(result.matching_colleges);
  }

  if (Array.isArray(result.college_data) && result.college_data.length > 0) {
    console.log(`\nCollege data (${result.college_data.length}):`);
    console.table(result.college_data);
  } else {
    console.log("\nCollege data: no matching colleges found for applied filters.");
  }
}

async function main() {
  const config = getConfig();
  validateConfig(config);

  const argQuery = process.argv.slice(2).join(" ").trim();
  const query = argQuery || (await readQueryFromTerminal());

  const pool = createDbPool(config.db);

  try {
    const result = await getFilterSuggestion(query, pool, config);

    if (result.ai_error) {
      console.log(`\nAI extraction warning: ${result.ai_error}`);
      console.log("Fallback filter parsing was applied.");
    }

    printResult(result);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Search failed:", error.message);
  process.exitCode = 1;
});
